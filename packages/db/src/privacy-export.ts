import { PrivacyExportIdSchema as uuid, PrivacyExportSourceSchema as source, PrivacyExportCursorSchema as cursorSchema, PrivacyExportIntentSchema, type PrivacyExportCursor as Cursor } from "@autobureau/contracts";
import { currentActor, recordAudit } from "./audit.js";
import { outbox } from "./outbox.js";
import type { Database, ScopedClient } from "./scoped.js";
import { LocalExportSnapshotSchema, type LocalExportSnapshot } from "@autobureau/contracts";

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
