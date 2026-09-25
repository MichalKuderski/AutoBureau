import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DELETION_COMPONENTS, encodeJobEnvelope } from "@autobureau/contracts";
import { eraseLocalDocumentBatch, eraseLocalHouseholdRecordsBatch, type LocalErasureClaims } from "../../src/local-erasure.js";
import { Database } from "../../src/scoped.js";
import { runAsSystem, runAsUser } from "../../src/audit.js";
import { registerDocumentScan, claimDocumentScan, completeDocumentScan } from "../../src/document-scans.js";
import { requestHouseholdDeletion, undoHouseholdDeletion, fenceHouseholdDeletion, appendDeletionManifest,
  sealDeletionManifest, claimDeletionAttempt, recordDeletionAttempt, recordSyntheticDeletionObservation,
  observeLocalDeletionResource, readDeletionProgress, readHouseholdDeletionStatus } from "../../src/deletion-journal.js";
import { discoverJobHouseholds, routeOutboxBatch, runHouseholdDispatchOnce, consumeDelivery, dispatchOne } from "../../src/jobs.js";
import { ADMIN_URL, APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";
const fixtures: string[] = [], owner = randomUUID(), stranger = randomUUID();
let admin: PrismaClient, app: PrismaClient, scan: PrismaClient, deletion: PrismaClient, verifier: PrismaClient, dispatcher: PrismaClient, worker: PrismaClient;
let appDb: Database, scanDb: Database, deleteDb: Database, verifyDb: Database, dispatchDb: Database, workerDb: Database;
const roles = ["app_document_worker", "app_retention_worker", "app_deletion_verifier", "app_dispatcher", "app_job_worker"];
const release = { engine: "1".repeat(64), signatures: "2".repeat(64), sandbox: "3".repeat(64) };
const bytes = Buffer.from("PELLUM PUBLIC SYNTHETIC DOCUMENT"), sha = createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient(); app = new PrismaClient({ datasourceUrl: APP_URL });
  const clients: PrismaClient[] = [];
  for (const role of roles) {
    await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'adr018_local_only'`);
    const url = new URL(ADMIN_URL); url.username = role; url.password = "adr018_local_only";
    clients.push(new PrismaClient({ datasourceUrl: url.toString() }));
  }
  [scan, deletion, verifier, dispatcher, worker] = clients as [PrismaClient, PrismaClient, PrismaClient, PrismaClient, PrismaClient];
  [appDb, scanDb, deleteDb, verifyDb, dispatchDb, workerDb] = [app, scan, deletion, verifier, dispatcher, worker].map(c => new Database(c)) as [Database, Database, Database, Database, Database, Database];
  for (const id of [owner, stranger]) await admin.user.create({ data: { id, email: `${id}@example.test` } });
}, 120_000);
afterAll(async () => {
  vi.useRealTimers();
  if (admin) {
    const where = { householdId: { in: fixtures } };
    await admin.deletionObservation.deleteMany({ where }); await admin.deletionAttempt.deleteMany({ where });
    await admin.deletionResource.deleteMany({ where }); await admin.householdDeletion.deleteMany({ where });
    await admin.documentScanAttempt.deleteMany({ where }); await admin.documentScan.deleteMany({ where });
    await admin.outboxEvent.deleteMany({ where }); await admin.household.deleteMany({ where: { id: { in: fixtures } } });
    await admin.auditLog.deleteMany({ where }); await admin.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
    for (const role of roles) await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);
  }
  await Promise.all([admin, app, scan, deletion, verifier, dispatcher, worker].map(c => c?.$disconnect()));
});
async function fixture() {
  const hh = randomUUID(), doc = randomUUID(), seal = randomUUID(); fixtures.push(hh);
  await admin.household.create({ data: { id: hh, name: "Synthetic ADR-018", createdBy: owner } });
  await admin.householdUser.create({ data: { householdId: hh, userId: owner, role: "owner" } });
  await admin.householdUser.create({ data: { householdId: hh, userId: stranger, role: "viewer" } });
  await admin.document.create({ data: { id: doc, householdId: hh, source: "upload", status: "scanning",
    storagePath: `hh/${hh}/upload/${doc}/sealed/${seal}`, sizeBytes: bytes.length, mimeType: "application/pdf" } });
  return { hh, doc, seal, input: { documentId: doc, sealId: seal, sha256: sha, size: bytes.length } };
}
async function registered() { const f = await fixture(); return { ...f, id: await registerDocumentScan(scanDb, f.hh, f.input) }; }
async function requested(hh: string) { return runAsUser(owner, () => requestHouseholdDeletion(appDb, hh, "DELETE HOUSEHOLD")); }
async function mature(id: string) {
  await admin.$executeRaw`UPDATE household_deletions SET requested_at=clock_timestamp()-interval '20 days',undo_until=clock_timestamp()-interval '6 days' WHERE id=${id}::uuid`;
}
async function fenced() {
  const f = await fixture(), requestId = await requested(f.hh); await mature(requestId);
  expect(await fenceHouseholdDeletion(deleteDb, f.hh, requestId)).toBe(true);
  return { ...f, requestId };
}
async function manifestReady() {
  const f = await fenced();
  await admin.$executeRaw`UPDATE household_deletions SET fenced_at=clock_timestamp()-interval '16 minutes',settle_until=clock_timestamp()-interval '1 minute' WHERE id=${f.requestId}::uuid`;
  const manifest = DELETION_COMPONENTS.map(component => ({ component, resourceRef: randomUUID(), inventoryCount: 0 }));
  await appendDeletionManifest(deleteDb, f.hh, f.requestId, manifest);
  await sealDeletionManifest(deleteDb, f.hh, f.requestId);
  const resources = await admin.deletionResource.findMany({ where: { deletionId: f.requestId } });
  return { ...f, manifest, resources };
}
async function localClaims(f: Awaited<ReturnType<typeof manifestReady>>) {
  const claims = {} as Record<keyof LocalErasureClaims, NonNullable<Awaited<ReturnType<typeof claimDeletionAttempt>>>>;
  for (const component of ["documents", "derived-records", "identifier-secrets", "notifications-reminders"] as const) {
    claims[component] = (await claimDeletionAttempt(deleteDb, f.hh, f.resources.find(r => r.component === component)!.id))!;
  }
  return claims;
}
describe("ADR-018 durable scan authority", () => {
  it("registers the sealed byte identity once and audits every raw-SQL mutation", async () => {
    const f = await registered(); expect(await registerDocumentScan(scanDb, f.hh, f.input)).toBe(f.id);
    expect(await scanDb.withHousehold(f.hh, tx => tx.documentScan.count())).toBe(1);
    expect(await admin.auditLog.count({ where: { householdId: f.hh } })).toBe(2);
    const claim = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    expect(await completeDocumentScan(scanDb, f.hh, f.id, { nonce: claim.nonce, sha256: sha, verdict: "clean", failure: "none" })).toBe("clean");
    expect(await admin.document.findUnique({ where: { id: f.doc } })).toMatchObject({ status: "queued" });
    expect(await admin.outboxEvent.count({ where: { householdId: f.hh, eventType: "document.scanned" } })).toBe(1);
    expect(await admin.auditLog.count({ where: { householdId: f.hh } })).toBe(8);
  });
  it.each(["size", "seal", "hash", "tenant"])("refuses mismatched %s snapshot binding", async field => {
    const f = await registered(), input = { ...f.input };
    if (field === "size") input.size++; if (field === "seal") input.sealId = randomUUID(); if (field === "hash") input.sha256 = "0".repeat(64);
    await expect(registerDocumentScan(scanDb, field === "tenant" ? (await fixture()).hh : f.hh, input)).rejects.toThrow();
  });
  it("leases only one concurrent scanner and uses database time despite host skew", async () => {
    const f = await registered(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 3_600_000);
    try {
      const claims = await Promise.all([claimDocumentScan(scanDb, f.hh, f.id, release), claimDocumentScan(scanDb, f.hh, f.id, release)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const [r] = await admin.$queryRaw<Array<{ seconds: number }>>`SELECT EXTRACT(EPOCH FROM(lease_until-clock_timestamp()))::float8 AS seconds FROM document_scans WHERE id=${f.id}::uuid`;
      expect(r!.seconds).toBeGreaterThan(85); expect(r!.seconds).toBeLessThanOrEqual(90);
    } finally { vi.useRealTimers(); }
  });
  it("refuses forged nonce/hash and replay without advancing or duplicating effects", async () => {
    const f = await registered(), claim = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    const good = { nonce: claim.nonce, sha256: sha, verdict: "clean", failure: "none" };
    expect(await completeDocumentScan(scanDb, f.hh, f.id, { ...good, nonce: randomUUID() })).toBe("lease-lost");
    expect(await completeDocumentScan(scanDb, f.hh, f.id, { ...good, sha256: "0".repeat(64) })).toBe("binding-refused");
    expect((await Promise.all([completeDocumentScan(scanDb, f.hh, f.id, good), completeDocumentScan(scanDb, f.hh, f.id, good)])).sort()).toEqual(["clean", "lease-lost"]);
    expect(await admin.outboxEvent.count({ where: { householdId: f.hh } })).toBe(1);
  });
  it("recovers expired attempts and exhausts three crashes without a fourth scan", async () => {
    const f = await registered();
    for (let i = 1; i <= 3; i++) {
      const claim = (await claimDocumentScan(scanDb, f.hh, f.id, release))!; expect(claim.attempt).toBe(i);
      await admin.documentScan.update({ where: { id: f.id }, data: { leaseUntil: new Date(0) } });
      expect(await completeDocumentScan(scanDb, f.hh, f.id, { nonce: claim.nonce, sha256: sha, verdict: "clean", failure: "none" })).toBe("lease-lost");
    }
    expect(await claimDocumentScan(scanDb, f.hh, f.id, release)).toBeNull();
    expect(await admin.documentScan.findUnique({ where: { id: f.id } })).toMatchObject({ state: "exhausted", attempts: 3 });
    expect(await admin.documentScanAttempt.count({ where: { scanId: f.id, failure: "lease-expired" } })).toBe(3);
  });
  it.each(["rejected", "indeterminate", "scanner-error"])("never treats %s as clean", async verdict => {
    const f = await registered(), claim = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    expect(await completeDocumentScan(scanDb, f.hh, f.id, { nonce: claim.nonce, sha256: sha, verdict, failure: "malformed" })).toBe(verdict === "rejected" ? "rejected" : "queued");
    expect((await admin.document.findUniqueOrThrow({ where: { id: f.doc } })).status).not.toBe("processing");
  });
  it("refuses clean/failure contradictions at the database boundary", async () => {
    const f = await registered(); await claimDocumentScan(scanDb, f.hh, f.id, release);
    await expect(runAsSystem("Contradictory scanner reply", () => scanDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE document_scan_attempts SET verdict='clean',failure='malware',completed_at=clock_timestamp() WHERE scan_id=${f.id}::uuid`))).rejects.toThrow("scan_clean_failure");
  });
  it("superseded sealed object cannot advance the newer document", async () => {
    const f = await registered(), claim = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    await admin.document.update({ where: { id: f.doc }, data: { storagePath: `hh/${f.hh}/upload/${f.doc}/sealed/${randomUUID()}` } });
    expect(await completeDocumentScan(scanDb, f.hh, f.id, { nonce: claim.nonce, sha256: sha, verdict: "clean", failure: "none" })).toBe("superseded");
    expect(await admin.outboxEvent.count({ where: { householdId: f.hh } })).toBe(0);
  });
  it("rejects raw status advancement, lease theft and historical verdict rewrites", async () => {
    const f = await registered(), c = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    await expect(runAsSystem("Invalid direct transition", () => scanDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE documents SET status='processing' WHERE id=${f.doc}::uuid`))).rejects.toThrow("Durable clean scan required");
    await expect(runAsSystem("Invalid active claim replacement", () => scanDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE document_scans SET attempts=2,lease_token=${randomUUID()}::uuid WHERE id=${f.id}::uuid`))).rejects.toThrow("Scan claim refused");
    await completeDocumentScan(scanDb, f.hh, f.id, { nonce: c.nonce, sha256: sha, verdict: "clean", failure: "none" });
    await expect(runAsSystem("Invalid history rewrite", () => scanDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE document_scan_attempts SET verdict='rejected',failure='malware' WHERE scan_id=${f.id}::uuid`))).rejects.toThrow("Scan attempt is immutable");
  });
  it("a terminal verdict cannot be re-queued or re-decided, even by the scanning worker", async () => {
    const f = await registered(), c = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    await completeDocumentScan(scanDb, f.hh, f.id, { nonce: c.nonce, sha256: sha, verdict: "clean", failure: "none" });
    for (const state of ["queued", "rejected", "exhausted", "cancelled"]) {
      await expect(runAsSystem("Terminal verdict rewrite", () => scanDb.withHousehold(f.hh, tx => tx.$executeRawUnsafe(`UPDATE document_scans SET state='${state}' WHERE id='${f.id}'`)))).rejects.toThrow("Scan is terminal");
    }
    expect(await admin.documentScan.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ state: "clean" });
  });
  it("enforces worker/app/verifier separation, immutable history and actual RLS", async () => {
    const a = await registered(), b = await registered();
    expect(await scan.documentScan.findMany()).toEqual([]);
    expect(await scanDb.withHousehold(a.hh, tx => tx.documentScan.findMany({ where: { householdId: b.hh } }))).toEqual([]);
    await expect(runAsSystem("Attempt scan binding tampering", () => scanDb.withHousehold(a.hh, tx => tx.documentScan.update({ where: { id: a.id }, data: { sha256: Buffer.alloc(32) } })))).rejects.toThrow();
    await expect(claimDocumentScan(appDb, a.hh, a.id, release)).rejects.toThrow();
    await expect(scanDb.withHousehold(a.hh, tx => tx.itemSecret.findMany())).rejects.toThrow();
    await expect(scanDb.withHousehold(a.hh, tx => tx.household.findMany({ select: { name: true } }))).rejects.toThrow();
    await expect(verifyDb.withHousehold(a.hh, tx => tx.document.findMany({ select: { title: true } }))).rejects.toThrow();
    await expect(scanDb.withHousehold(a.hh, tx => tx.$executeRaw`SET ROLE app_dispatcher`)).rejects.toThrow();
  });
});
describe("ADR-018 deletion fences and evidence", () => {
  it("requires an owner actor and typed confirmation, stamps 14-day grace in DB and deduplicates", async () => {
    const f = await fixture();
    await expect(requestHouseholdDeletion(appDb, f.hh, "DELETE HOUSEHOLD")).rejects.toThrow();
    await expect(runAsUser(stranger, () => requestHouseholdDeletion(appDb, f.hh, "DELETE HOUSEHOLD"))).rejects.toThrow();
    await expect(runAsUser(owner, () => requestHouseholdDeletion(appDb, f.hh, "yes"))).rejects.toThrow();
    const id = await requested(f.hh); expect(await requested(f.hh)).toBe(id);
    const row = await admin.householdDeletion.findUniqueOrThrow({ where: { id } });
    expect(row.undoUntil.getTime() - row.requestedAt.getTime()).toBe(14 * 86400_000);
    expect(await fenceHouseholdDeletion(deleteDb, f.hh, id)).toBe(false);
    expect(await runAsUser(owner, () => undoHouseholdDeletion(appDb, f.hh, id))).toBe(true);
    expect(await fenceHouseholdDeletion(deleteDb, f.hh, id)).toBe(false);
  });
  it("the database itself refuses a non-owner deletion request and an undo after the window", async () => {
    const f = await fixture();
    // Raw SQL as the restricted role: the TypeScript pre-checks are bypassed on purpose.
    await expect(runAsUser(stranger, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`INSERT INTO household_deletions(household_id,requested_by) VALUES(${f.hh}::uuid,${stranger}::uuid)`))).rejects.toThrow("Owner authorization required");
    expect(await admin.householdDeletion.count({ where: { householdId: f.hh } })).toBe(0);
    const id = await requested(f.hh); await mature(id);
    expect(await runAsUser(owner, () => undoHouseholdDeletion(appDb, f.hh, id))).toBe(false);
    await expect(runAsUser(owner, () => appDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE household_deletions SET state='cancelled' WHERE id=${id}::uuid`))).rejects.toThrow("Deletion undo refused");
    expect(await admin.householdDeletion.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: "grace" });
  });
  it("fence blocks raw tenant writes, scan completion and dispatch/consumption", async () => {
    const f = await registered(), claim = (await claimDocumentScan(scanDb, f.hh, f.id, release))!;
    const event = await admin.outboxEvent.create({ data: { householdId: f.hh, eventType: "document.uploaded", aggregateType: "document", aggregateId: f.doc, payload: {}, transportScope: "stg" } });
    await routeOutboxBatch(dispatchDb, f.hh, "stg");
    const id = await requested(f.hh); await mature(id); await fenceHouseholdDeletion(deleteDb, f.hh, id);
    expect(await runAsUser(owner, () => undoHouseholdDeletion(appDb, f.hh, id))).toBe(false);
    await expect(runAsUser(owner, () => appDb.withHousehold(f.hh, tx => tx.document.update({ where: { id: f.doc }, data: { title: "blocked" } })))).rejects.toThrow();
    await expect(appDb.withHousehold(f.hh, tx => tx.$executeRaw`DELETE FROM documents WHERE id=${f.doc}::uuid`)).rejects.toThrow();
    expect(await completeDocumentScan(scanDb, f.hh, f.id, { nonce: claim.nonce, sha256: sha, verdict: "clean", failure: "none" })).toBe("cancelled");
    expect(await discoverJobHouseholds(dispatchDb, "stg")).not.toContain(f.hh);
    const send = vi.fn(); expect(await runHouseholdDispatchOnce(dispatchDb, f.hh, "stg", { send })).toMatchObject({ status: "blocked", reconciliation: { fenced_events: 1 } });
    expect(send).not.toHaveBeenCalled();
    const body = encodeJobEnvelope({ version: 1, event_id: event.id.toString(), household_id: f.hh, event_type: "document.uploaded", consumer: "pipeline" });
    const handler = vi.fn(); expect(await consumeDelivery(workerDb, "stg", "pipeline", body, { pipeline: handler })).toBe("refused"); expect(handler).not.toHaveBeenCalled();
  });
  it("fence waits for an existing write then excludes every later write", async () => {
    const f = await fixture(), id = await requested(f.hh); await mature(id);
    let opened!: () => void, releaseWrite!: () => void;
    const ready = new Promise<void>(r => { opened = r; }), release = new Promise<void>(r => { releaseWrite = r; });
    const writing = runAsUser(owner, () => appDb.withHousehold(f.hh, async tx => {
      await tx.document.update({ where: { id: f.doc }, data: { title: "Committed before fence" } }); opened(); await release;
    }));
    await ready; let finished = false;
    const fencing = fenceHouseholdDeletion(deleteDb, f.hh, id).then(x => { finished = true; return x; });
    try { await new Promise(r => setTimeout(r, 50)); expect(finished).toBe(false); } finally { releaseWrite(); }
    await writing; expect(await fencing).toBe(true);
    await expect(runAsUser(owner, () => appDb.withHousehold(f.hh, tx => tx.document.update({ where: { id: f.doc }, data: { title: "Too late" } })))).rejects.toThrow();
  });
  it("refuses manifest before settlement and requires every coverage class before sealing", async () => {
    const f = await fenced(), rows = [{ component: "documents", resourceRef: randomUUID(), inventoryCount: 1 }];
    await expect(appendDeletionManifest(deleteDb, f.hh, f.requestId, rows)).rejects.toThrow();
    await admin.householdDeletion.update({ where: { id: f.requestId }, data: { settleUntil: new Date(0) } });
    await appendDeletionManifest(deleteDb, f.hh, f.requestId, rows);
    await appendDeletionManifest(deleteDb, f.hh, f.requestId, rows);
    expect(await admin.deletionResource.count({ where: { deletionId: f.requestId } })).toBe(1);
    await expect(appendDeletionManifest(deleteDb, f.hh, f.requestId, [{ ...rows[0], inventoryCount: 2 }])).rejects.toThrow();
    await expect(sealDeletionManifest(deleteDb, f.hh, f.requestId)).rejects.toThrow();
  });
  it("seals a complete immutable manifest; acknowledgement never establishes absence", async () => {
    const f = await manifestReady(), resource = f.resources[0]!;
    await expect(appendDeletionManifest(deleteDb, f.hh, f.requestId, f.manifest)).rejects.toThrow();
    const results = await Promise.all([claimDeletionAttempt(deleteDb, f.hh, resource.id), claimDeletionAttempt(deleteDb, f.hh, resource.id)]);
    const claim = results.find(Boolean)!; expect(results.filter(Boolean)).toHaveLength(1);
    expect(await recordDeletionAttempt(deleteDb, f.hh, claim.id, randomUUID(), "acknowledged")).toBe(false);
    expect(await recordDeletionAttempt(deleteDb, f.hh, claim.id, claim.token, "acknowledged")).toBe(true);
    expect(await claimDeletionAttempt(deleteDb, f.hh, resource.id)).toBeNull();
    expect(await readDeletionProgress(appDb, f.hh, f.requestId)).toMatchObject({ state: "verifying", finalReceiptIssuable: false, irreversibleCompletedAt: null, providerErasure: "unverified", backupExpiry: "unverified" });
    expect(await admin.deletionObservation.count({ where: { householdId: f.hh } })).toBe(0);
  });
  it("caps deletion retries, refuses expired leases and keeps the resource operation id stable", async () => {
    const f = await manifestReady(), resource = f.resources[0]!;
    for (let i = 1; i <= 3; i++) {
      const c = (await claimDeletionAttempt(deleteDb, f.hh, resource.id))!; expect(c.operationId).toBe(resource.id); expect(c.attempt).toBe(i);
      await admin.deletionAttempt.update({ where: { id: c.id }, data: { leaseUntil: new Date(0) } });
      expect(await recordDeletionAttempt(deleteDb, f.hh, c.id, c.token, "acknowledged")).toBe(false);
    }
    expect(await claimDeletionAttempt(deleteDb, f.hh, resource.id)).toBeNull();
    expect(await admin.deletionAttempt.count({ where: { householdId: f.hh, outcome: "lease-expired" } })).toBe(3);
  });
  it("only an independent verifier can append evidence; no role can fabricate a final receipt", async () => {
    const f = await manifestReady(), resource = f.resources[0]!, value = { evidenceId: randomUUID(), state: "absent", remaining: 0 };
    await expect(recordSyntheticDeletionObservation(deleteDb, f.hh, resource.id, value)).rejects.toThrow();
    await expect(recordSyntheticDeletionObservation(appDb, f.hh, resource.id, value)).rejects.toThrow();
    await recordSyntheticDeletionObservation(verifyDb, f.hh, resource.id, value);
    await recordSyntheticDeletionObservation(verifyDb, f.hh, resource.id, value);
    expect(await admin.deletionObservation.count({ where: { householdId: f.hh } })).toBe(1);
    await expect(runAsSystem("Attempt evidence rewrite", () => verifyDb.withHousehold(f.hh, tx => tx.deletionObservation.deleteMany()))).rejects.toThrow();
    await expect(runAsSystem("Attempt premature completion", () => verifyDb.withHousehold(f.hh, tx => tx.householdDeletion.update({ where: { id: f.requestId }, data: { state: "completed", completedAt: new Date() } })))).rejects.toThrow();
    expect(await verifier.deletionObservation.findMany()).toEqual([]);
    const other = await fixture(); expect(await readDeletionProgress(appDb, other.hh, f.requestId)).toBeNull();
  });
  it("refuses conflicting evidence retention and rewriting an acknowledged delete", async () => {
    const f = await manifestReady(), resource = f.resources[0]!, c = (await claimDeletionAttempt(deleteDb, f.hh, resource.id))!;
    await recordDeletionAttempt(deleteDb, f.hh, c.id, c.token, "acknowledged");
    await expect(runAsSystem("Attempt result rewrite", () => deleteDb.withHousehold(f.hh, tx => tx.$executeRaw`UPDATE deletion_attempts SET outcome='failed' WHERE id=${c.id}::uuid`))).rejects.toThrow("Deletion result ownership refused");
    const v = { evidenceId: randomUUID(), state: "retained", remaining: 1, retentionUntil: new Date(Date.now()+86400_000).toISOString() };
    await recordSyntheticDeletionObservation(verifyDb, f.hh, resource.id, v);
    await expect(recordSyntheticDeletionObservation(verifyDb, f.hh, resource.id, { ...v, retentionUntil: new Date(Date.now()+2*86400_000).toISOString() })).rejects.toThrow("conflict");
  });
  it("performs independent local absence reads without mistaking DB absence for provider deletion", async () => {
    const f = await manifestReady(), documents = f.resources.find(r => r.component === "documents")!, derived = f.resources.find(r => r.component === "derived-records")!;
    expect(await observeLocalDeletionResource(verifyDb, f.hh, documents.id)).toMatchObject({ state: "remaining", remaining: 1 });
    // Exact synthetic document only; no production or unowned deletion is performed.
    await admin.document.delete({ where: { id: f.doc } });
    expect(await observeLocalDeletionResource(verifyDb, f.hh, documents.id)).toMatchObject({ state: "unknown", remaining: 0 });
    expect(await observeLocalDeletionResource(verifyDb, f.hh, derived.id)).toMatchObject({ state: "absent", remaining: 0 });
    expect(await readDeletionProgress(appDb, f.hh, f.requestId)).toMatchObject({ finalReceiptIssuable: false });
  });
  it("raw SQL dispatcher claim and outcome now write explicit audit entries", async () => {
    const f = await fixture(); await admin.outboxEvent.create({ data: { householdId: f.hh, eventType: "document.uploaded", aggregateType: "document", aggregateId: f.doc, payload: {}, transportScope: "stg" } });
    await routeOutboxBatch(dispatchDb, f.hh, "stg");
    expect(await dispatchOne(dispatchDb, f.hh, "stg", { send: async () => {} })).toBe("sent");
    const entries = await admin.auditLog.findMany({ where: { householdId: f.hh, action: { in: ["job.lease_claimed", "job.send_recorded"] } }, select: { action: true } });
    expect(entries.map(x => x.action).sort()).toEqual(["job.lease_claimed", "job.send_recorded"]);
  });
  it("independently reports retained notification and job evidence without declaring provider absence",async()=>{
    const f=await manifestReady();
    await admin.notification.create({data:{householdId:f.hh,userId:owner,kind:"synthetic",title:"PUBLIC",body:"PUBLIC",dedupeKey:randomUUID()}});
    await admin.outboxEvent.create({data:{householdId:f.hh,eventType:"document.uploaded",aggregateType:"document",aggregateId:f.doc,payload:{},transportScope:"stg"}});
    await admin.documentScan.create({data:{documentId:f.doc,householdId:f.hh,sealId:f.seal,sha256:Buffer.from(sha,"hex"),sizeBytes:bytes.length}});
    for(const component of ["notifications-reminders","outbox-delivery-inbox","job-artifacts"]){
      expect(await observeLocalDeletionResource(verifyDb,f.hh,f.resources.find(r=>r.component===component)!.id)).toMatchObject({state:"remaining",remaining:1,completeLocalScope:false});
    }
    const empty=await manifestReady();
    for(const component of ["notifications-reminders","outbox-delivery-inbox","job-artifacts"]){
      expect(await observeLocalDeletionResource(verifyDb,empty.hh,empty.resources.find(r=>r.component===component)!.id)).toMatchObject({state:"unknown",remaining:0,completeLocalScope:false});
    }
  });
});


