import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import { registerDocumentScan, claimDocumentScan, completeDocumentScan } from "../../src/document-scans.js";
import { registerCleanCustody, markCleanCustodyReady, reserveDocumentProcessing, startDocumentProcessing, readDocumentProcessingUsage } from "../../src/document-processing.js";
import { publishSyntheticResult, approveSyntheticResult } from "../../src/document-results.js";
import { readDocumentResultState, applyDocumentResult, discardDocumentResult, DocumentResultRefused } from "../../src/document-period.js";
import { canonicalDeadlinePdf } from "../../../../services/ai/src/canonical-pdf.js";
import { prepareLocalDocumentResult } from "../../../../scripts/local-document-result.js";
import { ADMIN_URL, APP_URL, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

// PRD §21.3. Every assertion runs as app_user or the document worker; the fixture
// administrator only seeds (and simulates the passage of a month by moving a reservation).
let admin: PrismaClient, worker: PrismaClient, app: PrismaClient, db: Database, appDb: Database;
const households: string[] = [], users: string[] = [];
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin();
  admin = new PrismaClient({ datasourceUrl: ADMIN_URL }); app = new PrismaClient({ datasourceUrl: APP_URL }); appDb = new Database(app);
  await admin.$executeRawUnsafe("ALTER ROLE app_document_worker LOGIN PASSWORD 'local_period_only'");
  const u = new URL(ADMIN_URL); u.username = "app_document_worker"; u.password = "local_period_only";
  worker = new PrismaClient({ datasourceUrl: u.toString() }); db = new Database(worker);
}, 120000);
afterAll(async () => {
  if (admin) {
    const where = { householdId: { in: households } };
    await admin.documentPeriodDecision.deleteMany({ where }); await admin.documentResultReview.deleteMany({ where });
    await admin.documentResult.deleteMany({ where }); await admin.documentProcessing.deleteMany({ where });
    await admin.documentCustody.deleteMany({ where }); await admin.documentScanAttempt.deleteMany({ where }); await admin.documentScan.deleteMany({ where });
    await admin.householdDeletion.deleteMany({ where }); await admin.outboxEvent.deleteMany({ where });
    await admin.household.deleteMany({ where: { id: { in: households } } }); await admin.auditLog.deleteMany({ where });
    await admin.user.deleteMany({ where: { id: { in: users } } });
    await admin.$executeRawUnsafe("ALTER ROLE app_document_worker NOLOGIN PASSWORD NULL");
  }
  await Promise.all([admin, app, worker].map(c => c?.$disconnect()));
});
async function household() {
  const hh = randomUUID(), owner = randomUUID(); households.push(hh); users.push(owner);
  await admin.user.create({ data: { id: owner, email: `${owner}@example.test` } });
  await admin.household.create({ data: { id: hh, createdBy: owner, name: "PUBLIC period fixture" } });
  await admin.householdUser.create({ data: { householdId: hh, userId: owner, role: "owner" } });
  await admin.entitlement.create({ data: { householdId: hh, periodStart: new Date() } });
  return { hh, owner };
}
/** Clean custody plus a started reservation; `old` moves that reservation into the previous
 * UTC month BEFORE the worker publishes, so result and work both belong to the closed month. */
