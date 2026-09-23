import { randomUUID } from "node:crypto";
import { decodeJobEnvelope, encodeJobEnvelope, EventTypeSchema, JOB_EXECUTION_BUDGET, JOB_ROUTES, JobConsumerSchema, JobScopeSchema, jobQueue,
  type JobConsumer, type JobEnvelope, type JobQueue, type JobScope } from "@autobureau/contracts";
import { runAsSystem, recordAudit } from "./audit.js";
import type { Database, ScopedClient } from "./scoped.js";
import { assertDocumentWorkOpen } from "./document-scans.js";

export const DISPATCH_SEND_TIMEOUT_MS = 10_000;
// Single send <=10s + DB wait/commit <=7s + 13s safety margin; crash recovery is bounded.
export const DISPATCH_LEASE_MS = 30_000;
export const JOB_DOMAIN_TIMEOUT_MS = JOB_EXECUTION_BUDGET.databaseTransactionMs;
export const JOB_DB_WAIT_MS = JOB_EXECUTION_BUDGET.databaseWaitMs;
export const JOB_SEND_ATTEMPTS = 3;
export class JobError extends Error {
  override name = "JobError";
  constructor(readonly code: "invalid" | "unavailable" | "handler-missing") { super(`Job transport: ${code}`); }
}
export interface JobTransport { send(queue: JobQueue, body: string, signal: AbortSignal): Promise<void> }
export interface JobEvent { id: bigint; eventType: JobEnvelope["event_type"]; aggregateType: string; aggregateId: string; householdId: string }
/** Domain writes and outbox intents ONLY. Slow/provider work needs a separate durable step. */
export type JobHandler = (tx: ScopedClient, event: JobEvent) => Promise<void>;
export type JobHandlers = Partial<Record<JobConsumer, JobHandler>>;
const txOptions = { timeoutMs: JOB_DOMAIN_TIMEOUT_MS, maxWaitMs: JOB_DB_WAIT_MS };

/** The sole cross-tenant discovery path: opaque household IDs only; no network I/O. */
export async function discoverJobHouseholds(db: Database, scope: JobScope): Promise<string[]> {
  JobScopeSchema.parse(scope);
  return runAsSystem("Discover staging outbox delivery work", () => db.unsafeAcrossAllHouseholds(
    "ADR-017 dispatcher: read only opaque household IDs for the exact transport scope", async (tx) => {
      const rows = await tx.$queryRaw<Array<{ household_id: string }>>`
        SELECT household_id FROM (
          SELECT e.household_id FROM outbox_events e JOIN households h ON h.id = e.household_id
          WHERE e.transport_scope = ${scope} AND e.routed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM household_deletions x WHERE x.household_id=e.household_id AND x.state IN ('fenced','verifying','completed'))
          UNION
          SELECT d.household_id FROM job_deliveries d JOIN households h ON h.id = d.household_id
          WHERE d.transport_scope = ${scope} AND d.state = 'pending'
            AND d.available_at <= now() AND (d.lease_until IS NULL OR d.lease_until <= now())
            AND NOT EXISTS (SELECT 1 FROM job_inbox i WHERE i.delivery_id = d.id)
            AND NOT EXISTS (SELECT 1 FROM household_deletions x WHERE x.household_id=d.household_id AND x.state IN ('fenced','verifying','completed'))
        ) pending ORDER BY household_id LIMIT 100`;
      return rows.map((r) => r.household_id);
    }, txOptions));
}

