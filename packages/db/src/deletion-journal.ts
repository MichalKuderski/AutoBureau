import { randomUUID } from "node:crypto";
import { DeletionManifestSchema, SyntheticAbsenceSchema } from "@autobureau/contracts";
import { currentActor, runAsSystem } from "./audit.js";
import type { Database } from "./scoped.js";

export class DeletionJournalError extends Error {
  constructor(readonly code: "invalid" | "denied" | "conflict") { super(`Deletion journal: ${code}`); }
}
/** Caller must establish the authenticated actor; the DB independently checks owner
 * membership and stamps request/grace time. No API or deletion worker is activated. */
export async function requestHouseholdDeletion(db: Database, householdId: string, confirmation: unknown) {
  const actor = currentActor();
  if (actor?.type !== "user" || confirmation !== "DELETE HOUSEHOLD") throw new DeletionJournalError("denied");
  return db.withHousehold(householdId, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${householdId}`},0))`;
    const owner = await tx.householdUser.findFirst({ where: { householdId, userId: actor.userId, role: "owner" }, select: { userId: true } });
    if (!owner) throw new DeletionJournalError("denied");
    const active = await tx.householdDeletion.findFirst({ where: { householdId, state: { not: "cancelled" } }, select: { id: true } });
    if (active) return active.id;
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO household_deletions(household_id,requested_by)
      VALUES(${householdId}::uuid,${actor.userId}::uuid) RETURNING id`;
    return row!.id;
  });
}
export async function undoHouseholdDeletion(db: Database, householdId: string, requestId: string) {
  if (currentActor()?.type !== "user") throw new DeletionJournalError("denied");
  return db.withHousehold(householdId, async tx => {
    const n = await tx.$executeRaw`UPDATE household_deletions SET state='cancelled'
      WHERE id=${requestId}::uuid AND household_id=${householdId}::uuid AND state='grace' AND undo_until>clock_timestamp()`;
    return n === 1;
  });
}
export async function fenceHouseholdDeletion(db: Database, householdId: string, requestId: string) {
  return runAsSystem("Activate matured household deletion fence", () => db.withHousehold(householdId, async tx => {
    const count = await tx.$executeRaw`UPDATE household_deletions SET state='fenced' WHERE id=${requestId}::uuid
      AND household_id=${householdId}::uuid AND state='grace' AND undo_until<=clock_timestamp()`;
    return count === 1;
  }));
}
export async function appendDeletionManifest(db: Database, householdId: string, requestId: string, input: unknown) {
  const parsed = DeletionManifestSchema.safeParse(input); if (!parsed.success) throw new DeletionJournalError("invalid");
  return runAsSystem("Snapshot bounded content-free deletion manifest", () => db.withHousehold(householdId, async tx => {
    const [row] = await tx.$queryRaw<Array<{ state: string; ready: boolean }>>`SELECT state,settle_until<=clock_timestamp() AS ready
      FROM household_deletions WHERE id=${requestId}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
    if (row?.state !== "fenced" || !row.ready) throw new DeletionJournalError("conflict");
    for (const entry of parsed.data) {
      await tx.$executeRaw`INSERT INTO deletion_resources(deletion_id,household_id,component,resource_ref,inventory_count)
        VALUES(${requestId}::uuid,${householdId}::uuid,${entry.component},${entry.resourceRef}::uuid,${entry.inventoryCount})
        ON CONFLICT(deletion_id,component,resource_ref) DO NOTHING`;
      const [existing] = await tx.$queryRaw<Array<{ inventory_count: number }>>`SELECT inventory_count FROM deletion_resources
        WHERE deletion_id=${requestId}::uuid AND household_id=${householdId}::uuid AND component=${entry.component} AND resource_ref=${entry.resourceRef}::uuid`;
      if (existing?.inventory_count !== entry.inventoryCount) throw new DeletionJournalError("conflict");
    }
  }));
}
export async function sealDeletionManifest(db: Database, householdId: string, requestId: string) {
  return runAsSystem("Seal deletion inventory after capability settlement", () => db.withHousehold(householdId, async tx => {
    const count = await tx.$executeRaw`UPDATE household_deletions SET state='verifying' WHERE id=${requestId}::uuid AND household_id=${householdId}::uuid AND state='fenced'`;
    return count === 1;
  }));
}
/** The operation id is the resource id across retries, never a fresh provider key.
 * Successful provider acknowledgement is recorded separately from observed absence. */