describe("manifest-bound local online erasure", () => {
  it("requires the settled manifested fence even for direct restricted-role DELETE", async () => {
    const f = await fixture();
    await expect(deleteDb.withHousehold(f.hh, tx => tx.$executeRaw`DELETE FROM documents WHERE id=${f.doc}::uuid`)).rejects.toThrow("Manifest-bound erasure required");
    await expect(eraseLocalDocumentBatch(deleteDb, f.hh, randomUUID(), {} as LocalErasureClaims)).rejects.toThrow("Local erasure refused");
    const id = await requested(f.hh); await mature(id); await fenceHouseholdDeletion(deleteDb, f.hh, id);
    await expect(deleteDb.withHousehold(f.hh, tx => tx.$executeRaw`DELETE FROM documents WHERE id=${f.doc}::uuid`)).rejects.toThrow();
  });
  it("deletes synthetic rows as a scoped non-owner, preserves other households and verifies separately", async () => {
    const a = await manifestReady(), b = await fixture(), claims = await localClaims(a);
    const notice = await admin.notification.create({ data: { householdId:a.hh,userId:owner,kind:"synthetic",title:"PUBLIC",body:"PUBLIC",dedupeKey:randomUUID() } });
    await admin.notificationDelivery.create({data:{notificationId:notice.id,channel:"inapp"}});
    const chunk = await admin.documentChunk.create({ data: { householdId: a.hh, documentId: a.doc, seq: 0, content: "public fixture only" } });
    expect(await deleteDb.withHousehold(b.hh, tx => tx.$executeRaw`DELETE FROM document_chunks WHERE id=${chunk.id}::uuid`)).toBe(0);
    const results = [];
    for (let i = 0; i < 12; i++) { const r = await eraseLocalDocumentBatch(deleteDb, a.hh, a.requestId, claims); results.push(r); if (r.onlineRowsDrained) break; }
    expect(results.reduce((n,r) => n+r.count,0)).toBe(4);
    expect(results.at(-1)).toMatchObject({ onlineRowsDrained: true, finalReceiptIssuable: false });
    expect(await verifyDb.withHousehold(a.hh, tx => tx.document.count())).toBe(0);
    expect(await verifyDb.withHousehold(b.hh, tx => tx.document.count())).toBe(1);
    const resource = a.resources.find(x => x.component === "derived-records")!;
    expect(await observeLocalDeletionResource(verifyDb,a.hh,resource.id)).toMatchObject({ state: "absent" });
    const docs = a.resources.find(x => x.component === "documents")!;
    expect(await observeLocalDeletionResource(verifyDb,a.hh,docs.id)).toMatchObject({ state: "unknown" });
    expect(await readDeletionProgress(appDb,a.hh,a.requestId)).toMatchObject({ finalReceiptIssuable:false, providerErasure:"unverified", backupExpiry:"unverified" });
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$executeRaw`DELETE FROM household_deletions WHERE id=${a.requestId}::uuid`)).rejects.toThrow();
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$executeRaw`DELETE FROM outbox_events WHERE household_id=${a.hh}::uuid`)).rejects.toThrow();
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$queryRaw`SELECT ciphertext FROM item_secrets`)).rejects.toThrow();
  });
  it("erases household records only after derived records, bound to its own lease, and never reports the anchors absent", async () => {
    const a = await manifestReady(), b = await fixture(), claims = await localClaims(a);
    const resource = a.resources.find(x => x.component === "account-household")!;
    const own = (await claimDeletionAttempt(deleteDb, a.hh, resource.id))!;
    await admin.entitlement.create({ data: { householdId: a.hh, periodStart: new Date() } });
    await admin.entitlement.create({ data: { householdId: b.hh, periodStart: new Date() } });
    const member = await admin.householdMember.create({ data: { householdId: a.hh, displayName: "PUBLIC member", kind: "adult" } });
    await admin.householdMember.create({ data: { householdId: b.hh, displayName: "PUBLIC other", kind: "adult" } });
    await admin.item.create({ data: { householdId: a.hh, kind: "subscription", name: "PUBLIC item", memberId: member.id } });
    await admin.idempotencyKey.create({ data: { householdId: a.hh, userId: owner, key: randomUUID(), method: "POST", path: "/v1/items", fingerprint: "0".repeat(64), state: "completed", responseStatus: 201, responseBody: "{\"name\":\"PUBLIC item\"}", expiresAt: new Date(Date.now() + 86400_000) } });
    // Ordering: derived records still reference the member, so this stage refuses.
    await expect(eraseLocalHouseholdRecordsBatch(deleteDb, a.hh, a.requestId, own)).rejects.toThrow("Local erasure ordering refused");
    // A lease for another component cannot authorize this stage, nor a direct DELETE.
    await expect(eraseLocalHouseholdRecordsBatch(deleteDb, a.hh, a.requestId, claims["derived-records"])).rejects.toThrow("Local erasure lease refused");
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$executeRaw`DELETE FROM household_members WHERE id=${member.id}::uuid`)).rejects.toThrow("Manifest-bound erasure required");
    for (let i = 0; i < 12; i++) { if ((await eraseLocalDocumentBatch(deleteDb, a.hh, a.requestId, claims)).onlineRowsDrained) break; }
    const results = [];
    for (let i = 0; i < 6; i++) { const r = await eraseLocalHouseholdRecordsBatch(deleteDb, a.hh, a.requestId, own); results.push(r); if (r.onlineRowsDrained) break; }
    expect(results.reduce((n, r) => n + r.count, 0)).toBe(3);
    expect(results.at(-1)).toMatchObject({ onlineRowsDrained: true, finalReceiptIssuable: false });
    expect(await admin.householdMember.count({ where: { householdId: a.hh } })).toBe(0);
    expect(await admin.entitlement.count({ where: { householdId: a.hh } })).toBe(0);
    expect(await admin.idempotencyKey.count({ where: { householdId: a.hh } })).toBe(0);
    expect(await admin.householdMember.count({ where: { householdId: b.hh } })).toBe(1);
    expect(await admin.entitlement.count({ where: { householdId: b.hh } })).toBe(1);
    // Memberships and the household anchor are retained suppression evidence; the anchor keeps
    // only its identity (name replaced, alias cleared), and no other household is touched.
    expect(results.at(-1)).toMatchObject({ anchorMinimized: true });
    expect(await admin.household.findUnique({ where: { id: a.hh }, select: { name: true, emailAlias: true } })).toEqual({ name: "Deleted household", emailAlias: null });
    expect((await admin.household.findUnique({ where: { id: b.hh }, select: { name: true } }))!.name).not.toBe("Deleted household");
    expect(await readHouseholdDeletionStatus(appDb, a.hh)).toMatchObject({ householdAnchor: "identifier-only", finalReceiptIssuable: false });
    expect(await admin.householdUser.count({ where: { householdId: a.hh } })).toBe(2);
    expect(await observeLocalDeletionResource(verifyDb, a.hh, resource.id)).toMatchObject({ state: "remaining", remaining: 2 });
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$executeRaw`DELETE FROM household_users WHERE household_id=${a.hh}::uuid`)).rejects.toThrow();
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$executeRaw`DELETE FROM households WHERE id=${a.hh}::uuid`)).rejects.toThrow();
  });
  it("refuses anchor minimization while household records remain, unbound, or with any other content", async () => {
    const a = await manifestReady(), claims = await localClaims(a);
    const resource = a.resources.find(x => x.component === "account-household")!;
    const own = (await claimDeletionAttempt(deleteDb, a.hh, resource.id))!;
    await admin.household.update({ where: { id: a.hh }, data: { emailAlias: `alias-${a.hh.slice(0, 8)}` } });
    await admin.householdMember.create({ data: { householdId: a.hh, displayName: "PUBLIC member", kind: "adult" } });
    for (let i = 0; i < 12; i++) { if ((await eraseLocalDocumentBatch(deleteDb, a.hh, a.requestId, claims)).onlineRowsDrained) break; }
    const bound = (sql: Prisma.Sql, claim = own) => deleteDb.withHousehold(a.hh, async tx => {
      await tx.$executeRaw`SELECT set_config('request.erasure_attempt',${claim.id},true),set_config('request.erasure_token',${claim.token},true)`;
      return tx.$executeRaw(sql);
    });
    // Unbound: no live attempt for this component.
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$executeRaw`UPDATE households SET name='Deleted household',email_alias=NULL WHERE id=${a.hh}::uuid`)).rejects.toThrow("Manifest-bound erasure required");
    await expect(bound(Prisma.sql`UPDATE households SET name='Deleted household',email_alias=NULL WHERE id=${a.hh}::uuid`, claims["derived-records"])).rejects.toThrow("Manifest-bound erasure required");
    // Bound, but the stage's records are still there.
    await expect(bound(Prisma.sql`UPDATE households SET name='Deleted household',email_alias=NULL WHERE id=${a.hh}::uuid`)).rejects.toThrow("Anchor minimization refused");
    for (let i = 0; i < 6; i++) { if ((await eraseLocalHouseholdRecordsBatch(deleteDb, a.hh, a.requestId, own)).onlineRowsDrained) break; }
    await admin.household.update({ where: { id: a.hh }, data: { name: "PUBLIC household", emailAlias: `alias-${a.hh.slice(0, 8)}` } });
    // Bound and drained: may replace the anchor content only with the fixed placeholder.
    await expect(bound(Prisma.sql`UPDATE households SET name='Renamed by retention',email_alias=NULL WHERE id=${a.hh}::uuid`)).rejects.toThrow("Anchor minimization refused");
    await expect(bound(Prisma.sql`UPDATE households SET name='Deleted household' WHERE id=${a.hh}::uuid`)).rejects.toThrow("Anchor minimization refused");
    await expect(bound(Prisma.sql`UPDATE households SET created_by=${owner}::uuid WHERE id=${a.hh}::uuid`)).rejects.toThrow(/permission denied/);
    await expect(deleteDb.withHousehold(a.hh, tx => tx.$queryRaw`SELECT name FROM households WHERE id=${a.hh}::uuid`)).rejects.toThrow(/permission denied/);
    expect(await bound(Prisma.sql`UPDATE households SET name='Deleted household',email_alias=NULL WHERE id=${a.hh}::uuid`)).toBe(1);
  });
  it("bounds batches and tolerates duplicate/concurrent invocations", async () => {
    const f = await manifestReady(), claims = await localClaims(f);
    await admin.documentChunk.createMany({ data: Array.from({length: 105},(_,i) => ({ householdId:f.hh,documentId:f.doc,seq:i,content:"synthetic" })) });
    const results = await Promise.all([eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims),eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)]);
    expect(results.map(r=>r.count).sort((a,b)=>a-b)).toEqual([5,100]);
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)).toMatchObject({count:1});
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)).toMatchObject({count:0,onlineRowsDrained:true});
  });
  it("requires a live matching journal capability even for direct DELETE after manifest sealing", async () => {
    const f=await manifestReady(), claims=await localClaims(f);
    await admin.documentChunk.create({data:{householdId:f.hh,documentId:f.doc,seq:0,content:"PUBLIC"}});
    await expect(deleteDb.withHousehold(f.hh,tx=>tx.$executeRaw`DELETE FROM documents WHERE id=${f.doc}::uuid`)).rejects.toThrow("Manifest-bound erasure required");
    await expect(deleteDb.withHousehold(f.hh,async tx=>{
      await tx.$executeRaw`SELECT set_config('request.erasure_attempt',${claims.documents.id},true),set_config('request.erasure_token',${claims.documents.token},true)`;
      return tx.$executeRaw`DELETE FROM document_chunks WHERE household_id=${f.hh}::uuid`;
    })).rejects.toThrow("Manifest-bound erasure required");
    expect(await verifyDb.withHousehold(f.hh,tx=>tx.documentChunk.count())).toBe(1);
  });
  it.each(["expired","token","resource","household","completed"])("rejects a %s local row-erasure lease",async mode=>{
    const f=await manifestReady(), claims=await localClaims(f);
    const key="notifications-reminders";
    if(mode==="expired")await admin.deletionAttempt.update({where:{id:claims[key].id},data:{leaseUntil:new Date(0)}});
    if(mode==="token")claims[key]={...claims[key],token:randomUUID()};
    if(mode==="resource")claims[key]={...claims[key],operationId:claims.documents.operationId};
    if(mode==="household")claims[key]=(await localClaims(await manifestReady()))[key];
    if(mode==="completed")await recordDeletionAttempt(deleteDb,f.hh,claims[key].id,claims[key].token,"acknowledged");
    await expect(eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)).rejects.toThrow("Local erasure lease refused");
    expect(await verifyDb.withHousehold(f.hh,tx=>tx.document.count())).toBe(1);
  });
  it("rolls back a failed precommit batch and its count audit together",async()=>{
    const f=await manifestReady(), claims=await localClaims(f);
    const scoped=deleteDb.withHousehold.bind(deleteDb);
    const fault=vi.spyOn(deleteDb,"withHousehold").mockImplementationOnce((hh,fn)=>scoped(hh,async tx=>{await fn(tx);throw new Error("Synthetic precommit crash");}));
    try {await expect(eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)).rejects.toThrow("Synthetic precommit crash");}
    finally {fault.mockRestore();}
    expect(await verifyDb.withHousehold(f.hh,tx=>tx.document.count())).toBe(1);
    expect(await admin.auditLog.count({where:{householdId:f.hh,action:"privacy.local_batch_erased"}})).toBe(0);
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)).toMatchObject({count:1});
  });
  it("recovers a crash after row commit but before acknowledgement without re-erasing rows",async()=>{
    const f=await manifestReady(), first=await localClaims(f);
    await admin.documentChunk.createMany({data:Array.from({length:105},(_,seq)=>({householdId:f.hh,documentId:f.doc,seq,content:"PUBLIC"}))});
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,first)).toMatchObject({count:100});
    await admin.deletionAttempt.updateMany({where:{householdId:f.hh},data:{leaseUntil:new Date(0)}});
    const recovered=await localClaims(f);
    expect(Object.values(recovered).map(c=>c.attempt)).toEqual([2,2,2,2]);
    expect(recovered.documents.operationId).toBe(first.documents.operationId);
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,recovered)).toMatchObject({count:5});
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,recovered)).toMatchObject({count:1});
    expect(await eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,recovered)).toMatchObject({count:0,onlineRowsDrained:true});
    for(const c of Object.values(recovered))expect(await recordDeletionAttempt(deleteDb,f.hh,c.id,c.token,"acknowledged")).toBe(true);
    expect(await admin.auditLog.count({where:{householdId:f.hh,action:"privacy.local_batch_erased"}})).toBe(3);
    expect(await verifyDb.withHousehold(f.hh,tx=>tx.documentChunk.count())).toBe(0);
    expect(await readDeletionProgress(appDb,f.hh,f.requestId)).toMatchObject({finalReceiptIssuable:false});
  });
});