/** Fan-out and routing marker commit together. Routing is NOT delivery success. */
export async function routeOutboxBatch(db: Database, householdId: string, scope: JobScope): Promise<number> {
  JobScopeSchema.parse(scope);
  return runAsSystem("Materialize per-consumer staging delivery records", () => db.withHousehold(householdId, async (tx) => {
    if (!await tx.household.findUnique({ where: { id: householdId }, select: { id: true } })) return 0;
    await assertDocumentWorkOpen(tx, householdId);
    const rows = await tx.$queryRaw<Array<{ id: bigint; event_type: string }>>`
      SELECT id, event_type FROM outbox_events
      WHERE household_id = ${householdId}::uuid AND transport_scope = ${scope} AND routed_at IS NULL
      ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`;
    let created = 0;
    for (const row of rows) {
      const type = EventTypeSchema.safeParse(row.event_type);
      if (!type.success) throw new JobError("invalid");
      for (const consumer of JOB_ROUTES[type.data]) {
        await tx.jobDelivery.create({ data: { eventId: row.id, householdId, transportScope: scope, consumer } }); created++;
      }
      await tx.outboxEvent.update({ where: { id: row.id }, data: { routedAt: new Date() } });
    }
    return created;
  }, txOptions));
}
interface Claim { id: string; token: string; body: string; queue: JobQueue; attempts: number }
async function claimDelivery(db: Database, householdId: string, scope: JobScope): Promise<Claim | "exhausted" | null> {
  return runAsSystem("Claim one staging outbox delivery lease", () => db.withHousehold(householdId, async (tx) => {
    await assertDocumentWorkOpen(tx, householdId);
    const [row] = await tx.$queryRaw<Array<{ id: string; event_id: bigint; consumer: string; event_type: string; attempts: number }>>`
      SELECT d.id, d.event_id, d.consumer, e.event_type, d.attempts
      FROM job_deliveries d JOIN outbox_events e ON e.id = d.event_id JOIN households h ON h.id = d.household_id
      WHERE d.household_id = ${householdId}::uuid AND d.transport_scope = ${scope}
        AND e.household_id = d.household_id AND e.transport_scope = d.transport_scope
        AND d.state = 'pending' AND d.available_at <= now() AND (d.lease_until IS NULL OR d.lease_until <= now())
        AND NOT EXISTS (SELECT 1 FROM job_inbox i WHERE i.delivery_id = d.id)
      ORDER BY d.created_at, d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`;
    if (!row) return null;
    // A crash on the final send leaves a lease; its expiry must not strand pending/3.
    if (row.attempts >= JOB_SEND_ATTEMPTS) {
      await tx.jobDelivery.update({ where: { id: row.id }, data: { state: "exhausted", leaseToken: null, leaseUntil: null } }); return "exhausted";
    }
    const consumer = JobConsumerSchema.parse(row.consumer);
    const body = encodeJobEnvelope({ version: 1, event_id: row.event_id.toString(), household_id: householdId, event_type: row.event_type, consumer });
    decodeJobEnvelope(body);
    const token = randomUUID();
    // Lease authority uses database time, not the potentially skewed runtime clock.
    await tx.$executeRaw`UPDATE job_deliveries SET attempts = attempts + 1,
      lease_token = ${token}::uuid,
      lease_until = clock_timestamp() + (${DISPATCH_LEASE_MS} * interval '1 millisecond')
      WHERE id = ${row.id}::uuid AND household_id = ${householdId}::uuid AND transport_scope = ${scope}`;
    await recordAudit(tx, "job.lease_claimed", { type: "job_delivery", id: row.id });
    return { id: row.id, token, body, queue: jobQueue(consumer), attempts: row.attempts + 1 };
  }, txOptions));
}