async function work(h: { hh: string; owner: string }, old: boolean, due = "2026-10-01") {
  const doc = randomUUID(), seal = randomUUID();
  const bytes = Buffer.from(canonicalDeadlinePdf(due)), sha = createHash("sha256").update(bytes).digest("hex");
  await admin.document.create({ data: { id: doc, householdId: h.hh, source: "upload", status: "scanning", storagePath: `hh/${h.hh}/upload/${doc}/sealed/${seal}`, mimeType: "application/pdf", sizeBytes: bytes.length } });
  const scan = await registerDocumentScan(db, h.hh, { documentId: doc, sealId: seal, sha256: sha, size: bytes.length });
  const claim = (await claimDocumentScan(db, h.hh, scan, { engine: "1".repeat(64), signatures: "2".repeat(64), sandbox: "3".repeat(64) }))!;
  await completeDocumentScan(db, h.hh, scan, { nonce: claim.nonce, sha256: sha, verdict: "clean", failure: "none" });
  const custody = await registerCleanCustody(db, h.hh, scan), processing = await markCleanCustodyReady(db, h.hh, custody.id);
  const lease = (await reserveDocumentProcessing(db, h.hh, processing))!;
  await startDocumentProcessing(db, h.hh, processing, lease.lease_token);
  if (old) await admin.$executeRaw`UPDATE document_processing SET period_start=period_start-interval '1 month',period_end=period_start WHERE id=${processing}::uuid`;
  const result = prepareLocalDocumentResult(bytes, { id: randomUUID(), processingId: processing, leaseToken: lease.lease_token });
  await publishSyntheticResult(db, h.hh, result);
  return { ...h, doc, custody, processing, result, sha };
}
/** Completed current-month usage (the fixture writes accounting rows directly). */
async function usage(hh: string, n: number) {
  for (let i = 0; i < n; i++) {
    const doc = randomUUID(), seal = randomUUID(), bytes = Buffer.from(`PUBLIC SYNTHETIC ${doc}`), sha = createHash("sha256").update(bytes).digest();
    await admin.document.create({ data: { id: doc, householdId: hh, source: "upload", status: "processed", storagePath: `hh/${hh}/upload/${doc}/sealed/${seal}`, mimeType: "application/pdf", sizeBytes: bytes.length, sha256: sha } });
    const scan = await admin.documentScan.create({ data: { householdId: hh, documentId: doc, sealId: seal, sha256: sha, sizeBytes: bytes.length, state: "clean" } });
    const c = await admin.documentCustody.create({ data: { householdId: hh, documentId: doc, scanId: scan.id, objectId: randomUUID(), sha256: sha, sizeBytes: bytes.length, state: "absent", reviewAt: new Date(Date.now() + 86400000) } });
    await admin.$executeRaw`INSERT INTO document_processing(household_id,custody_id,state,attempts,period_start,period_end,tier,catalog_version,entitlement_revision,limit_snapshot,lease_token,lease_until,result_ref,charged_at)
      VALUES(${hh}::uuid,${c.id}::uuid,'completed',1,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',(date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC','free',1,0,10,gen_random_uuid(),clock_timestamp(),gen_random_uuid(),clock_timestamp())`;
  }
}
const as = <T,>(owner: string, fn: () => Promise<T>) => runAsUser(owner, fn);
const state = (f: { hh: string; owner: string; doc: string }) => as(f.owner, () => readDocumentResultState(appDb, f.hh, f.doc));
const apply = (f: { hh: string; owner: string; doc: string; result: { id: string } }) => as(f.owner, () => applyDocumentResult(appDb, f.hh, f.doc, f.result.id));
const discard = (f: { hh: string; owner: string; doc: string; result: { id: string } }) => as(f.owner, () => discardDocumentResult(appDb, f.hh, f.doc, f.result.id));
const reason = (p: Promise<unknown>) => p.then(() => "ok", e => e instanceof DocumentResultRefused ? e.reason : String(e));
const decisions = (hh: string) => appDb.withHousehold(hh, tx => tx.documentPeriodDecision.findMany());
const snapshot = (id: string) => admin.documentResult.findUniqueOrThrow({ where: { id } });