it("does not erase a provider reference while provider deletion is unverified",async()=>{
 const f=await manifestReady(), claims=await localClaims(f);const n=await admin.notification.create({data:{householdId:f.hh,userId:owner,kind:"synthetic",title:"PUBLIC",body:"PUBLIC",dedupeKey:randomUUID()}});
 await admin.notificationDelivery.create({data:{notificationId:n.id,channel:"email",providerMessageId:"synthetic-provider-reference"}});
 await expect(eraseLocalDocumentBatch(deleteDb,f.hh,f.requestId,claims)).rejects.toThrow("Provider reference unresolved");
 expect(await verifyDb.withHousehold(f.hh,tx=>tx.notificationDelivery.count())).toBe(1);
});

describe("tenant parity before erasure cascades", () => {
  it.each(["chunk-document", "item-document", "obligation-item", "reminder-obligation"])("refuses cross-household %s references as the application role", async edge => {
    const a=await fixture(), b=await fixture();
    const item=await admin.item.create({data:{householdId:a.hh,kind:"other",name:"PUBLIC"}});
    const obligation=await admin.obligation.create({data:{householdId:a.hh,itemId:item.id,title:"PUBLIC",kind:"custom",source:"user",dueAt:new Date("2026-10-01T00:00:00Z")}});
    await expect(runAsUser(owner,()=>appDb.withHousehold(b.hh,async tx=>{
      if(edge==="chunk-document")return tx.documentChunk.create({data:{householdId:b.hh,documentId:a.doc,seq:0,content:"PUBLIC"}});
      if(edge==="item-document")return tx.item.create({data:{householdId:b.hh,sourceDocumentId:a.doc,kind:"other",name:"PUBLIC"}});
      if(edge==="obligation-item")return tx.obligation.create({data:{householdId:b.hh,itemId:item.id,title:"PUBLIC",kind:"custom",source:"user",dueAt:new Date("2026-10-01T00:00:00Z")}});
      return tx.reminder.create({data:{householdId:b.hh,obligationId:obligation.id,remindAt:new Date("2026-10-01T00:00:00Z"),offsetLabel:"synthetic"}});
    }))).rejects.toThrow();
  });
  it.each(["chunk-document", "item-document", "obligation-item", "reminder-obligation"])("also refuses moving an existing %s link across households", async edge => {
    const a=await fixture(), b=await fixture();
    const [ai,bi]=await Promise.all([a,b].map(f=>admin.item.create({data:{householdId:f.hh,sourceDocumentId:f.doc,kind:"other",name:"PUBLIC"}})));
    const [ao,bo]=await Promise.all([{f:a,i:ai!},{f:b,i:bi!}].map(({f,i})=>admin.obligation.create({data:{householdId:f.hh,itemId:i.id,title:"PUBLIC",kind:"custom",source:"user",dueAt:new Date("2026-10-01T00:00:00Z")}})));
    const chunk=await admin.documentChunk.create({data:{householdId:b.hh,documentId:b.doc,seq:0,content:"PUBLIC"}});
    const reminder=await admin.reminder.create({data:{householdId:b.hh,obligationId:bo!.id,remindAt:new Date("2026-10-01T00:00:00Z"),offsetLabel:"synthetic"}});
    await expect(runAsUser(owner,()=>appDb.withHousehold(b.hh,async tx=>{
      if(edge==="chunk-document")return tx.documentChunk.update({where:{id:chunk.id},data:{documentId:a.doc}});
      if(edge==="item-document")return tx.item.update({where:{id:bi!.id},data:{sourceDocumentId:a.doc}});
      if(edge==="obligation-item")return tx.obligation.update({where:{id:bo!.id},data:{itemId:ai!.id}});
      return tx.reminder.update({where:{id:reminder.id},data:{obligationId:ao!.id}});
    }))).rejects.toThrow();
  });
  it("preserves same-household document cascades and nullable item provenance links", async () => {
    const f=await fixture();
    const item=await admin.item.create({data:{householdId:f.hh,sourceDocumentId:f.doc,kind:"other",name:"PUBLIC"}});
    await admin.documentChunk.create({data:{householdId:f.hh,documentId:f.doc,seq:0,content:"PUBLIC"}});
    await runAsUser(owner,()=>appDb.withHousehold(f.hh,tx=>tx.document.delete({where:{id:f.doc}})));
    expect(await appDb.withHousehold(f.hh,tx=>tx.documentChunk.count())).toBe(0);
    expect(await appDb.withHousehold(f.hh,tx=>tx.item.findUniqueOrThrow({where:{id:item.id}}))).toMatchObject({sourceDocumentId:null});
  });
  it("preserves same-household item, obligation and reminder cascade behavior", async () => {
    const f=await fixture();
    const item=await admin.item.create({data:{householdId:f.hh,kind:"other",name:"PUBLIC"}});
    const obligation=await admin.obligation.create({data:{householdId:f.hh,itemId:item.id,title:"PUBLIC",kind:"custom",source:"user",dueAt:new Date("2026-10-01T00:00:00Z")}});
    await admin.reminder.create({data:{householdId:f.hh,obligationId:obligation.id,remindAt:new Date("2026-10-01T00:00:00Z"),offsetLabel:"synthetic"}});
    await runAsUser(owner,()=>appDb.withHousehold(f.hh,tx=>tx.item.delete({where:{id:item.id}})));
    expect(await appDb.withHousehold(f.hh,tx=>tx.obligation.count())).toBe(0);
    expect(await appDb.withHousehold(f.hh,tx=>tx.reminder.count())).toBe(0);
  });
});
