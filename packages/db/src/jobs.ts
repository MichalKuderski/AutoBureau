import { randomUUID } from "node:crypto";
import { decodeJobEnvelope, encodeJobEnvelope, EventTypeSchema, JOB_EXECUTION_BUDGET, JOB_ROUTES, JobConsumerSchema, JobScopeSchema, jobQueue,
  type JobConsumer, type JobEnvelope, type JobQueue, type JobScope } from "@autobureau/contracts";
import { runAsSystem } from "./audit.js";
import type { Database, ScopedClient } from "./scoped.js";

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
          UNION
          SELECT d.household_id FROM job_deliveries d JOIN households h ON h.id = d.household_id
          WHERE d.transport_scope = ${scope} AND d.state = 'pending'
            AND d.available_at <= now() AND (d.lease_until IS NULL OR d.lease_until <= now())
            AND NOT EXISTS (SELECT 1 FROM job_inbox i WHERE i.delivery_id = d.id)
        ) pending ORDER BY household_id LIMIT 100`;
      return rows.map((r) => r.household_id);
    }, txOptions));
}

/** Fan-out and routing marker commit together. Routing is NOT delivery success. */
export async function routeOutboxBatch(db: Database, householdId: string, scope: JobScope): Promise<number> {
  JobScopeSchema.parse(scope);
  return runAsSystem("Materialize per-consumer staging delivery records", () => db.withHousehold(householdId, async (tx) => {
    if (!await tx.household.findUnique({ where: { id: householdId }, select: { id: true } })) return 0;
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
async function claimDelivery(db: Database, householdId: string, scope: JobScope): Promise<Claim | null> {
  return runAsSystem("Claim one staging outbox delivery lease", () => db.withHousehold(householdId, async (tx) => {
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
      await tx.jobDelivery.update({ where: { id: row.id }, data: { state: "exhausted", leaseToken: null, leaseUntil: null } }); return null;
    }
    const consumer = JobConsumerSchema.parse(row.consumer);
    const body = encodeJobEnvelope({ version: 1, event_id: row.event_id.toString(), household_id: householdId, event_type: row.event_type, consumer });
    decodeJobEnvelope(body);
    const token = randomUUID();
    await tx.jobDelivery.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(Date.now() + DISPATCH_LEASE_MS) } });
    return { id: row.id, token, body, queue: jobQueue(consumer), attempts: row.attempts + 1 };
  }, txOptions));
}

/** Exactly one network send, outside the two short database transactions. */
export async function dispatchOne(db: Database, householdId: string, scope: JobScope, transport: JobTransport): Promise<"idle" | "sent" | "retry" | "exhausted"> {
  JobScopeSchema.parse(scope);
  const claim = await claimDelivery(db, householdId, scope);
  if (!claim) return "idle";
  const signal = AbortSignal.timeout(DISPATCH_SEND_TIMEOUT_MS);
  let sent = false;
  try { await transport.send(claim.queue, claim.body, signal); sent = true; } catch { /* No provider error/body retained. */ }
  // A crash after send permits a duplicate. Only the inbox proves domain completion.
  await runAsSystem("Record staging outbox send outcome", () => db.withHousehold(householdId, async (tx) => {
    await tx.jobDelivery.updateMany({ where: { id: claim.id, leaseToken: claim.token }, data: {
      state: sent ? "sent" : claim.attempts >= JOB_SEND_ATTEMPTS ? "exhausted" : "pending", leaseToken: null, leaseUntil: null,
      ...(sent ? { sentAt: new Date() } : { availableAt: new Date(Date.now() + 15_000 * 2 ** (claim.attempts - 1)) }),
    } });
  }, txOptions));
  return sent ? "sent" : claim.attempts >= JOB_SEND_ATTEMPTS ? "exhausted" : "retry";
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
  return db.withHousehold(householdId, async (tx) => {
    const [counts] = await tx.$queryRaw<Array<{ deliveries: bigint; completed: bigint; pending: bigint; sent: bigint; exhausted: bigint; overdue: bigint }>>`
      SELECT count(*) AS deliveries, count(*) FILTER (WHERE i.id IS NOT NULL) AS completed,
        count(*) FILTER (WHERE i.id IS NULL AND d.state = 'pending') AS pending,
        count(*) FILTER (WHERE i.id IS NULL AND d.state = 'sent') AS sent,
        count(*) FILTER (WHERE i.id IS NULL AND d.state = 'exhausted') AS exhausted,
        count(*) FILTER (WHERE i.id IS NULL AND d.sent_at < now() - interval '7 days') AS overdue
      FROM job_deliveries d LEFT JOIN job_inbox i ON i.delivery_id = d.id
      WHERE d.household_id = ${householdId}::uuid AND d.transport_scope = ${scope}`;
    if (!counts) throw new JobError("unavailable");
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)]));
  }, txOptions);
}