describe("PRD §21.3 old-period results", () => {
  it("an old-period result is action required and is never charged to either month without a decision", async () => {
    const f = await work(await household(), true);
    expect(await state(f)).toMatchObject({ state: "action-required", canApply: true, canDiscard: true, capacity: { used: 0, limit: 10 } });
    // The pre-existing approval path (no recorded decision) must not charge any month.
    await expect(as(f.owner, () => approveSyntheticResult(appDb, f.hh, f.result.id, "APPROVE PUBLIC SYNTHETIC DATE"))).rejects.toThrow();
    expect(await readDocumentProcessingUsage(appDb, f.hh)).toMatchObject({ completed: 0 });
    expect(await appDb.withHousehold(f.hh, tx => tx.item.count())).toBe(0);
    expect(await decisions(f.hh)).toEqual([]);
  });
  it("apply this month consumes exactly one current-month slot and reuses the immutable result without reprocessing", async () => {
    const f = await work(await household(), true), before = await snapshot(f.result.id);
    const filed = await apply(f);
    expect(filed).toMatchObject({ state: "applied", replayed: false });
    const w = await admin.documentProcessing.findUniqueOrThrow({ where: { id: f.processing } });
    const month = await admin.$queryRaw<Array<{ s: Date }>>`SELECT date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS s`;
    expect(w).toMatchObject({ state: "completed", resultRef: f.result.id, periodStart: month[0]!.s, attempts: 1 });
    expect(w.chargedAt).not.toBeNull();
    expect(await readDocumentProcessingUsage(appDb, f.hh)).toMatchObject({ completed: 1 });
    // Provenance: the result row is byte-for-byte unchanged, including its ORIGINAL period.
    expect(await snapshot(f.result.id)).toEqual(before);
    expect(before.periodStart.getTime()).toBeLessThan(month[0]!.s.getTime());
    const [d] = await decisions(f.hh);
    expect(d).toMatchObject({ decision: "apply-current-period", resultId: f.result.id, processingId: f.processing, ownerId: f.owner, fromPeriodStart: before.periodStart, toPeriodStart: month[0]!.s });
    expect(await appDb.withHousehold(f.hh, tx => tx.documentResultReview.count({ where: { resultId: f.result.id } }))).toBe(1);
    // No provider rerun: the worker can neither reserve nor start this work again.
    expect(await reserveDocumentProcessing(db, f.hh, f.processing).catch(() => null)).toBeNull();
    expect(await state(f)).toMatchObject({ state: "applied", chargedPeriodStart: month[0]!.s.toISOString(), canApply: false, canDiscard: false });
  });
  it("concurrent and replayed applies charge at most once", async () => {
    const f = await work(await household(), true);
    const results = await Promise.all([apply(f), apply(f), apply(f)]);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true, true]);
    expect(new Set(results.map(r => r.itemId)).size).toBe(1);
    expect((await apply(f)).replayed).toBe(true);
    expect(await readDocumentProcessingUsage(appDb, f.hh)).toMatchObject({ completed: 1 });
    expect(await decisions(f.hh)).toHaveLength(1);
    expect(await appDb.withHousehold(f.hh, tx => tx.item.count())).toBe(1);
  });
  it("an apply racing the last current-month reservation leaves exactly one winner", async () => {
    for (let i = 0; i < 3; i++) {
      const h = await household(), f = await work(h, true); await usage(h.hh, 9);
      // Another document in this household is ready and waiting for the same (last) slot.
      const doc = randomUUID(), seal = randomUUID(), bytes = Buffer.from(`PUBLIC SYNTHETIC ${doc}`), sha = createHash("sha256").update(bytes).digest("hex");
      await admin.document.create({ data: { id: doc, householdId: h.hh, source: "upload", status: "scanning", storagePath: `hh/${h.hh}/upload/${doc}/sealed/${seal}`, mimeType: "application/pdf", sizeBytes: bytes.length } });
      const scan = await registerDocumentScan(db, h.hh, { documentId: doc, sealId: seal, sha256: sha, size: bytes.length });
      const c = (await claimDocumentScan(db, h.hh, scan, { engine: "1".repeat(64), signatures: "2".repeat(64), sandbox: "3".repeat(64) }))!;
      await completeDocumentScan(db, h.hh, scan, { nonce: c.nonce, sha256: sha, verdict: "clean", failure: "none" });
      const custody = await registerCleanCustody(db, h.hh, scan), waiting = await markCleanCustodyReady(db, h.hh, custody.id);
      const [a, r] = await Promise.allSettled([apply(f), reserveDocumentProcessing(db, h.hh, waiting)]);
      const applied = a.status === "fulfilled", reserved = r.status === "fulfilled" && r.value !== null;
      expect(Number(applied) + Number(reserved)).toBe(1);
      const [n] = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM document_processing WHERE household_id=${h.hh}::uuid
        AND period_start=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state IN ('reserved','started','indeterminate','completed')`;
      expect(Number(n!.n)).toBe(10);
      if (!applied) expect(await state(f)).toMatchObject({ state: "capacity-unavailable", canApply: false, canDiscard: true });
    }
  });
  it("without current capacity the result stays held and nothing is recorded", async () => {
    const h = await household(), f = await work(h, true); await usage(h.hh, 10);
    expect(await state(f)).toMatchObject({ state: "capacity-unavailable", canApply: false, canDiscard: true, capacity: { used: 10, limit: 10 } });
    expect(await reason(apply(f))).toBe("capacity");
    expect(await decisions(f.hh)).toEqual([]);
    expect(await admin.documentProcessing.findUniqueOrThrow({ where: { id: f.processing } })).toMatchObject({ state: "started", chargedAt: null });
    expect(await appDb.withHousehold(f.hh, tx => tx.documentResult.count())).toBe(1);
  });
  it("the database itself refuses a recorded apply decision when the current month is full", async () => {
    const h = await household(), f = await work(h, true); await usage(h.hh, 10);
    // Bypass every TypeScript pre-check: record the decision directly, then take the approval path.
    await as(f.owner, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO document_period_decisions(household_id,processing_id,result_id,owner_id,decision)
      VALUES(${f.hh}::uuid,${f.processing}::uuid,${f.result.id}::uuid,${f.owner}::uuid,'apply-current-period')`));
    await expect(as(f.owner, () => approveSyntheticResult(appDb, f.hh, f.result.id, "APPROVE PUBLIC SYNTHETIC DATE"))).rejects.toThrow();
    expect(await admin.documentProcessing.findUniqueOrThrow({ where: { id: f.processing } })).toMatchObject({ state: "started", chargedAt: null });
    expect(await appDb.withHousehold(f.hh, tx => tx.item.count())).toBe(0);
  });
  it("discard never charges, keeps the original upload, and excludes a later apply", async () => {
    const f = await work(await household(), true), original = await admin.document.findUniqueOrThrow({ where: { id: f.doc } });
    expect(await discard(f)).toMatchObject({ state: "discarded", replayed: false });
    expect((await discard(f)).replayed).toBe(true);
    expect(await admin.documentProcessing.findUniqueOrThrow({ where: { id: f.processing } })).toMatchObject({ state: "cancelled", chargedAt: null, resultRef: null });
    expect(await admin.documentCustody.findUniqueOrThrow({ where: { id: f.custody.id } })).toMatchObject({ state: "cancelled" });
    const kept = await admin.document.findUniqueOrThrow({ where: { id: f.doc } });
    expect(kept).toMatchObject({ status: "discarded", storagePath: original.storagePath, sizeBytes: original.sizeBytes });
    expect(await readDocumentProcessingUsage(appDb, f.hh)).toMatchObject({ completed: 0 });
    expect(await reason(apply(f))).toBe("not-actionable");
    expect(await state(f)).toMatchObject({ state: "discarded", canApply: false, canDiscard: false });
    // The decision journal is immutable to the application role.
    await expect(as(f.owner, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE document_period_decisions SET decision='apply-current-period' WHERE household_id=${f.hh}::uuid`))).rejects.toThrow();
    await expect(as(f.owner, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`DELETE FROM document_period_decisions WHERE household_id=${f.hh}::uuid`))).rejects.toThrow();
  });
  it("an applied result cannot then be discarded, and a current-month result needs no transfer", async () => {
    const f = await work(await household(), true); await apply(f);
    expect(await reason(discard(f))).toBe("not-actionable");
    const g = await work(await household(), false);
    expect(await state(g)).toMatchObject({ state: "awaiting-review", canApply: true });
    expect(await apply(g)).toMatchObject({ state: "applied", replayed: false });
    expect(await decisions(g.hh)).toEqual([]);
  });
  it("raw restricted SQL cannot forge, redirect or pre-empt a decision", async () => {
    const f = await work(await household(), true), g = await work(await household(), false);
    const viewer = randomUUID(); users.push(viewer);
    await admin.user.create({ data: { id: viewer, email: `${viewer}@example.test` } });
    await admin.householdUser.create({ data: { householdId: f.hh, userId: viewer, role: "viewer" } });
    const insert = (actor: string, hh: string, processing: string, result: string, owner: string, decision: string) =>
      as(actor, () => appDb.withHousehold(hh, tx => tx.$executeRaw`INSERT INTO document_period_decisions(household_id,processing_id,result_id,owner_id,decision)
        VALUES(${hh}::uuid,${processing}::uuid,${result}::uuid,${owner}::uuid,${decision})`));
    await expect(insert(viewer, f.hh, f.processing, f.result.id, viewer, "apply-current-period")).rejects.toThrow("Period decision refused");
    await expect(insert(f.owner, f.hh, f.processing, f.result.id, viewer, "apply-current-period")).rejects.toThrow("Period decision refused");
    await expect(insert(g.owner, g.hh, g.processing, g.result.id, g.owner, "apply-current-period")).rejects.toThrow("current month");
    // A decision cannot be bound to someone else's work in the same household.
    const h = await work({ hh: f.hh, owner: f.owner }, true, "2026-11-02");
    await expect(insert(f.owner, f.hh, f.processing, h.result.id, f.owner, "discard")).rejects.toThrow();
    // The owner's raw completion without a recorded decision still refuses (never silently charged).
    await expect(as(f.owner, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE document_processing SET state='cancelled' WHERE id=${f.processing}::uuid`))).rejects.toThrow();
    expect(await decisions(f.hh)).toEqual([]);
    expect(await admin.documentProcessing.findUniqueOrThrow({ where: { id: f.processing } })).toMatchObject({ state: "started" });
  });
  it.each(["fence", "suspended", "custody-expired"] as const)("%s fails closed without losing the result", async mode => {
    const f = await work(await household(), true);
    if (mode === "fence") await admin.householdDeletion.create({ data: { householdId: f.hh, requestedBy: f.owner, requestedAt: new Date(Date.now() - 20 * 86400000), undoUntil: new Date(Date.now() - 6 * 86400000), state: "fenced", fencedAt: new Date(Date.now() - 3600000), settleUntil: new Date(Date.now() - 2700000) } });
    if (mode === "suspended") await admin.user.update({ where: { id: f.owner }, data: { status: "suspended" } });
    if (mode === "custody-expired") await admin.documentCustody.update({ where: { id: f.custody.id }, data: { reviewAt: new Date(0) } });
    expect(await reason(apply(f))).not.toBe("ok");
    if (mode !== "custody-expired") expect(await reason(discard(f))).not.toBe("ok");
    else {
      expect(await state(f)).toMatchObject({ state: "held", canApply: false, canDiscard: true });
      expect(await discard(f)).toMatchObject({ state: "discarded" });
    }
    expect(await readDocumentProcessingUsage(appDb, f.hh)).toMatchObject({ completed: 0 });
    expect(await admin.documentResult.count({ where: { householdId: f.hh } })).toBe(1);
  });
  it("a suspended owner cannot complete even a current-month result through the database", async () => {
    const f = await work(await household(), false);
    await admin.user.update({ where: { id: f.owner }, data: { status: "suspended" } });
    await expect(as(f.owner, () => approveSyntheticResult(appDb, f.hh, f.result.id, "APPROVE PUBLIC SYNTHETIC DATE"))).rejects.toThrow();
    expect(await readDocumentProcessingUsage(appDb, f.hh)).toMatchObject({ completed: 0 });
  });
});
