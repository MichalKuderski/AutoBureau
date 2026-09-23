import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeJobEnvelope, type JobConsumer, type JobScope } from "@autobureau/contracts";
import { Database } from "../../src/scoped.js";
import { consumeDelivery, discoverJobHouseholds, dispatchOne, reconcileJobDeliveries, routeOutboxBatch, runHouseholdDispatchOnce, type JobHandler } from "../../src/jobs.js";
import { runAsSystem } from "../../src/audit.js";
import { outbox, stagingOutboxScope } from "../../src/outbox.js";
import { ADMIN_URL, APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";
let admin: PrismaClient, worker: PrismaClient, dispatcher: PrismaClient, app: PrismaClient;
let workerDb: Database, dispatcherDb: Database, appDb: Database;
const user = randomUUID(), households: string[] = [];
function roleUrl(role: string, password: string) { const u = new URL(ADMIN_URL); u.username = role; u.password = password; return u.toString(); }
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient();
  await admin.$executeRawUnsafe("ALTER ROLE app_job_worker LOGIN PASSWORD 'worker_local_only'");
  await admin.$executeRawUnsafe("ALTER ROLE app_dispatcher LOGIN PASSWORD 'dispatcher_local_only'");
  worker = new PrismaClient({ datasourceUrl: roleUrl("app_job_worker", "worker_local_only") });
  dispatcher = new PrismaClient({ datasourceUrl: roleUrl("app_dispatcher", "dispatcher_local_only") });
  app = new PrismaClient({ datasourceUrl: APP_URL });
  workerDb = new Database(worker); dispatcherDb = new Database(dispatcher); appDb = new Database(app);
  await admin.user.create({ data: { id: user, email: `${user}@example.test` } });
}, 120_000);
afterAll(async () => {
  if (admin) {
    await admin.auditLog.deleteMany({ where: { householdId: { in: households } } });
    await admin.outboxEvent.deleteMany({ where: { householdId: { in: households } } });
    await admin.household.deleteMany({ where: { id: { in: households } } });
    await admin.user.delete({ where: { id: user } });
    await admin.$executeRawUnsafe("ALTER ROLE app_job_worker NOLOGIN PASSWORD NULL");
    await admin.$executeRawUnsafe("ALTER ROLE app_dispatcher NOLOGIN PASSWORD NULL");
    expect(await admin.jobDelivery.count({ where: { householdId: { in: households } } })).toBe(0);
    expect(await admin.jobInbox.count({ where: { householdId: { in: households } } })).toBe(0);
  }
  await Promise.all([admin?.$disconnect(), worker?.$disconnect(), dispatcher?.$disconnect(), app?.$disconnect()]);
});
async function fixture(type = "document.processed", scope: JobScope = "stg") {
  const hh = randomUUID(); households.push(hh);
  await admin.household.create({ data: { id: hh, name: "Synthetic job fixture", createdBy: user } });
  const event = await admin.outboxEvent.create({ data: { householdId: hh, aggregateId: randomUUID(), aggregateType: "document", eventType: type, transportScope: scope, payload: {} } });
  return { hh, event };
}
const body = (f: Awaited<ReturnType<typeof fixture>>, consumer: JobConsumer) => encodeJobEnvelope({ version: 1, event_id: f.event.id.toString(), household_id: f.hh, event_type: f.event.eventType, consumer });
const effect: JobHandler = async (tx, e) => { await outbox(tx).emit({ event_type: "notification.requested", aggregate_type: "job-test", aggregate_id: e.aggregateId, household_id: e.householdId }); };
const countEffects = (hh: string) => workerDb.withHousehold(hh, (tx) => tx.outboxEvent.count({ where: { aggregateType: "job-test" } }));
describe("durable per-consumer staging jobs", () => {
  it("stamps only exact staging hosting scopes; Production and legacy remain unrouted", () => {
    for (const VERCEL_ENV of ["production", "preview"]) expect(stagingOutboxScope({ AUTH_ISSUER: "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1", VERCEL_ENV })).toBe(VERCEL_ENV === "production" ? "stg" : "preview");
    for (const env of [{}, { VERCEL_ENV: "production", AUTH_ISSUER: "https://hdoknvqnjyttondgidvi.supabase.co/auth/v1" }, { VERCEL_ENV: "development", AUTH_ISSUER: "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1" }]) expect(stagingOutboxScope(env)).toBeNull();
  });
  it("materializes fan-out atomically and once, independently per consumer", async () => {
    const f = await fixture();
    expect(await Promise.all([routeOutboxBatch(dispatcherDb, f.hh, "stg"), routeOutboxBatch(dispatcherDb, f.hh, "stg")])).toEqual(expect.arrayContaining([2, 0]));
    expect(await routeOutboxBatch(dispatcherDb, f.hh, "stg")).toBe(0);
    expect(await consumeDelivery(workerDb, "stg", "notifications", body(f, "notifications"), { notifications: effect })).toBe("completed");
    expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ deliveries: 2, completed: 1, pending: 1 });
    expect(await consumeDelivery(workerDb, "stg", "pipeline", body(f, "analytics"), { analytics: effect })).toBe("completed");
    expect(await countEffects(f.hh)).toBe(2);
  });
  it("concurrent duplicate delivery commits one effect, inbox and audit sequence", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    const before = await admin.auditLog.count({ where: { householdId: f.hh } });
    const run = () => consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), { pipeline: effect });
    expect((await Promise.all([run(), run(), run()])).sort()).toEqual(["completed", "duplicate", "duplicate"]);
    expect(await countEffects(f.hh)).toBe(1);
    expect(await workerDb.withHousehold(f.hh, (tx) => tx.jobInbox.count())).toBe(1);
    expect(await admin.auditLog.count({ where: { householdId: f.hh } })).toBe(before + 2);
  });
  it("crash before domain commit rolls back effect/inbox/audit and permits recovery", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    const before = await admin.auditLog.count({ where: { householdId: f.hh } });
    await expect(consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), { pipeline: async (tx, e) => { await effect(tx, e); throw new Error("synthetic crash"); } })).rejects.toThrow("synthetic crash");
    expect(await countEffects(f.hh)).toBe(0); expect(await admin.auditLog.count({ where: { householdId: f.hh } })).toBe(before);
    expect(await consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), { pipeline: effect })).toBe("completed");
  });
  it("crash after domain commit/before broker acknowledgement replays as duplicate", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), { pipeline: effect });
    expect(await consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), {})).toBe("duplicate");
    expect(await countEffects(f.hh)).toBe(1);
  });
  it("crash after send/before delivery commit is retried without repeating an effect", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    const sent: string[] = []; let transactions = 0;
    const crashing = new Proxy(dispatcherDb, { get(target, key) {
      if (key === "withHousehold") return (...args: Parameters<Database["withHousehold"]>) => { if (++transactions === 2) throw new Error("after-send crash"); return target.withHousehold(...args); };
      return Reflect.get(target, key);
    } });
    const transport = { send: async (_queue: unknown, data: string) => { sent.push(data); } };
    await expect(dispatchOne(crashing, f.hh, "stg", transport)).rejects.toThrow("after-send crash");
    expect(sent).toHaveLength(1);
    // Lease expiry is advanced only on the exact synthetic row, rather than waiting 30 seconds.
    await admin.jobDelivery.updateMany({ where: { eventId: f.event.id }, data: { leaseUntil: new Date(0) } });
    expect(await dispatchOne(dispatcherDb, f.hh, "stg", transport)).toBe("sent"); expect(sent).toHaveLength(2);
    for (const data of sent) await consumeDelivery(workerDb, "stg", "pipeline", data, { pipeline: effect });
    expect(await countEffects(f.hh)).toBe(1);
  });
  it("does not send while a lease is live; caps retries and records exhaustion", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg"); let sends = 0;
    const transport = { send: async () => { sends++; throw new Error("synthetic send failure"); } };
    for (let i = 0; i < 3; i++) {
      await admin.jobDelivery.updateMany({ where: { eventId: f.event.id }, data: { availableAt: new Date(0) } });
      expect(await dispatchOne(dispatcherDb, f.hh, "stg", transport)).toBe(i === 2 ? "exhausted" : "retry");
    }
    expect(await dispatchOne(dispatcherDb, f.hh, "stg", transport)).toBe("idle"); expect(sends).toBe(3);
    expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ exhausted: 1 });
  });
  it("isolates tenant/scope/queue and refuses forged, missing or deleted work", async () => {
    const a = await fixture("document.uploaded"), b = await fixture("document.uploaded", "preview");
    await routeOutboxBatch(dispatcherDb, a.hh, "stg"); await routeOutboxBatch(dispatcherDb, b.hh, "preview");
    expect(await routeOutboxBatch(dispatcherDb, a.hh, "preview")).toBe(0);
    expect(await consumeDelivery(workerDb, "preview", "pipeline", body(a, "pipeline"), { pipeline: effect })).toBe("refused");
    expect(await consumeDelivery(workerDb, "stg", "notifications", body(a, "pipeline"), { pipeline: effect })).toBe("refused");
    expect(await consumeDelivery(workerDb, "stg", "pipeline", body(a, "pipeline").replace(a.hh, b.hh), { pipeline: effect })).toBe("refused");
    expect(await workerDb.withHousehold(a.hh, (tx) => tx.jobDelivery.findMany({ where: { householdId: b.hh } }))).toEqual([]);
    expect(await worker.jobDelivery.findMany()).toEqual([]);
    await admin.household.delete({ where: { id: a.hh } });
    expect(await consumeDelivery(workerDb, "stg", "pipeline", body(a, "pipeline"), { pipeline: effect })).toBe("refused");
  });
  it("reordered events reread current state and do not depend on broker order", async () => {
    const f = await fixture("document.uploaded");
    const e2 = await admin.outboxEvent.create({ data: { householdId: f.hh, aggregateId: f.event.aggregateId, aggregateType: "document", eventType: "document.uploaded", transportScope: "stg", payload: {} } });
    await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    const observed: string[] = [];
    const handler: JobHandler = async (tx) => { observed.push((await tx.household.findUniqueOrThrow({ where: { id: f.hh } })).name); };
    await admin.household.update({ where: { id: f.hh }, data: { name: "Current authoritative state" } });
    await consumeDelivery(workerDb, "stg", "pipeline", body({ hh: f.hh, event: e2 }, "pipeline"), { pipeline: handler });
    await consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), { pipeline: handler });
    expect(observed).toEqual(["Current authoritative state", "Current authoritative state"]);
  });
  it("request role cannot forge inbox/delivery success and runtime cannot administer authority", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    const d = await admin.jobDelivery.findFirstOrThrow({ where: { eventId: f.event.id } });
    await expect(runAsSystem("Test unprivileged receipt forgery refusal", () => appDb.withHousehold(f.hh, (tx) => tx.jobInbox.create({ data: { householdId: f.hh, deliveryId: d.id } })))).rejects.toThrow();
    await expect(runAsSystem("Test worker delivery authority refusal", () => workerDb.withHousehold(f.hh, (tx) => tx.jobDelivery.update({ where: { id: d.id }, data: { state: "sent" } })))).rejects.toThrow();
    await expect(runAsSystem("Test inbox erasure refusal", () => workerDb.withHousehold(f.hh, (tx) => tx.jobInbox.deleteMany()))).rejects.toThrow();
    const flags = await worker.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }>>`SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
    expect(flags[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  });
  it("discovers only existing households in the exact transport scope", async () => {
    const f = await fixture("document.uploaded", "preview");
    expect(await discoverJobHouseholds(dispatcherDb, "preview")).toContain(f.hh);
    expect(await discoverJobHouseholds(dispatcherDb, "stg")).not.toContain(f.hh);
    expect(await discoverJobHouseholds(appDb, "preview")).toEqual([]);
  });
  it("distinguishes unrouted intent from missing committed fan-out without repairing either", async () => {
    const f = await fixture();
    expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ deliveries: 0, unrouted: 1, missing_deliveries: 0 });
    await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await admin.jobDelivery.deleteMany({ where: { eventId: f.event.id, consumer: "analytics" } });
    const before = await admin.auditLog.count({ where: { householdId: f.hh } });
    for (let i = 0; i < 2; i++) expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({
      deliveries: 1, pending: 1, unrouted: 0, missing_deliveries: 1, unexpected_deliveries: 0, unknown_events: 0,
    });
    expect(await admin.jobDelivery.count({ where: { eventId: f.event.id } })).toBe(1);
    expect(await admin.auditLog.count({ where: { householdId: f.hh } })).toBe(before);
  });
  it("detects unknown events and unauthorized consumer routes without exposing payloads", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await admin.jobDelivery.create({ data: { eventId: f.event.id, householdId: f.hh, transportScope: "stg", consumer: "analytics" } });
    await admin.outboxEvent.create({ data: { householdId: f.hh, aggregateId: randomUUID(), aggregateType: "synthetic", eventType: "unknown.synthetic", transportScope: "stg", payload: { canary: "must-not-return" } } });
    const result = await reconcileJobDeliveries(workerDb, f.hh, "stg");
    expect(result).toMatchObject({ deliveries: 2, unexpected_deliveries: 1, unknown_events: 1, unrouted: 1 });
    expect(Object.values(result).every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("must-not-return");
  });
  it("detects expired dispatcher leases and overdue sends but excludes completed effects", async () => {
    const f = await fixture(); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await admin.jobDelivery.updateMany({ where: { eventId: f.event.id, consumer: "analytics" }, data: { leaseUntil: new Date(0), leaseToken: randomUUID() } });
    await admin.jobDelivery.updateMany({ where: { eventId: f.event.id, consumer: "notifications" }, data: { state: "sent", sentAt: new Date(0) } });
    expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ expired_leases: 1, overdue: 1 });
    await consumeDelivery(workerDb, "stg", "pipeline", body(f, "analytics"), { analytics: effect });
    await consumeDelivery(workerDb, "stg", "notifications", body(f, "notifications"), { notifications: effect });
    expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ completed: 2, expired_leases: 0, overdue: 0, missing_deliveries: 0 });
  });
  it("counts cross-environment corruption as missing in its authority scope and unexpected in the other", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await admin.jobDelivery.updateMany({ where: { eventId: f.event.id }, data: { transportScope: "preview" } });
    expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ deliveries: 0, missing_deliveries: 1 });
    expect(await reconcileJobDeliveries(workerDb, f.hh, "preview")).toMatchObject({ deliveries: 1, unexpected_deliveries: 1, missing_deliveries: 0 });
    const unrelated = await fixture("document.uploaded", "preview");
    expect(await reconcileJobDeliveries(workerDb, unrelated.hh, "stg")).toMatchObject({ deliveries: 0, unrouted: 0, missing_deliveries: 0, unexpected_deliveries: 0 });
  });
  it("reports retained outbox intent after deletion without treating it as dispatchable work", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await admin.household.delete({ where: { id: f.hh } });
    const { orphaned_events, ...active } = await reconcileJobDeliveries(workerDb, f.hh, "stg");
    expect(orphaned_events).toBe(1);
    expect(Object.values(active).every((n) => n === 0)).toBe(true);
    expect(await discoverJobHouseholds(dispatcherDb, "stg")).not.toContain(f.hh);
  });
  it("runs one bounded invocation with durable fan-out and one network send outside transactions", async () => {
    const f = await fixture(); let depth = 0; const sent: string[] = [];
    const observed = new Proxy(dispatcherDb, { get(target, key) {
      if (key === "withHousehold") return async (...args: Parameters<Database["withHousehold"]>) => {
        depth++; try { return await target.withHousehold(...args); } finally { depth--; }
      };
      return Reflect.get(target, key);
    } });
    const transport = { send: async (_queue: unknown, data: string) => { expect(depth).toBe(0); sent.push(data); } };
    const first = await runHouseholdDispatchOnce(observed, f.hh, "stg", transport);
    expect(first).toMatchObject({ status: "sent", routed: 2, reconciliation: { deliveries: 2, sent: 1, pending: 1 } });
    expect(sent).toHaveLength(1);
    expect(await runHouseholdDispatchOnce(observed, f.hh, "stg", transport)).toMatchObject({ status: "sent", routed: 0 });
    expect(new Set(sent).size).toBe(2);
    expect(await runHouseholdDispatchOnce(observed, f.hh, "stg", transport)).toMatchObject({ status: "idle", routed: 0 });
  });
  it("concurrent invocations claim separate deliveries without duplicate fan-out", async () => {
    const f = await fixture(); const sent: string[] = [];
    const transport = { send: async (_queue: unknown, data: string) => { sent.push(data); } };
    await Promise.all([runHouseholdDispatchOnce(dispatcherDb, f.hh, "stg", transport), runHouseholdDispatchOnce(dispatcherDb, f.hh, "stg", transport)]);
    expect(await admin.jobDelivery.count({ where: { eventId: f.event.id } })).toBe(2);
    expect(sent).toHaveLength(2); expect(new Set(sent).size).toBe(2);
  });
  it.each(["unknown", "missing", "unexpected", "deleted"])("blocks %s work without sending or silently repairing", async condition => {
    const f = await fixture(condition === "unknown" ? "unknown.synthetic" : "document.uploaded");
    if (condition !== "unknown") await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    if (condition === "missing") await admin.jobDelivery.deleteMany({ where: { eventId: f.event.id } });
    if (condition === "unexpected") await admin.jobDelivery.create({ data: { eventId: f.event.id, householdId: f.hh, transportScope: "stg", consumer: "analytics" } });
    if (condition === "deleted") await admin.household.delete({ where: { id: f.hh } });
    let sent = 0; const before = await admin.auditLog.count({ where: { householdId: f.hh } });
    expect(await runHouseholdDispatchOnce(dispatcherDb, f.hh, "stg", { send: async () => { sent++; } })).toMatchObject({ status: "blocked", routed: 0 });
    expect(sent).toBe(0); expect(await admin.auditLog.count({ where: { householdId: f.hh } })).toBe(before);
  });
  it.each(["expired", "replaced"])("cannot report durable send success with a %s lease", async condition => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    let sent = 0;
    const transport = { send: async () => {
      sent++;
      await admin.jobDelivery.updateMany({ where: { eventId: f.event.id }, data: condition === "expired"
        ? { leaseUntil: new Date(0) } : { leaseToken: randomUUID() } });
    } };
    expect(await dispatchOne(dispatcherDb, f.hh, "stg", transport)).toBe("lease-lost");
    expect(sent).toBe(1);
    expect(await admin.jobDelivery.findFirst({ where: { eventId: f.event.id } })).toMatchObject({ state: "pending", sentAt: null });
  });
  it("records exhaustion after a crash on the final lease without a fourth send", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    await admin.jobDelivery.updateMany({ where: { eventId: f.event.id }, data: { attempts: 3, leaseToken: randomUUID(), leaseUntil: new Date(0) } });
    let sent = 0;
    expect(await dispatchOne(dispatcherDb, f.hh, "stg", { send: async () => { sent++; } })).toBe("exhausted");
    expect(sent).toBe(0); expect(await reconcileJobDeliveries(workerDb, f.hh, "stg")).toMatchObject({ exhausted: 1, expired_leases: 0 });
  });
  it("bounds an uncooperative transport and never records a late resolution as sent", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    const controller = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let finish!: () => void;
    try {
      const result = await dispatchOne(dispatcherDb, f.hh, "stg", { send: async () => new Promise<void>(resolve => {
        finish = resolve; queueMicrotask(() => controller.abort());
      }) });
      expect(result).toBe("retry"); finish(); await Promise.resolve();
      expect(await admin.jobDelivery.findFirst({ where: { eventId: f.event.id } })).toMatchObject({ state: "pending", attempts: 1, sentAt: null, leaseToken: null });
    } finally { timeout.mockRestore(); }
  });
  it("does not mark a deleted household's in-flight send as durable success", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    expect(await dispatchOne(dispatcherDb, f.hh, "stg", { send: async () => { await admin.household.delete({ where: { id: f.hh } }); } })).toBe("lease-lost");
    expect(await consumeDelivery(workerDb, "stg", "pipeline", body(f, "pipeline"), { pipeline: effect })).toBe("refused");
    expect(await countEffects(f.hh)).toBe(0);
  });
  it.each([-60_000, 60_000])("uses database time for a lease despite host clock skew of %i ms", async skew => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    let remaining = 0;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + skew);
    try {
      expect(await dispatchOne(dispatcherDb, f.hh, "stg", { send: async () => {
        const [row] = await admin.$queryRaw<Array<{ remaining: number }>>`
          SELECT EXTRACT(EPOCH FROM (lease_until - clock_timestamp()))::float8 * 1000 AS remaining
          FROM job_deliveries WHERE event_id = ${f.event.id}`;
        remaining = row!.remaining;
      } })).toBe("sent");
      expect(remaining).toBeGreaterThan(25_000); expect(remaining).toBeLessThanOrEqual(30_000);
    } finally { vi.useRealTimers(); }
  });
  it("refuses database-expired ownership even when the host clock is behind", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() - 60_000);
    try {
      expect(await dispatchOne(dispatcherDb, f.hh, "stg", { send: async () => {
        await admin.$executeRaw`UPDATE job_deliveries SET lease_until = clock_timestamp() - interval '1 second' WHERE event_id = ${f.event.id}`;
      } })).toBe("lease-lost");
      expect(await admin.jobDelivery.findFirst({ where: { eventId: f.event.id } })).toMatchObject({ state: "pending", sentAt: null });
    } finally { vi.useRealTimers(); }
  });
  it("rechecks database expiry after waiting for the outcome row lock", async () => {
    const f = await fixture("document.uploaded"); await routeOutboxBatch(dispatcherDb, f.hh, "stg");
    let lock: Promise<void> | undefined;
    try {
      expect(await dispatchOne(dispatcherDb, f.hh, "stg", { send: async () => {
        let acquired!: () => void;
        const ready = new Promise<void>(resolve => { acquired = resolve; });
        lock = admin.$transaction(async tx => {
          await tx.$executeRaw`UPDATE job_deliveries SET lease_until = clock_timestamp() + interval '100 milliseconds' WHERE event_id = ${f.event.id}`;
          acquired();
          await new Promise(resolve => setTimeout(resolve, 250));
        });
        await ready;
      } })).toBe("lease-lost");
      expect(await admin.jobDelivery.findFirst({ where: { eventId: f.event.id } })).toMatchObject({ state: "pending", sentAt: null });
    } finally { await lock; }
  });
});
