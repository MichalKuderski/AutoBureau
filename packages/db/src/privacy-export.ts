import { PrivacyExportIdSchema as uuid, PrivacyExportSourceSchema as source, PrivacyExportCursorSchema as cursorSchema, PrivacyExportIntentSchema, type PrivacyExportCursor as Cursor } from "@autobureau/contracts";
import { currentActor, recordAudit } from "./audit.js";
import { outbox } from "./outbox.js";
import type { Database, ScopedClient } from "./scoped.js";
import { LocalExportSnapshotSchema, type LocalExportSnapshot, ExportSnapshotV3Schema, type ExportSnapshotV3 } from "@autobureau/contracts";

const refuse = (): never => { throw new Error("Privacy export unavailable"); };
const limitations = Object.freeze(["original-documents", "identifier-reveal", "members-and-account", "audit-trail", "provider-data", "free-text-and-attributes", "consistent-snapshot", "zip-artifact"]);

async function owner(tx: ScopedClient, householdId: string) {
  const actor = currentActor();
  if (actor?.type !== "user") return refuse();
  await tx.$executeRaw`SELECT app.assert_household_open(${householdId}::uuid)`;
  const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id=${actor.userId}::uuid AND status='active' FOR SHARE`;
  if (active.length !== 1) return refuse();
  // Independent live membership read, never token metadata or request-supplied role.
  const member = await tx.householdUser.findFirst({ where: { householdId, userId: actor.userId, role: "owner" }, select: { userId: true } });
  if (!member) return refuse();
  return actor.userId;
}
async function intent(tx: ScopedClient, householdId: string, requestId: string) {
  const userId = await owner(tx, householdId);
  const row = await tx.outboxEvent.findFirst({ where: { householdId, eventType: "export.requested", aggregateType: "export", aggregateId: requestId }, select: { payload: true, createdAt: true } });
  const p = PrivacyExportIntentSchema.safeParse(row?.payload);
  if (!row || !p.success || p.data.requested_by !== userId) return refuse();
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const expiresAt = new Date(row.createdAt.getTime() + 72 * 3600_000);
  if (expiresAt <= clock!.now) return refuse();
  return { requestedAt: row.createdAt, expiresAt };
}

/** Local domain foundation. A future HTTP entry point MUST perform server-side
 * recent-auth, CSRF and rate-limit checks before establishing runAsUser. No route,
 * builder, signed URL or download is activated. An outbox intent is not an artifact.
 * Caller supplies an opaque idempotency UUID, never household authority. */
export async function requestOwnerExport(db: Database, householdId: string, requestId: string) {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(householdId).success) return refuse();
  householdId = householdId.toLowerCase(); requestId = requestId.toLowerCase();
  return db.withHousehold(householdId, async tx => {
    const userId = await owner(tx, householdId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`export:${householdId}:${requestId}`},0))`;
    const exists = await tx.outboxEvent.findFirst({ where: { householdId, eventType: "export.requested", aggregateType: "export", aggregateId: requestId }, select: { id: true } });
    if (!exists) {
      // Each build copies every retained original: at most three NEW requests per household
      // per rolling DB-clock day. The household lock serializes the count; replays of an
      // existing request stay idempotent above.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`export-quota:${householdId}`},0))`;
      const [recent] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM outbox_events WHERE household_id=${householdId}::uuid
        AND event_type='export.requested' AND aggregate_type='export' AND created_at>clock_timestamp()-interval '24 hours'`;
      if (Number(recent!.n) >= 3) return refuse();
      await outbox(tx).emit({ household_id: householdId, event_type: "export.requested", aggregate_type: "export", aggregate_id: requestId,
        payload: { version: 1, requested_by: userId } });
      await recordAudit(tx, "privacy.export_requested", { type: "export", id: requestId });
    }
    const time = await intent(tx, householdId, requestId);
    return { requestId, ...time, status: "requested" as const, artifactAvailable: false as const, complete: false as const, limitations };
  });
}

export async function readOwnerExportStatus(db: Database, householdId: string, requestId: string) {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(householdId).success) return refuse();
  householdId = householdId.toLowerCase(); requestId = requestId.toLowerCase();
  return db.withHousehold(householdId, async tx => ({ requestId, ...await intent(tx, householdId, requestId),
    status: "requested" as const, artifactAvailable: false as const, complete: false as const, limitations }));
}

/** Partial, bounded record projection for local tests. It is deliberately NOT the
 * F15 complete export or a consistent snapshot. IDs sort deterministically; cursor
 * is tied to the owner-checked intent and source. No attrs, secrets, object paths,
 * provider tokens, worker capabilities or arbitrary metadata are selected. */
export async function readOwnerExportPage(db: Database, householdId: string, requestId: string,
  table: "items" | "obligations", cursor?: Cursor) {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(householdId).success || !source.safeParse(table).success) return refuse();
  householdId = householdId.toLowerCase(); requestId = requestId.toLowerCase();
  if (cursor) {
    const c = cursorSchema.safeParse(cursor);
    if (!c.success || c.data.householdId !== householdId || c.data.requestId !== requestId || c.data.source !== table) return refuse();
  }
  return db.withHousehold(householdId, async tx => {
    const time = await intent(tx, householdId, requestId);
    const where = { householdId, ...(cursor ? { id: { gt: cursor.after } } : {}) };
    // Fixed scalar projection avoids hostile free-text/JSON size and credentials.
    const rows = table === "items"
      ? await tx.item.findMany({ where, orderBy: { id: "asc" }, take: 101, select: { id: true, kind: true, status: true, amountCents: true, currency: true, sourceDocumentId: true } })
      : await tx.obligation.findMany({ where, orderBy: { id: "asc" }, take: 101, select: { id: true, kind: true, status: true, amountCents: true, currency: true, sourceDocumentId: true, source: true, dueAt: true } });
    await recordAudit(tx, "privacy.export_page_read", { type: "export", id: requestId });
    return { requestId, ...time, records: rows.slice(0, 100).map(r => ({ ...r, amountCents: r.amountCents?.toString() ?? null })),
      nextCursor: rows.length > 100 ? { householdId, requestId, source: table, after: rows[99]!.id } : null,
      complete: false as const, artifactAvailable: false as const, limitations };
  });
}

/** One SQL statement = one PostgreSQL MVCC snapshot across every selected table.
 * No paginated live views are mislabeled a snapshot. 1001 rows per source is an
 * overflow sentinel, never truncation. The fixed projection bounds row width; no
 * network/file I/O occurs in the short tenant transaction. Scope is household,
 * explicitly NOT a full account/original-document export. */
export async function readOwnerExportSnapshot(db: Database, householdId: string, requestId: string): Promise<LocalExportSnapshot> {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(householdId).success) return refuse();
  householdId = householdId.toLowerCase(); requestId = requestId.toLowerCase();
  return db.withHousehold(householdId, async tx => {
    const userId = await owner(tx, householdId);
    // Admission/fence holds its shared advisory lock through this statement. Repeat
    // owner and intent checks IN this snapshot, not only in an earlier read.
    const result = await tx.$queryRaw<Array<{ snapshot: unknown }>>`
      SELECT jsonb_build_object(
        'version',2,'scope','household','complete',false,
        'householdId',${householdId}::text,'requestId',${requestId}::text,'ownerId',${userId}::text,
        'snapshotAt',statement_timestamp(),'expiresAt',e.created_at + interval '72 hours',
        'account',(SELECT jsonb_build_object('email',left(email,321),'status',status,'createdAt',created_at) FROM users WHERE id=${userId}::uuid AND status='active'),
        'profile',(SELECT jsonb_build_object('displayName',left(display_name,301),'locale',left(locale,36),'timezone',left(timezone,101),'country',country) FROM user_profiles WHERE user_id=${userId}::uuid),
        'household',(SELECT jsonb_build_object('name',left(name,301),'createdAt',created_at) FROM households WHERE id=${householdId}::uuid),
        'notificationPreferences',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.kind,s.channel),'[]') FROM
          (SELECT kind,channel,enabled FROM notification_preferences WHERE user_id=${userId}::uuid ORDER BY kind,channel LIMIT 1001) s),
        'notificationHistory',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM
          (SELECT id,kind,created_at AS "createdAt",read_at AS "readAt",target_id AS "targetId" FROM notifications WHERE household_id=${householdId}::uuid AND user_id=${userId}::uuid ORDER BY id LIMIT 1001) s),
        'activityHistory',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id::bigint),'[]') FROM
          (SELECT id::text,action,left(target_type,121) AS "targetType",target_id AS "targetId",created_at AS "createdAt" FROM audit_log
           WHERE household_id=${householdId}::uuid AND actor_id=${userId}::uuid AND action IN
             ('item.created','item.updated','item.deleted','obligation.created','obligation.completed','obligation.dismissed','obligation.reopened','obligation.snoozed','household.updated','member.created','member.updated','member.archived','member.restored','privacy.export_requested')
           ORDER BY id LIMIT 1001) s),
        'items',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM
          (SELECT id,member_id AS "memberId",kind,status,amount_cents::text AS "amountCents",currency,source_document_id AS "sourceDocumentId"
           FROM items WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 1001) s),
        'obligations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM
          (SELECT id,item_id AS "itemId",member_id AS "memberId",kind,status,amount_cents::text AS "amountCents",currency,source,source_document_id AS "sourceDocumentId",due_at AS "dueAt"
           FROM obligations WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 1001) s),
        'documents',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM
          (SELECT id,status,size_bytes::text AS "sizeBytes",source FROM documents WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 1001) s),
        'members',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM
          (SELECT id,kind,archived_at AS "archivedAt" FROM household_members WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 1001) s),
        'reminders',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM
          (SELECT id,obligation_id AS "obligationId",remind_at AS "remindAt",status FROM reminders WHERE household_id=${householdId}::uuid ORDER BY id LIMIT 1001) s),
        'documentWork',jsonb_build_object('version',1,
          'custody',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s."documentId"),'[]') FROM
            (SELECT document_id AS "documentId",state,review_at AS "reviewAt" FROM document_custodies WHERE household_id=${householdId}::uuid ORDER BY document_id LIMIT 1001) s),
          'processing',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s."documentId"),'[]') FROM
            (SELECT c.document_id AS "documentId",w.state,w.period_start AS "periodStart",w.charged_at AS "chargedAt" FROM document_processing w JOIN document_custodies c ON c.id=w.custody_id AND c.household_id=w.household_id WHERE w.household_id=${householdId}::uuid ORDER BY c.document_id LIMIT 1001) s)),
        'testSubscription',(SELECT jsonb_build_object('state',state,'plan',plan,'paidThrough',paid_through,'premiumUntil',premium_until,
          'mode','test','applicationEntitlementActivated',false,'reconciledAt',reconciled_at) FROM stripe_test_states WHERE household_id=${householdId}::uuid),
        'entitlements',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM
          (SELECT plan,docs_per_month AS "docsPerMonth",members_max AS "membersMax",docs_used_this_period AS "docsUsedThisPeriod" FROM entitlements WHERE household_id=${householdId}::uuid) s)
      ) AS snapshot
      FROM outbox_events e JOIN household_users h ON h.household_id=e.household_id AND h.user_id=${userId}::uuid AND h.role='owner'
      WHERE e.household_id=${householdId}::uuid AND e.event_type='export.requested' AND e.aggregate_type='export' AND e.aggregate_id=${requestId}::uuid
        AND e.payload=jsonb_build_object('version',1,'requested_by',${userId}::text) AND e.created_at+interval '72 hours'>statement_timestamp()
      LIMIT 2`;
    if (result.length !== 1) return refuse();
    const parsed = LocalExportSnapshotSchema.safeParse(result[0]!.snapshot);
    if (!parsed.success || parsed.data.documentWork===undefined) return refuse();
    await recordAudit(tx, "privacy.export_snapshot_read", { type: "export", id: requestId });
    return parsed.data;
  });
}

/** Export v3: every category the household ledger holds (names, free text, attributes,
 * extracted content, full household audit trail without internal metadata, safe
 * financial records), in ONE statement so every table is read from one MVCC snapshot.
 * 10,001 rows in any category is an overflow sentinel that refuses, never truncates.
 * Excluded by design: storage paths, internal error payloads, secret ciphertext/keys,
 * provider tokens/IDs, cursors and leases. Identifier values are counted, never read. */
export async function readOwnerExportSnapshotV3(db: Database, householdId: string, requestId: string): Promise<ExportSnapshotV3> {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(householdId).success) return refuse();
  householdId = householdId.toLowerCase(); requestId = requestId.toLowerCase();
  return db.withHousehold(householdId, async tx => {
    const userId = await owner(tx, householdId);
    const hh = householdId;
    const result = await tx.$queryRaw<Array<{ snapshot: unknown }>>`
      SELECT jsonb_build_object(
        'version',3,'scope','household','householdId',${hh}::text,'requestId',${requestId}::text,'ownerId',${userId}::text,
        'snapshotAt',statement_timestamp(),'expiresAt',e.created_at + interval '72 hours',
        'account',(SELECT jsonb_build_object('email',email,'status',status,'createdAt',created_at) FROM users WHERE id=${userId}::uuid AND status='active'),
        'profile',(SELECT jsonb_build_object('displayName',display_name,'locale',locale,'timezone',timezone,'country',country,'onboarding',onboarding) FROM user_profiles WHERE user_id=${userId}::uuid),
        'household',(SELECT jsonb_build_object('name',name,'emailAlias',email_alias,'createdAt',created_at) FROM households WHERE id=${hh}::uuid),
        'members',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,display_name AS "displayName",kind,date_of_birth::text AS "dateOfBirth",
          user_id IS NOT NULL AS "isAccountHolder",archived_at AS "archivedAt",created_at AS "createdAt" FROM household_members WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'items',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,member_id AS "memberId",kind,name,status,vendor_name AS "vendorName",attrs AS attributes,
          amount_cents::text AS "amountCents",currency,billing_cycle AS "billingCycle",valid_from::text AS "validFrom",expires_at::text AS "expiresAt",verified_at AS "verifiedAt",
          source_document_id AS "sourceDocumentId",created_at AS "createdAt",updated_at AS "updatedAt" FROM items WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'obligations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,item_id AS "itemId",member_id AS "memberId",title,kind,direction,status,priority::int,
          due_at AS "dueAt",window_start AS "windowStart",grace_until AS "graceUntil",amount_cents::text AS "amountCents",currency,recurrence,source,source_document_id AS "sourceDocumentId",
          ai_confidence::text AS "aiConfidence",outcome,verified_at AS "verifiedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM obligations WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'reminders',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,obligation_id AS "obligationId",remind_at AS "remindAt",offset_label AS "offsetLabel",status,sent_at AS "sentAt"
          FROM reminders WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'documents',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,source,mime_type AS "mediaType",size_bytes::text AS "sizeBytes",encode(sha256,'hex') AS sha256,
          status,doc_type AS "documentType",title,doc_date::text AS "documentDate",confidence::text AS confidence,extracted,review,processed_at AS "processedAt",created_at AS "createdAt"
          FROM documents WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'documentWork',jsonb_build_object('version',1,
          'custody',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s."documentId"),'[]') FROM
            (SELECT document_id AS "documentId",state,review_at AS "reviewAt" FROM document_custodies WHERE household_id=${hh}::uuid ORDER BY document_id LIMIT 1001) s),
          'processing',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s."documentId"),'[]') FROM
            (SELECT c.document_id AS "documentId",w.state,w.period_start AS "periodStart",w.charged_at AS "chargedAt" FROM document_processing w JOIN document_custodies c ON c.id=w.custody_id AND c.household_id=w.household_id WHERE w.household_id=${hh}::uuid ORDER BY c.document_id LIMIT 1001) s)),
        'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,kind,title,body,target_type AS "targetType",target_id AS "targetId",created_at AS "createdAt",read_at AS "readAt"
          FROM notifications WHERE household_id=${hh}::uuid AND user_id=${userId}::uuid ORDER BY id LIMIT 10001) s),
        'notificationPreferences',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.kind,s.channel),'[]') FROM (SELECT kind,channel,enabled FROM notification_preferences WHERE user_id=${userId}::uuid ORDER BY kind,channel LIMIT 10001) s),
        'auditTrail',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id::bigint),'[]') FROM (SELECT id::text,action,target_type AS "targetType",target_id AS "targetId",actor_type AS "actorType",created_at AS "createdAt"
          FROM audit_log WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'financialConnections',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,state,status_changed_at AS "statusChangedAt",created_at AS "createdAt" FROM plaid_local_items WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'financialAccounts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,item_id AS "connectionId",name,kind,currency,current_cents::text AS "currentCents",available_cents::text AS "availableCents",updated_at AS "updatedAt"
          FROM plaid_local_accounts WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'financialTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM (SELECT id,item_id AS "connectionId",account_id AS "accountId",posted_on::text AS "postedOn",amount_cents::text AS "amountCents",currency,description,pending,updated_at AS "updatedAt"
          FROM plaid_local_transactions WHERE household_id=${hh}::uuid ORDER BY id LIMIT 10001) s),
        'testSubscription',(SELECT jsonb_build_object('state',state,'plan',plan,'paidThrough',paid_through,'premiumUntil',premium_until,
          'mode','test','applicationEntitlementActivated',false,'reconciledAt',reconciled_at) FROM stripe_test_states WHERE household_id=${hh}::uuid),
        'entitlements',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM
          (SELECT plan,docs_per_month AS "docsPerMonth",members_max AS "membersMax",docs_used_this_period AS "docsUsedThisPeriod" FROM entitlements WHERE household_id=${hh}::uuid) s),
        'identifiers',jsonb_build_object('stored',(SELECT count(*) FROM item_secrets x JOIN items i ON i.id=x.item_id WHERE i.household_id=${hh}::uuid),'exported',0)
      ) AS snapshot
      FROM outbox_events e JOIN household_users h ON h.household_id=e.household_id AND h.user_id=${userId}::uuid AND h.role='owner'
      WHERE e.household_id=${hh}::uuid AND e.event_type='export.requested' AND e.aggregate_type='export' AND e.aggregate_id=${requestId}::uuid
        AND e.payload=jsonb_build_object('version',1,'requested_by',${userId}::text) AND e.created_at+interval '72 hours'>statement_timestamp()
      LIMIT 2`;
    if (result.length !== 1) return refuse();
    const parsed = ExportSnapshotV3Schema.safeParse(result[0]!.snapshot);
    if (!parsed.success) return refuse();
    await recordAudit(tx, "privacy.export_snapshot_read", { type: "export", id: requestId });
    return parsed.data;
  }, { timeoutMs: 15_000 });
}
/** Custody bindings for the owner's retained originals (clean custody only, never the
 * hostile quarantine copy). The object ID is used only to locate bytes; it never enters
 * the archive. Documents without a ready/held clean copy are reported, not skipped. */
export async function readOwnerExportOriginalRefs(db: Database, householdId: string, requestId: string) {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(householdId).success) return refuse();
  return db.withHousehold(householdId, async tx => {
    await intent(tx, householdId, requestId);
    const rows = await tx.$queryRaw<Array<{ document_id: string; status: string; mime_type: string; object_id: string | null; sha256: string | null; size_bytes: number | null; state: string | null }>>`
      SELECT d.id::text AS document_id,d.status::text,d.mime_type,c.object_id::text,encode(c.sha256,'hex') AS sha256,c.size_bytes,c.state
      FROM documents d LEFT JOIN document_custodies c ON c.document_id=d.id AND c.household_id=d.household_id
      WHERE d.household_id=${householdId}::uuid ORDER BY d.id LIMIT 10001`;
    if (rows.length > 10000) return refuse();
    return rows.map(r => ({ documentId: r.document_id, documentStatus: r.status, mediaType: r.mime_type,
      custody: r.object_id && r.sha256 && r.size_bytes && (r.state === "ready" || r.state === "held") ? { objectId: r.object_id, sha256: r.sha256, size: r.size_bytes } : null,
      custodyState: r.state }));
  });
}
/** Owner's most recent unexpired export request and its archive publication, if any. */
export async function readLatestOwnerExport(db: Database, householdId: string) {
  if (!uuid.safeParse(householdId).success) return refuse();
  return db.withHousehold(householdId, async tx => {
    const userId = await owner(tx, householdId);
    const [r] = await tx.$queryRaw<Array<{ request_id: string; created_at: Date; expires_at: Date; state: string | null; complete: boolean | null; size_bytes: number | null }>>`
      SELECT e.aggregate_id::text AS request_id,e.created_at,e.created_at+interval '72 hours' AS expires_at,a.state,a.complete,a.size_bytes
      FROM outbox_events e LEFT JOIN local_export_artifacts a ON a.household_id=e.household_id AND a.request_id=e.aggregate_id AND a.format='archive-v3'
      WHERE e.household_id=${householdId}::uuid AND e.event_type='export.requested' AND e.aggregate_type='export'
        AND e.payload=jsonb_build_object('version',1,'requested_by',${userId}::text) AND e.created_at+interval '72 hours'>clock_timestamp()
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1`;
    if (!r) return null;
    return { requestId: r.request_id, requestedAt: r.created_at, expiresAt: r.expires_at,
      state: r.state === null ? "requested" as const : r.state === "partial" ? "ready" as const : "revoked" as const,
      complete: r.complete ?? false, bytes: r.size_bytes };
  });
}