export async function claimDeletionAttempt(db: Database, householdId: string, resourceId: string) {
  return runAsSystem("Claim one bounded deletion resource operation", () => db.withHousehold(householdId, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deletion-resource:${resourceId}`},0))`;
    const [resource] = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM deletion_resources r JOIN household_deletions d ON d.id=r.deletion_id
      WHERE r.id=${resourceId}::uuid AND r.household_id=${householdId}::uuid AND d.state='verifying'`;
    if (!resource) return null;
    const [prior] = await tx.$queryRaw<Array<{ id: string; attempt: number; active: boolean; completed_at: Date | null; outcome: string | null }>>`
      SELECT id,attempt,lease_until>clock_timestamp() AS active,completed_at,outcome FROM deletion_attempts
      WHERE resource_id=${resourceId}::uuid AND household_id=${householdId}::uuid ORDER BY attempt DESC LIMIT 1`;
    if (prior?.outcome === "acknowledged" || (prior?.active && !prior.completed_at)) return null;
    if (prior && !prior.completed_at) await tx.$executeRaw`UPDATE deletion_attempts SET completed_at=clock_timestamp(),outcome='lease-expired' WHERE id=${prior.id}::uuid AND household_id=${householdId}::uuid`;
    if (prior && prior.attempt >= 3) return null;
    const id = randomUUID(), token = randomUUID(), attempt = (prior?.attempt ?? 0) + 1;
    await tx.$executeRaw`INSERT INTO deletion_attempts(id,resource_id,household_id,attempt,lease_token,lease_until)
      VALUES(${id}::uuid,${resourceId}::uuid,${householdId}::uuid,${attempt},${token}::uuid,clock_timestamp()+interval '30 seconds')`;
    return { id, token, operationId: resourceId, attempt };
  }));
}
export async function recordDeletionAttempt(db: Database, householdId: string, id: string, token: string, outcome: "acknowledged" | "failed") {
  if (!["acknowledged", "failed"].includes(outcome)) throw new DeletionJournalError("invalid");
  return runAsSystem("Record deletion acknowledgement without claiming erasure", () => db.withHousehold(householdId, async tx => {
    await tx.$queryRaw`SELECT id FROM deletion_attempts WHERE id=${id}::uuid AND household_id=${householdId}::uuid FOR UPDATE`;
    return (await tx.$executeRaw`UPDATE deletion_attempts SET outcome=${outcome},completed_at=clock_timestamp()
      WHERE id=${id}::uuid AND household_id=${householdId}::uuid AND lease_token=${token}::uuid AND lease_until>clock_timestamp() AND completed_at IS NULL`) === 1;
  }));
}
/** Synthetic provider port only. This cannot insert an actual provider/backup proof.
 * Uses the separate verification role, never the deletion executor's connection. */
export async function recordSyntheticDeletionObservation(db: Database, householdId: string, resourceId: string, input: unknown) {
  const parsed = SyntheticAbsenceSchema.safeParse(input); if (!parsed.success) throw new DeletionJournalError("invalid");
  const v = parsed.data;
  return runAsSystem("Record independent synthetic absence observation", () => db.withHousehold(householdId, async tx => {
    const [existing] = await tx.$queryRaw<Array<{ resource_id: string; state: string; remaining: number; source: string; retention_until: Date | null }>>`SELECT resource_id,state,remaining,source,retention_until FROM deletion_observations WHERE evidence_id=${v.evidenceId}::uuid`;
    if (existing) {
      if (existing.resource_id !== resourceId || existing.state !== v.state || existing.remaining !== v.remaining || existing.source !== "synthetic"
        || (existing.retention_until?.toISOString() ?? null) !== (v.retentionUntil ? new Date(v.retentionUntil).toISOString() : null)) throw new DeletionJournalError("conflict");
      return;
    }
    await tx.$executeRaw`INSERT INTO deletion_observations(resource_id,household_id,evidence_id,source,state,remaining,retention_until)
      VALUES(${resourceId}::uuid,${householdId}::uuid,${v.evidenceId}::uuid,'synthetic',${v.state},${v.remaining},${v.retentionUntil ? new Date(v.retentionUntil) : null})`;
  }));
}
/** Independent restricted-role DB read-back. An empty local table cannot prove
 * storage/provider erasure, so only wholly local coverage classes can be absent. */
export async function observeLocalDeletionResource(db: Database, householdId: string, resourceId: string) {
  return runAsSystem("Independently inspect local deletion coverage", () => db.withHousehold(householdId, async tx => {
    const resource = await tx.deletionResource.findFirst({ where: { id: resourceId, householdId }, select: { component: true } });
    if (!resource) throw new DeletionJournalError("denied");
    let remaining = 0, completeLocalScope = false;
    if (resource.component === "derived-records") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT
        (SELECT count(*) FROM items WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM obligations WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM document_chunks WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM document_results WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM document_result_reviews WHERE household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count); completeLocalScope = true;
    } else if (resource.component === "identifier-secrets") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM item_secrets s
        JOIN items i ON i.id=s.item_id WHERE i.household_id=${householdId}::uuid`;
      remaining = Number(row!.count); completeLocalScope = true;
    } else if (resource.component === "documents") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT (SELECT count(*) FROM documents WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM document_custodies WHERE household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count);
    } else if (resource.component === "notifications-reminders") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT
        (SELECT count(*) FROM reminders WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM notifications WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM notification_deliveries x JOIN notifications n ON n.id=x.notification_id WHERE n.household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count); // Email/provider copies are a separate unresolved scope.
    } else if (resource.component === "account-household") {
      // Erasable household records plus the retained anchors (memberships, auth challenges)
      // that ADR-019 keeps; the account identity and provider auth record are out of scope,
      // so this component can never read as complete.
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT
        (SELECT count(*) FROM household_members WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM entitlements WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM idempotency_keys WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM household_users WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM account_security_challenges WHERE household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count);
    } else if (resource.component === "outbox-delivery-inbox") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT
        (SELECT count(*) FROM outbox_events WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM job_deliveries WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM job_inbox WHERE household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count); // Transport copies/replay horizon are not local DB facts.
    } else if (resource.component === "job-artifacts") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT
        (SELECT count(*) FROM document_scans WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM document_scan_attempts WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM document_processing WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM local_export_artifacts WHERE household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count); // Files/worker artifacts need an independent inventory.
    } else if (resource.component === "provider-references") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT
        (SELECT count(*) FROM stripe_test_bindings WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM stripe_test_notices WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM stripe_test_states WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM stripe_test_intents WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_subjects WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_exchanges WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_items WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_credentials WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_item_routes WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_cursors WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_webhooks WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_accounts WHERE household_id=${householdId}::uuid)+
        (SELECT count(*) FROM plaid_local_transactions WHERE household_id=${householdId}::uuid) AS count`;
      remaining = Number(row!.count); // Neither a provider acknowledgement nor provider absence.
    } else if (resource.component === "audit") {
      const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM audit_log WHERE household_id=${householdId}::uuid`;
      remaining = Number(row!.count);
    }
    const state = remaining > 0 ? "remaining" : completeLocalScope ? "absent" : "unknown";
    await tx.$executeRaw`INSERT INTO deletion_observations(resource_id,household_id,evidence_id,source,state,remaining)
      VALUES(${resourceId}::uuid,${householdId}::uuid,${randomUUID()}::uuid,'local-db',${state},${remaining})`;
    return { state, remaining, completeLocalScope };
  }));
}
export async function readDeletionProgress(db: Database, householdId: string, requestId: string,
  cursor?: Readonly<{ householdId: string; requestId: string; after: string }>) {
  if (cursor && (cursor.householdId !== householdId || cursor.requestId !== requestId
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(cursor.after)
    || Object.keys(cursor).sort().join(",") !== "after,householdId,requestId")) throw new DeletionJournalError("invalid");
  return db.withHousehold(householdId, async tx => {
    const request = await tx.householdDeletion.findFirst({ where: { id: requestId, householdId } });
    if (!request) return null;
    const resources = await tx.deletionResource.findMany({ where: { deletionId: requestId, householdId, ...(cursor ? { id: { gt: cursor.after } } : {}) }, orderBy: { id: "asc" }, take: 251,
      select: { id: true, component: true, observations: { orderBy: [{ observedAt: "desc" },{ id: "asc" }], take: 1, select: { source: true, state: true, remaining: true, retentionUntil: true } } } });
    return { state: request.state, requestedAt: request.requestedAt, undoUntil: request.undoUntil, fencedAt: request.fencedAt,
      irreversibleCompletedAt: request.completedAt, finalReceiptIssuable: false as const,
      providerErasure: "unverified" as const, backupExpiry: "unverified" as const, resources: resources.slice(0, 250), truncated: resources.length > 250,
      nextCursor: resources.length > 250 ? { householdId,requestId,after:resources[249]!.id } : null };
  });
}
/** Owner-facing status of the household's current (non-cancelled) deletion request.
 * Content-free: states, times and per-state resource counts only. The final receipt,
 * provider erasure and backup expiry are reported unverified until an independent
 * ADR-019 authority exists; nothing here can turn a request into an erasure claim. */