/** Exactly one network send, outside the two short database transactions. */
export async function dispatchOne(db: Database, householdId: string, scope: JobScope, transport: JobTransport): Promise<"idle" | "sent" | "retry" | "exhausted" | "lease-lost"> {
  JobScopeSchema.parse(scope);
  const claim = await claimDelivery(db, householdId, scope);
  if (!claim) return "idle";
  if (claim === "exhausted") return "exhausted";
  const signal = AbortSignal.timeout(DISPATCH_SEND_TIMEOUT_MS);
  let sent = false;
  let onAbort: (() => void) | undefined;
  try {
    const expired = new Promise<never>((_, reject) => {
      onAbort = () => reject(new JobError("unavailable"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    await Promise.race([Promise.resolve().then(() => transport.send(claim.queue, claim.body, signal)), expired]);
    sent = !signal.aborted;
  } catch { /* No provider error/body retained. A late transport send may duplicate, never complete a domain effect. */ }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
  // A crash after send permits a duplicate. Only the inbox proves domain completion.
  const recorded = await runAsSystem("Record staging outbox send outcome", () => db.withHousehold(householdId, async (tx) => {
    // Acquire the row first, then check expiry using current database time. A
    // timestamp captured before a lock wait could otherwise accept an expired lease.
    const [owned] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM job_deliveries WHERE id = ${claim.id}::uuid
        AND household_id = ${householdId}::uuid AND transport_scope = ${scope}
        AND state = 'pending' AND lease_token = ${claim.token}::uuid FOR UPDATE`;
    if (!owned) return 0;
    const state = sent ? "sent" : claim.attempts >= JOB_SEND_ATTEMPTS ? "exhausted" : "pending";
    const backoffMs = 15_000 * 2 ** (claim.attempts - 1);
    const count = await tx.$executeRaw`UPDATE job_deliveries SET state = ${state}, lease_token = NULL, lease_until = NULL,
      sent_at = CASE WHEN ${sent} THEN clock_timestamp() ELSE sent_at END,
      available_at = CASE WHEN ${sent} THEN available_at ELSE clock_timestamp() + (${backoffMs} * interval '1 millisecond') END
      WHERE id = ${claim.id}::uuid AND household_id = ${householdId}::uuid AND transport_scope = ${scope}
        AND state = 'pending' AND lease_token = ${claim.token}::uuid AND lease_until > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM household_deletions x WHERE x.household_id=${householdId}::uuid AND x.state IN ('fenced','verifying','completed'))`;
    if (count === 1) await recordAudit(tx, "job.send_recorded", { type: "job_delivery", id: claim.id });
    return count;
  }, txOptions));
  if (recorded !== 1) return "lease-lost";
  return sent ? "sent" : claim.attempts >= JOB_SEND_ATTEMPTS ? "exhausted" : "retry";
}

/** One explicit household, at most 50 routed intents and one send. No scheduler,
 * discovery loop, automatic repair or DLQ replay. Existing durable leases/inboxes
 * remain authoritative across crashes and concurrent invocations. */
export async function runHouseholdDispatchOnce(db: Database, householdId: string, scope: JobScope, transport: JobTransport) {
  const before = await reconcileJobDeliveries(db, householdId, scope);
  if (["unknown_events", "missing_deliveries", "unexpected_deliveries", "orphaned_events", "fenced_events"].some(key => before[key] !== 0)) {
    return { status: "blocked" as const, routed: 0, reconciliation: before };
  }
  const routed = await routeOutboxBatch(db, householdId, scope);
  const status = await dispatchOne(db, householdId, scope, transport);
  return { status, routed, reconciliation: await reconcileJobDeliveries(db, householdId, scope) };
}
export type ConsumeResult = "completed" | "duplicate" | "refused";
/** No ordering assumption: each handler rereads current authoritative domain rows. */
export async function consumeDelivery(db: Database, scope: JobScope, queue: JobQueue, body: string, handlers: JobHandlers): Promise<ConsumeResult> {
  JobScopeSchema.parse(scope);
  let envelope: JobEnvelope;
  try { envelope = decodeJobEnvelope(body); } catch { throw new JobError("invalid"); }
  if (jobQueue(envelope.consumer) !== queue) return "refused";
  return runAsSystem("Commit one idempotent staging job effect", () => db.withHousehold(envelope.household_id, async (tx) => {
    if (!await tx.household.findUnique({ where: { id: envelope.household_id }, select: { id: true } })) return "refused";
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-fence:${envelope.household_id}`},0))`;
    if (await tx.householdDeletion.count({ where: { householdId: envelope.household_id, state: { in: ["fenced", "verifying", "completed"] } } })) return "refused";
    const [delivery] = await tx.$queryRaw<Array<{ id: string; transport_scope: string; household_id: string }>>`
      SELECT id, transport_scope, household_id FROM job_deliveries WHERE event_id = ${BigInt(envelope.event_id)} AND consumer = ${envelope.consumer}`;
    if (!delivery || delivery.transport_scope !== scope || delivery.household_id !== envelope.household_id) return "refused";
    // Serialize this logical consumer without granting the runtime UPDATE on delivery authority.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${delivery.id}, 0))`;
    const event = await tx.outboxEvent.findUnique({ where: { id: BigInt(envelope.event_id) }, select: {
      id: true, eventType: true, aggregateType: true, aggregateId: true, householdId: true, transportScope: true,
    } });
    if (!event || event.householdId !== envelope.household_id || event.transportScope !== scope || event.eventType !== envelope.event_type) return "refused";
    if (await tx.jobInbox.findUnique({ where: { deliveryId: delivery.id } })) return "duplicate";
    const handler = handlers[envelope.consumer];
    if (!handler) throw new JobError("handler-missing");
    await handler(tx, { id: event.id, eventType: envelope.event_type, aggregateType: event.aggregateType, aggregateId: event.aggregateId, householdId: envelope.household_id });
    await tx.jobInbox.create({ data: { deliveryId: delivery.id, householdId: envelope.household_id } });
    return "completed";
  }, txOptions));
}

