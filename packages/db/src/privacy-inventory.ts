import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { runAsSystem } from "./audit.js";
import type { Database, ScopedClient } from "./scoped.js";

// Closed SQL projections: no user text is interpolated as a table/column name.
// IDs are ordered as text deliberately (also for bigint outbox IDs); cursors are
// persisted source keys, not offsets that shift when earlier rows disappear.
const sources = {
  "plaid-subjects": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_subjects`],
  "plaid-exchanges": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_exchanges`],
  "plaid-items": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_items`],
  "plaid-credentials": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_credentials`],
  "plaid-routes": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_item_routes`],
  "plaid-cursors": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_cursors`],
  "plaid-webhooks": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_webhooks`],
  "plaid-accounts": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_accounts`],
  "plaid-transactions": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM plaid_local_transactions`],
  results: ["derived-records", Prisma.sql`SELECT id::text AS key,household_id FROM document_results`],
  "result-reviews": ["derived-records", Prisma.sql`SELECT id::text AS key,household_id FROM document_result_reviews`],
  "period-decisions": ["derived-records", Prisma.sql`SELECT id::text AS key,household_id FROM document_period_decisions`],
  custodies: ["documents", Prisma.sql`SELECT id::text AS key,household_id FROM document_custodies`],
  processing: ["job-artifacts", Prisma.sql`SELECT id::text AS key,household_id FROM document_processing`],
  documents: ["documents", Prisma.sql`SELECT id::text AS key,household_id FROM documents`],
  uploads: ["documents", Prisma.sql`SELECT u.document_id::text AS key,d.household_id FROM document_uploads u JOIN documents d ON d.id=u.document_id`],
  chunks: ["derived-records", Prisma.sql`SELECT id::text AS key,household_id FROM document_chunks`],
  items: ["derived-records", Prisma.sql`SELECT id::text AS key,household_id FROM items`],
  secrets: ["identifier-secrets", Prisma.sql`SELECT s.id::text AS key,i.household_id FROM item_secrets s JOIN items i ON i.id=s.item_id`],
  obligations: ["derived-records", Prisma.sql`SELECT id::text AS key,household_id FROM obligations`],
  reminders: ["notifications-reminders", Prisma.sql`SELECT id::text AS key,household_id FROM reminders`],
  notifications: ["notifications-reminders", Prisma.sql`SELECT id::text AS key,household_id FROM notifications`],
  "notification-deliveries": ["notifications-reminders", Prisma.sql`SELECT d.id::text AS key,n.household_id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id`],
  outbox: ["outbox-delivery-inbox", Prisma.sql`SELECT id::text AS key,household_id FROM outbox_events`],
  deliveries: ["outbox-delivery-inbox", Prisma.sql`SELECT id::text AS key,household_id FROM job_deliveries`],
  inbox: ["outbox-delivery-inbox", Prisma.sql`SELECT id::text AS key,household_id FROM job_inbox`],
  scans: ["job-artifacts", Prisma.sql`SELECT id::text AS key,household_id FROM document_scans`],
  "scan-attempts": ["job-artifacts", Prisma.sql`SELECT id::text AS key,household_id FROM document_scan_attempts`],
  "stripe-bindings": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM stripe_test_bindings`],
  "stripe-states": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM stripe_test_states`],
  "stripe-intents": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM stripe_test_intents`],
  "stripe-notices": ["provider-references", Prisma.sql`SELECT id::text AS key,household_id FROM stripe_test_notices`],
  "export-artifacts": ["job-artifacts", Prisma.sql`SELECT id::text AS key,household_id FROM local_export_artifacts`],
  "auth-challenges": ["account-household", Prisma.sql`SELECT id::text AS key,household_id FROM account_security_challenges`],
} as const;
export type PrivacyInventorySource = keyof typeof sources;
export const PRIVACY_INVENTORY_SOURCES = Object.freeze(Object.keys(sources) as PrivacyInventorySource[]);
const refuse = () => { throw new Error("Privacy inventory refused"); };
function sourceOf(source: unknown) {
  if (typeof source !== "string" || !Object.hasOwn(sources, source)) return refuse();
  return sources[source as PrivacyInventorySource];
}
function reference(hh: string, source: string, key: string) {
  const h = createHash("sha256").update(`${hh.toLowerCase()}/${source}/${key}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function request(tx: ScopedClient, hh: string, id: string, mutable: boolean) {
  const [r] = await tx.$queryRaw<Array<{ state: string; ready: boolean }>>`SELECT state,settle_until<=clock_timestamp() AS ready
    FROM household_deletions WHERE id=${id}::uuid AND household_id=${hh}::uuid FOR UPDATE`;
  if (!r?.ready || (mutable ? r.state !== "fenced" : !["fenced","verifying"].includes(r.state))) refuse();
}

/** One transaction inventories <=100 source rows and persists the continuation in
 * immutable manifest entries. A committed page survives a lost response; restarting
 * discovers its last key. Source data must be fenced; drift is detected separately.
 * This is local DB coverage only, never storage/provider/account completeness. */
export async function inventoryLocalDeletionPage(db: Database, hh: string, id: string, source: PrivacyInventorySource) {
  const [component, query] = sourceOf(source);
  return runAsSystem("Inventory one bounded content-free privacy page", () => db.withHousehold(hh, async tx => {
    await request(tx,hh,id,true);
    const [last] = await tx.$queryRaw<Array<{ key: string | null }>>`SELECT max(source_key COLLATE "C") AS key
      FROM deletion_resources WHERE deletion_id=${id}::uuid AND household_id=${hh}::uuid AND inventory_source=${source}`;
    const rows = await tx.$queryRaw<Array<{ key: string }>>(Prisma.sql`SELECT key FROM (${query}) s
      WHERE s.household_id=${hh}::uuid AND (${last!.key}::text IS NULL OR key COLLATE "C">${last!.key}) ORDER BY key COLLATE "C" LIMIT 101`);
    for (const row of rows.slice(0,100)) {
      await tx.$executeRaw`INSERT INTO deletion_resources(deletion_id,household_id,component,resource_ref,inventory_count,inventory_source,source_key)
        VALUES(${id}::uuid,${hh}::uuid,${component},${reference(hh,source,row.key)}::uuid,1,${source},${row.key})`;
    }
    return { recorded: Math.min(rows.length,100), more: rows.length>100, inventoryComplete: false as const };
  }));
}

/** Independent verifier detects skipped/lost/extra entries and count/route drift.
 * Counts scan this household's indexed source; result size stays bounded. A large
 * household exceeding the short transaction budget refuses, never reports complete.
 * Calling all sources still says nothing about external objects or account scope. */
export async function reconcileLocalDeletionInventory(db: Database, hh: string, id: string, source: PrivacyInventorySource) {
  const [component, query] = sourceOf(source);
  return db.withHousehold(hh,async tx=>{
    await request(tx,hh,id,false);
    const [r] = await tx.$queryRaw<Array<{ source_count: bigint; manifested: bigint; missing: bigint; extra: bigint; invalid: bigint }>>(Prisma.sql`
      WITH source AS (SELECT key FROM (${query}) scoped WHERE household_id=${hh}::uuid), manifest AS (SELECT source_key,component,inventory_count,resource_ref,
        encode(sha256(convert_to(lower(household_id::text)||'/'||inventory_source||'/'||source_key,'UTF8')),'hex') AS digest FROM deletion_resources
        WHERE deletion_id=${id}::uuid AND household_id=${hh}::uuid AND inventory_source=${source})
      SELECT (SELECT count(*) FROM source) AS source_count,(SELECT count(*) FROM manifest) AS manifested,
        (SELECT count(*) FROM source s WHERE NOT EXISTS(SELECT 1 FROM manifest m WHERE m.source_key=s.key)) AS missing,
        (SELECT count(*) FROM manifest m WHERE NOT EXISTS(SELECT 1 FROM source s WHERE s.key=m.source_key)) AS extra,
        (SELECT count(*) FROM manifest WHERE component<>${component} OR inventory_count<>1 OR resource_ref::text<>(
          substr(digest,1,8)||'-'||substr(digest,9,4)||'-4'||substr(digest,14,3)||'-8'||substr(digest,18,3)||'-'||substr(digest,21,12))) AS invalid`);
    if (!r) return refuse();
    return { sourceCount:Number(r.source_count), manifested:Number(r.manifested), missing:Number(r.missing), extra:Number(r.extra), invalid:Number(r.invalid),
      localSourceMatches:r.missing===0n&&r.extra===0n&&r.invalid===0n, inventoryComplete:false as const, finalReceiptIssuable:false as const };
  });
}

/** Recovery diagnostics only. An expired lease is not success, and even an
 * acknowledged attempt without independent observation remains unverified. */
export async function reconcileDeletionAttemptsPage(db: Database, hh: string, id: string, after: string | null = null) {
  if (after !== null && !/^[a-f0-9-]{36}$/.test(after)) return refuse();
  return db.withHousehold(hh,async tx=>{
    await request(tx,hh,id,false);
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`SELECT r.id,CASE
      WHEN a.completed_at IS NULL AND a.lease_until>clock_timestamp() THEN 'in-flight'
      WHEN a.completed_at IS NULL AND a.id IS NOT NULL THEN 'lease-expired'
      WHEN a.outcome='acknowledged' THEN 'acknowledged-unverified'
      WHEN a.attempt>=3 THEN 'exhausted' ELSE 'retry-or-unattempted' END AS status
      FROM deletion_resources r LEFT JOIN LATERAL (SELECT id,attempt,completed_at,lease_until,outcome FROM deletion_attempts
        WHERE resource_id=r.id AND household_id=${hh}::uuid ORDER BY attempt DESC LIMIT 1) a ON true
      WHERE r.deletion_id=${id}::uuid AND r.household_id=${hh}::uuid AND (${after}::uuid IS NULL OR r.id>${after}::uuid)
      ORDER BY r.id LIMIT 101`;
    return { resources:rows.slice(0,100), next:rows.length>100?rows[99]!.id:null, finalReceiptIssuable:false as const };
  });
}