export async function readHouseholdDeletionStatus(db: Database, householdId: string) {
  return db.withHousehold(householdId, async tx => {
    const [r] = await tx.$queryRaw<Array<{ id: string; state: string; requested_at: Date; undo_until: Date; fenced_at: Date | null; completed_at: Date | null; now: Date }>>`
      SELECT id::text,state,requested_at,undo_until,fenced_at,completed_at,clock_timestamp() AS now FROM household_deletions
      WHERE household_id=${householdId}::uuid AND state<>'cancelled' ORDER BY requested_at DESC LIMIT 1`;
    if (!r) return { request: null, finalReceiptIssuable: false as const };
    const counts = await tx.$queryRaw<Array<{ state: string; n: bigint }>>`
      SELECT coalesce(o.state,'not-observed') AS state,count(*) AS n FROM deletion_resources d
      LEFT JOIN LATERAL (SELECT state FROM deletion_observations x WHERE x.resource_id=d.id ORDER BY observed_at DESC,id LIMIT 1) o ON true
      WHERE d.deletion_id=${r.id}::uuid AND d.household_id=${householdId}::uuid GROUP BY 1`;
    return { request: { id: r.id, state: r.state, requestedAt: r.requested_at, undoUntil: r.undo_until, fencedAt: r.fenced_at,
      undoAvailable: r.state === "grace" && r.undo_until > r.now },
      resources: Object.fromEntries(counts.map(c => [c.state, Number(c.n)])),
      finalReceiptIssuable: false as const, providerErasure: "unverified" as const, backupExpiry: "unverified" as const };
  });
}