/** Read-only accounting; never automatically replays DLQ/exhausted work. */
export async function reconcileJobDeliveries(db: Database, householdId: string, scope: JobScope) {
  JobScopeSchema.parse(scope);
  // Use the same closed routing contract as dispatch, not a second SQL routing table.
  const routes = JSON.stringify(Object.entries(JOB_ROUTES).flatMap(([event_type, consumers]) =>
    consumers.map((consumer) => ({ event_type, consumer }))));
  return db.withHousehold(householdId, async (tx) => {
    // One statement gives delivery totals and routing comparisons the same snapshot.
    // This observes drift; it cannot repair, requeue or authorize provider effects.
    const [counts] = await tx.$queryRaw<Array<{ deliveries: bigint; completed: bigint; pending: bigint; sent: bigint; exhausted: bigint; overdue: bigint; unrouted: bigint; orphaned_events: bigint; fenced_events: bigint; unknown_events: bigint; missing_deliveries: bigint; unexpected_deliveries: bigint; expired_leases: bigint }>>`
      WITH routes AS (
        SELECT * FROM jsonb_to_recordset(${routes}::jsonb) AS r(event_type text, consumer text)
      ), events AS (
        SELECT id, event_type, routed_at FROM outbox_events
        WHERE household_id = ${householdId}::uuid AND transport_scope = ${scope}
          AND EXISTS (SELECT 1 FROM households WHERE id = ${householdId}::uuid)
      ), deliveries AS (
        SELECT d.*, i.id IS NOT NULL AS completed FROM job_deliveries d
        LEFT JOIN job_inbox i ON i.delivery_id = d.id
        WHERE d.household_id = ${householdId}::uuid AND d.transport_scope = ${scope}
      )
      SELECT
        (SELECT count(*) FROM events WHERE EXISTS (SELECT 1 FROM household_deletions x WHERE x.household_id=${householdId}::uuid AND x.state IN ('fenced','verifying','completed'))) AS fenced_events,
        (SELECT count(*) FROM deliveries) AS deliveries,
        (SELECT count(*) FROM deliveries WHERE completed) AS completed,
        (SELECT count(*) FROM deliveries WHERE NOT completed AND state = 'pending') AS pending,
        (SELECT count(*) FROM deliveries WHERE NOT completed AND state = 'sent') AS sent,
        (SELECT count(*) FROM deliveries WHERE NOT completed AND state = 'exhausted') AS exhausted,
        (SELECT count(*) FROM deliveries WHERE NOT completed AND sent_at < now() - interval '7 days') AS overdue,
        (SELECT count(*) FROM outbox_events WHERE household_id = ${householdId}::uuid
          AND transport_scope = ${scope} AND NOT EXISTS (
            SELECT 1 FROM households WHERE id = ${householdId}::uuid)) AS orphaned_events,
        (SELECT count(*) FROM events WHERE routed_at IS NULL) AS unrouted,
        (SELECT count(*) FROM events e WHERE NOT EXISTS (
          SELECT 1 FROM routes r WHERE r.event_type = e.event_type)) AS unknown_events,
        (SELECT count(*) FROM events e JOIN routes r ON r.event_type = e.event_type
          WHERE e.routed_at IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM job_deliveries d WHERE d.event_id = e.id AND d.consumer = r.consumer
              AND d.household_id = ${householdId}::uuid AND d.transport_scope = ${scope})) AS missing_deliveries,
        (SELECT count(*) FROM job_deliveries d
          WHERE d.household_id = ${householdId}::uuid AND d.transport_scope = ${scope}
            AND NOT EXISTS (SELECT 1 FROM events e JOIN routes r ON r.event_type = e.event_type
              WHERE e.id = d.event_id AND e.routed_at IS NOT NULL AND r.consumer = d.consumer)) AS unexpected_deliveries,
        (SELECT count(*) FROM job_deliveries d
          WHERE d.household_id = ${householdId}::uuid AND d.transport_scope = ${scope}
            AND d.state = 'pending' AND d.lease_until <= now()
            AND NOT EXISTS (SELECT 1 FROM job_inbox i WHERE i.delivery_id = d.id)) AS expired_leases`;
    if (!counts) throw new JobError("unavailable");
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)]));
  }, txOptions);
}
