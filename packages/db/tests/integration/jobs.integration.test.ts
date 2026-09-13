import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeJobEnvelope, type JobConsumer, type JobScope } from "@autobureau/contracts";
import { Database } from "../../src/scoped.js";
import { consumeDelivery, discoverJobHouseholds, dispatchOne, reconcileJobDeliveries, routeOutboxBatch, type JobHandler } from "../../src/jobs.js";
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
});
