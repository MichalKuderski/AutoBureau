import { randomUUID, createSecretKey, randomBytes } from "node:crypto";
import { mkdtemp, chmod, rm, readFile, writeFile, readdir, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalExportVault } from "../../src/local-export-artifact.js";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, it, expect } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsSystem, runAsUser } from "../../src/audit.js";
import { requestOwnerExport, readOwnerExportStatus, readOwnerExportPage, readOwnerExportSnapshot } from "../../src/privacy-export.js";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

let admin: PrismaClient, app: PrismaClient, db: Database;
const owner = randomUUID(), other = randomUUID(), households: string[] = [];
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient(); app = new PrismaClient({ datasourceUrl: APP_URL }); db = new Database(app);
  await admin.user.createMany({ data: [owner, other].map(id => ({ id, email: `${id}@example.test` })) });
}, 120_000);
afterAll(async () => {
  if (admin) {
    const where = { householdId: { in: households } };
    await admin.localExportArtifact.deleteMany({ where });
    await admin.householdDeletion.deleteMany({ where });
    await admin.household.deleteMany({ where: { id: { in: households } } });
    await admin.outboxEvent.deleteMany({ where }); await admin.auditLog.deleteMany({ where });
    await admin.user.deleteMany({ where: { id: { in: [owner, other] } } });
  }
  await app?.$disconnect(); await admin?.$disconnect();
});
async function fixture(count = 0) {
  const hh = randomUUID(); households.push(hh);
  await admin.household.create({ data: { id: hh, name: "PUBLIC export fixture", createdBy: owner } });
  await admin.householdUser.create({ data: { householdId: hh, userId: owner, role: "owner" } });
  if (count) await admin.item.createMany({ data: Array.from({ length: count }, () => ({ householdId: hh, kind: "other" as const, name: "PUBLIC", attrs: { neverExport: "synthetic sensitive fixture" }, amountCents: 1200n, currency: "USD" })) });
  return { hh, requestId: randomUUID() };
}
it("durably requests once through outbox under concurrent same-key calls", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 3 }, () => runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId))));
  expect(results.every(r => !r.complete && !r.artifactAvailable)).toBe(true);
  expect(results[0]!.expiresAt.getTime() - results[0]!.requestedAt.getTime()).toBe(72 * 3600_000);
  const counts = await runAsUser(owner, () => db.withHousehold(f.hh, async tx => ({
    outbox: await tx.outboxEvent.count({ where: { aggregateId: f.requestId } }),
    audit: await tx.auditLog.count({ where: { action: "privacy.export_requested", targetId: f.requestId } }),
  })));
  expect(counts).toEqual({ outbox: 1, audit: 1 });
});
it("exports 205 projected records in bounded pages without attrs or provider/capability material", async () => {
  const f = await fixture(205); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  const a = await runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items"));
  const b = await runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items", a.nextCursor!));
  const c = await runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items", b.nextCursor!));
  expect([a.records.length, b.records.length, c.records.length]).toEqual([100, 100, 5]); expect(c.nextCursor).toBeNull();
  expect(new Set([...a.records, ...b.records, ...c.records].map(r => r.id)).size).toBe(205);
  expect(a.records[0]).toEqual({ id: expect.any(String), kind: "other", status: "active", amountCents: "1200", currency: "USD", sourceDocumentId: null });
  expect(JSON.stringify(a)).not.toContain("sensitive fixture"); expect(a.complete).toBe(false);
  expect(await db.withHousehold(f.hh, tx => tx.auditLog.count({ where: { action: "privacy.export_page_read" } }))).toBe(3);
});
it("requires live owner membership on request/status/every page; rejects a system actor", async () => {
  const f = await fixture();
  await expect(runAsSystem("PUBLIC test", () => requestOwnerExport(db, f.hh, f.requestId))).rejects.toThrow();
  await expect(runAsUser(other, () => requestOwnerExport(db, f.hh, f.requestId))).rejects.toThrow();
  await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  await admin.householdUser.update({ where: { householdId_userId: { householdId: f.hh, userId: owner } }, data: { role: "viewer" } });
  await expect(runAsUser(owner, () => readOwnerExportStatus(db, f.hh, f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items"))).rejects.toThrow();
});
it("refuses foreign intent, changed cursor scope/source and unknown table selection", async () => {
  const f = await fixture(101), g = await fixture();
  await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  const a = await runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items"));
  await expect(runAsUser(owner, () => readOwnerExportStatus(db, g.hh, f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportPage(db, g.hh, f.requestId, "items", a.nextCursor!))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "obligations", a.nextCursor!))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "item_secrets" as never))).rejects.toThrow();
});
it("refuses a 72-hour-old intent without claiming an artifact was purged", async () => {
  const f = await fixture(); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  await admin.outboxEvent.updateMany({ where: { householdId: f.hh, aggregateId: f.requestId }, data: { createdAt: new Date(Date.now() - 72 * 3600_000 - 1000) } });
  await expect(runAsUser(owner, () => readOwnerExportStatus(db, f.hh, f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items"))).rejects.toThrow();
});
it("revokes local export access when the household is irreversibly fenced", async () => {
  const f = await fixture(); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  await admin.householdDeletion.create({ data: { householdId: f.hh, requestedBy: owner, requestedAt: new Date(0), undoUntil: new Date(14 * 86400_000), state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now() + 900000) } });
  await expect(runAsUser(owner, () => readOwnerExportStatus(db, f.hh, f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportPage(db, f.hh, f.requestId, "items"))).rejects.toThrow();
  await expect(runAsUser(owner, () => requestOwnerExport(db, f.hh, randomUUID()))).rejects.toThrow();
});

it("canonicalizes UUID request keys before deduplication and scope binding", async () => {
  const f = await fixture();
  const a = await runAsUser(owner, () => requestOwnerExport(db, f.hh.toUpperCase(), f.requestId.toUpperCase()));
  const b = await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  expect(a.requestId).toBe(b.requestId);
  expect(await db.withHousehold(f.hh, tx => tx.outboxEvent.count({ where: { eventType: "export.requested" } }))).toBe(1);
  expect(await runAsUser(owner, () => readOwnerExportStatus(db, f.hh.toUpperCase(), f.requestId.toUpperCase()))).toMatchObject({ requestId: f.requestId });
});

it("captures bounded deterministic multi-table snapshot with exact money and explicit omissions", async () => {
  const f = await fixture(205); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  const member = await admin.householdMember.create({ data: { householdId: f.hh, kind: "adult", displayName: "must-not-export" } });
  const doc = await admin.document.create({ data: { householdId: f.hh, source: "upload", storagePath: "must-not-export", mimeType: "application/pdf", sizeBytes: 123n } });
  const obligation = await admin.obligation.create({ data: { householdId: f.hh, title: "must-not-export", kind: "payment", source: "ai", sourceDocumentId: doc.id, memberId: member.id, dueAt: new Date("2027-01-01T01:00:00Z"), amountCents: 9007199254740993n } });
  await admin.reminder.create({ data: { householdId: f.hh, obligationId: obligation.id, remindAt: new Date("2026-12-31T01:00:00Z"), offsetLabel: "must-not-export" } });
  const s = await runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId));
  expect(s.items).toHaveLength(205); expect(s.items.map(i => i.id)).toEqual(s.items.map(i => i.id).sort());
  expect(s.obligations[0]).toMatchObject({ amountCents: "9007199254740993", source: "ai", sourceDocumentId: doc.id });
  expect(new Date(s.obligations[0]!.dueAt).toISOString()).toBe("2027-01-01T01:00:00.000Z");
  expect(s.members).toHaveLength(1); expect(s.documents).toHaveLength(1); expect(s.reminders).toHaveLength(1);
  expect(s.complete).toBe(false); expect(s.scope).toBe("household"); expect(JSON.stringify(s)).not.toMatch(/must-not-export|sensitive fixture|ciphertext|storagePath|attrs/);
});
it("refuses snapshot overflow rather than silently truncating", async () => {
  const f = await fixture(1001); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  await expect(runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId))).rejects.toThrow("Privacy export unavailable");
});
it("snapshot rechecks owner, foreign intent and expiration as the restricted app role", async () => {
  const f = await fixture(), g = await fixture(); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  await expect(runAsUser(other, () => readOwnerExportSnapshot(db, f.hh, f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner, () => readOwnerExportSnapshot(db, g.hh, f.requestId))).rejects.toThrow();
  await admin.outboxEvent.updateMany({ where: { householdId: f.hh, aggregateId: f.requestId }, data: { createdAt: new Date(Date.now() - 72*3600_000 - 1000) } });
  await expect(runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId))).rejects.toThrow();
});
it("snapshot observes either side of an atomic multi-table edit, never uncommitted values", async () => {
  const f = await fixture(1); const item = await admin.item.findFirstOrThrow({ where: { householdId: f.hh } });
  const obligation = await admin.obligation.create({ data: { householdId: f.hh, itemId: item.id, title: "PUBLIC", kind: "payment", source: "user", dueAt: new Date(), amountCents: 1200n } });
  await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  let unblock!: () => void, started!: () => void;
  const barrier = new Promise<void>(r => { unblock = r; }), changed = new Promise<void>(r => { started = r; });
  const writer = admin.$transaction(async tx => {
    await tx.item.update({ where: { id: item.id }, data: { amountCents: 9900n } }); started(); await barrier;
    await tx.obligation.update({ where: { id: obligation.id }, data: { amountCents: 9900n } });
  });
  await changed;
  try {
    const before = await runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId));
    expect([before.items[0]!.amountCents, before.obligations[0]!.amountCents]).toEqual(["1200","1200"]);
  } finally { unblock(); await writer; }
  const after = await runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId));
  expect([after.items[0]!.amountCents, after.obligations[0]!.amountCents]).toEqual(["9900","9900"]);
});
it("snapshot refuses privacy fence and malformed currency projection", async () => {
  const f = await fixture(1); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  await admin.item.updateMany({ where: { householdId: f.hh }, data: { currency: "???" } });
  await expect(runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId))).rejects.toThrow();
  await admin.item.updateMany({ where: { householdId: f.hh }, data: { currency: "USD" } });
  await admin.householdDeletion.create({ data: { householdId: f.hh, requestedBy: owner, requestedAt: new Date(0), undoUntil: new Date(14*86400_000), state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now()+900000) } });
  await expect(runAsUser(owner, () => readOwnerExportSnapshot(db, f.hh, f.requestId))).rejects.toThrow();
});

async function vaultFixture() {
  const f = await fixture(2); await runAsUser(owner, () => requestOwnerExport(db, f.hh, f.requestId));
  const root = await mkdtemp(join(tmpdir(), "pellum-local-export-")); await chmod(root, 0o700);
  // macOS TMPDIR may have a symlink component; vault deliberately requires realpath.
  const { realpath } = await import("node:fs/promises"); const actual = await realpath(root);
  const key = createSecretKey(randomBytes(32)); let offset = 0;
  return { ...f, root: actual, key, vault: createLocalExportVault(actual, key, () => Date.now() + offset),
    expire: () => { offset += 73*3600_000; }, cleanup: () => rm(root, { recursive: true }),
    file: join(actual, `${f.hh}_${f.requestId}.encrypted`) };
}
it("builds one immutable encrypted local artifact, restart-readable JSONL and explicit omissions", async () => {
  const f = await vaultFixture(); try {
    const built = await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    const encrypted = await readFile(f.file); expect(encrypted.toString()).not.toContain('"items"'); expect((await stat(f.file)).mode & 0o077).toBe(0);
    await admin.item.create({ data: { householdId: f.hh, kind: "other", name: "PUBLIC later record" } });
    const retry = await runAsUser(owner, () => createLocalExportVault(f.root, f.key).build(db, f.hh, f.requestId));
    expect(retry.reused).toBe(true); expect(retry.snapshotAt).toBe(built.snapshotAt); expect(await readFile(f.file)).toEqual(encrypted);
    const lines = (await runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).toString().trim().split("\n").map(v => JSON.parse(v));
    expect(lines[0]).toMatchObject({ type: "manifest", complete: false, scope: "household", omissions: expect.arrayContaining(["original-documents","identifier-reveal"]) });
    expect(lines.filter(l => l.type === "items")).toHaveLength(2); expect(await readdir(f.root)).toHaveLength(1);
  } finally { await f.cleanup(); }
});
it("concurrent local builders never overwrite a committed snapshot", async () => {
  const f = await vaultFixture(); try {
    const results = await Promise.allSettled([1,2,3].map(() => runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId))));
    // A transient nlink guard can conservatively refuse a simultaneous reader.
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect(await readdir(f.root)).toEqual([`${f.hh}_${f.requestId}.encrypted`]);
    expect((await runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).length).toBeGreaterThan(0);
  } finally { await f.cleanup(); }
});
it("local artifact download rechecks owner and refuses foreign request/cursor equivalents", async () => {
  const f = await vaultFixture(); try {
    await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    await expect(runAsUser(other, () => f.vault.download(db, f.hh, f.requestId))).rejects.toThrow();
    await expect(runAsUser(owner, () => f.vault.download(db, f.hh, randomUUID()))).rejects.toThrow();
    await admin.householdUser.update({ where: { householdId_userId: { householdId: f.hh, userId: owner } }, data: { role: "viewer" } });
    await expect(runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).rejects.toThrow();
  } finally { await f.cleanup(); }
});
it("local expiry refuses download before cleanup and independently reads file absence", async () => {
  const f = await vaultFixture(); try {
    await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    await expect(f.vault.expire(f.hh, f.requestId)).rejects.toThrow(); f.expire();
    await expect(runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).rejects.toThrow();
    expect(await f.vault.expire(f.hh, f.requestId)).toEqual({ localArtifactAbsent: true, providerAndBackupProof: false });
    expect(await readdir(f.root)).toHaveLength(0);
  } finally { await f.cleanup(); }
});
it("explicit local revocation survives restart and prevents regeneration", async () => {
  const f = await vaultFixture(); try {
    await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    expect(await runAsUser(owner, () => f.vault.revoke(db, f.hh, f.requestId))).toEqual({ localArtifactAbsent: true, providerAndBackupProof: false });
    await expect(runAsUser(owner, () => createLocalExportVault(f.root, f.key).build(db, f.hh, f.requestId))).rejects.toThrow();
    await expect(runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).rejects.toThrow();
  } finally { await f.cleanup(); }
});
it("deletion fence revokes existing export authority", async () => {
  const f = await vaultFixture(); try {
    await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    await admin.householdDeletion.create({ data: { householdId: f.hh, requestedBy: owner, requestedAt: new Date(0), undoUntil: new Date(14*86400_000), state: "fenced", fencedAt: new Date(), settleUntil: new Date(Date.now()+900000) } });
    await expect(runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).rejects.toThrow();
    f.expire(); expect((await f.vault.expire(f.hh, f.requestId)).localArtifactAbsent).toBe(true);
  } finally { await f.cleanup(); }
});
it.each(["tamper", "wrong-key", "symlink", "public-mode", "oversize"])("refuses local artifact %s", async control => {
  const f = await vaultFixture(); try {
    await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    let vault = f.vault;
    if (control === "tamper") { const b = await readFile(f.file); b[b.length-1] = b[b.length-1]! ^ 1; await writeFile(f.file,b); }
    if (control === "wrong-key") vault = createLocalExportVault(f.root,createSecretKey(randomBytes(32)));
    if (control === "symlink") { await rm(f.file); await symlink(join(f.root,"missing"),f.file); }
    if (control === "public-mode") await chmod(f.file,0o644);
    if (control === "oversize") await writeFile(f.file,Buffer.alloc(4*1024*1024+1));
    await expect(runAsUser(owner, () => vault.download(db,f.hh,f.requestId))).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it("cleans expired ciphertext left by a crash after durable revocation, without restoring read authority", async () => {
  const f = await vaultFixture(); try {
    await runAsUser(owner, () => f.vault.build(db, f.hh, f.requestId));
    await writeFile(join(f.root, `${f.hh}_${f.requestId}.revoked`), "", { mode: 0o600 });
    await expect(runAsUser(owner, () => f.vault.download(db, f.hh, f.requestId))).rejects.toThrow();
    await expect(f.vault.expire(f.hh, f.requestId)).rejects.toThrow();
    f.expire(); expect((await f.vault.expire(f.hh, f.requestId)).localArtifactAbsent).toBe(true);
    expect(await readdir(f.root)).toEqual([`${f.hh}_${f.requestId}.revoked`]);
  } finally { await f.cleanup(); }
});
it("published ciphertext without a journal cannot download; retry reconciles the exact immutable artifact",async()=>{
 const f=await vaultFixture();try{
  await runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId));const bytes=await readFile(f.file);
  // Administrator simulates process death after publication but before DB commit.
  await admin.localExportArtifact.deleteMany({where:{householdId:f.hh}});
  await expect(runAsUser(owner,()=>f.vault.download(db,f.hh,f.requestId))).rejects.toThrow();
  await runAsUser(owner,()=>createLocalExportVault(f.root,f.key).build(db,f.hh,f.requestId));
  expect(await readFile(f.file)).toEqual(bytes);expect(await admin.localExportArtifact.count({where:{householdId:f.hh}})).toBe(1);
  expect((await runAsUser(owner,()=>f.vault.download(db,f.hh,f.requestId))).length).toBeGreaterThan(0);
 }finally{await f.cleanup();}
});
it("DB revocation survives lost local deny marker and restored ciphertext",async()=>{
 const f=await vaultFixture();try{
  await runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId));const bytes=await readFile(f.file);
  await runAsUser(owner,()=>f.vault.revoke(db,f.hh,f.requestId));
  await rm(join(f.root,`${f.hh}_${f.requestId}.revoked`));await writeFile(f.file,bytes,{mode:0o600});
  await expect(runAsUser(owner,()=>f.vault.download(db,f.hh,f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE local_export_artifacts SET state='partial' WHERE household_id=${f.hh}::uuid`))).rejects.toThrow();
 }finally{await f.cleanup();}
});
it("an ordinary-role export journal row needs the owner's exact request intent and its 72-hour expiry",async()=>{
 const f=await fixture();
 const insert=(requestId:string,expires:Date)=>runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`INSERT INTO local_export_artifacts(household_id,request_id,owner_id,ciphertext_digest,size_bytes,snapshot_at,expires_at)
  VALUES(${f.hh}::uuid,${requestId}::uuid,${owner}::uuid,${"a".repeat(64)},100,clock_timestamp()-interval '1 second',${expires})`));
 await expect(insert(randomUUID(),new Date(Date.now()+3600_000))).rejects.toThrow("Export journal refused");
 await runAsUser(owner,()=>requestOwnerExport(db,f.hh,f.requestId));
 await expect(insert(f.requestId,new Date(Date.now()+365*86400_000))).rejects.toThrow("Export journal refused");
 expect(await admin.localExportArtifact.count({where:{householdId:f.hh}})).toBe(0);
});
it("journal scope, immutable ciphertext binding and expiry resist ordinary-role writes",async()=>{
 const f=await vaultFixture();try{
  await runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId));
  expect(await app.localExportArtifact.count()).toBe(0);
  expect(await runAsUser(other,()=>db.withHousehold(f.hh,tx=>tx.localExportArtifact.count()))).toBe(0);
  await expect(runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE local_export_artifacts SET ciphertext_digest=${"a".repeat(64)} WHERE household_id=${f.hh}::uuid`))).rejects.toThrow();
  await expect(runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.$executeRaw`UPDATE local_export_artifacts SET expires_at=clock_timestamp()+interval '1 year' WHERE household_id=${f.hh}::uuid`))).rejects.toThrow();
  await expect(runAsUser(owner,()=>db.withHousehold(f.hh,tx=>tx.localExportArtifact.deleteMany()))).rejects.toThrow();
  expect(await admin.outboxEvent.count({where:{householdId:f.hh,eventType:{not:"export.requested"}}})).toBe(0);
 }finally{await f.cleanup();}
});
it("pending sweep removes only authenticated expired request-scoped ciphertext and checks absence",async()=>{
 const f=await vaultFixture();try{
  await runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId));const bytes=await readFile(f.file);
  const name=`${f.hh}_${f.requestId}_${randomUUID()}.pending`,path=join(f.root,name);
  await writeFile(path,bytes,{mode:0o600});
  expect(await runAsUser(owner,()=>f.vault.sweepExpiredPending(db,f.hh,f.requestId))).toMatchObject({removed:0,refused:1});
  f.expire();expect(await runAsUser(owner,()=>f.vault.sweepExpiredPending(db,f.hh,f.requestId))).toMatchObject({removed:1,refused:0,complete:false});
  await expect(stat(path)).rejects.toMatchObject({code:"ENOENT"});expect(await readFile(f.file)).toEqual(bytes);
  expect(await runAsUser(owner,()=>f.vault.sweepExpiredPending(db,f.hh,f.requestId))).toMatchObject({removed:0,refused:0});
 }finally{await f.cleanup();}
});
it("pending sweep refuses other owner, corrupt bytes, symlinks and guessed legacy ownership",async()=>{
 const f=await vaultFixture();try{
  await runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId));
  const name=`${f.hh}_${f.requestId}_${randomUUID()}.pending`,path=join(f.root,name),legacy=join(f.root,`${randomUUID()}.pending`);
  await writeFile(path,Buffer.from("synthetic unauthenticated ciphertext"),{mode:0o600});await writeFile(legacy,Buffer.from("synthetic legacy"),{mode:0o600});
  await symlink(f.file,join(f.root,`${f.hh}_${f.requestId}_${randomUUID()}.pending`));f.expire();
  await expect(runAsUser(other,()=>f.vault.sweepExpiredPending(db,f.hh,f.requestId))).rejects.toThrow();
  expect(await runAsUser(owner,()=>f.vault.sweepExpiredPending(db,f.hh,f.requestId))).toMatchObject({removed:0,refused:2});expect(await stat(legacy)).toBeDefined();
 }finally{await f.cleanup();}
});
it("snapshot includes scoped account/profile/preferences/activity without provider or audit payloads",async()=>{
 const f=await fixture();await runAsUser(owner,()=>requestOwnerExport(db,f.hh,f.requestId));
 await admin.userProfile.upsert({where:{userId:owner},create:{userId:owner,displayName:"PUBLIC synthetic owner",locale:"en-US",timezone:"America/Chicago",country:"US"},update:{displayName:"PUBLIC synthetic owner"}});
 await admin.notificationPreference.upsert({where:{userId_kind_channel:{userId:owner,kind:"renewal",channel:"email"}},create:{userId:owner,kind:"renewal",channel:"email",enabled:false},update:{enabled:false}});
 await admin.notification.create({data:{householdId:f.hh,userId:owner,kind:"renewal",title:"excluded notification text",body:"PRIVATE_PROVIDER_CANARY",dedupeKey:randomUUID()}});
 await admin.auditLog.create({data:{householdId:f.hh,actorType:"user",actorId:owner,action:"item.created",targetType:"item",targetId:randomUUID(),meta:{neverExport:"PRIVATE_PROVIDER_CANARY"}}});
 await admin.auditLog.create({data:{householdId:f.hh,actorType:"user",actorId:owner,action:"unclassified.private",targetType:"private",meta:{neverExport:"PRIVATE_PROVIDER_CANARY"}}});
 const s=await runAsUser(owner,()=>readOwnerExportSnapshot(db,f.hh,f.requestId));
 expect(s.version).toBe(2);expect(s.account.email).toBe(`${owner}@example.test`);expect(s.profile?.displayName).toBe("PUBLIC synthetic owner");expect(s.household.name).toBe("PUBLIC export fixture");
 expect(s.notificationPreferences).toContainEqual({kind:"renewal",channel:"email",enabled:false});expect(s.notificationHistory).toHaveLength(1);expect(s.activityHistory.some(a=>a.action==="item.created")).toBe(true);
 expect(JSON.stringify(s)).not.toMatch(/PRIVATE_PROVIDER_CANARY|unclassified.private|excluded notification text/);expect(s.complete).toBe(false);
});
it("oversized profile field refuses the snapshot instead of silently truncating",async()=>{
 const f=await fixture();await runAsUser(owner,()=>requestOwnerExport(db,f.hh,f.requestId));
 await admin.userProfile.upsert({where:{userId:owner},create:{userId:owner,displayName:"x".repeat(301)},update:{displayName:"x".repeat(301)}});
 try{await expect(runAsUser(owner,()=>readOwnerExportSnapshot(db,f.hh,f.requestId))).rejects.toThrow();}finally{await admin.userProfile.update({where:{userId:owner},data:{displayName:"PUBLIC"}});}
});
it.each(["suspended", "deletion_pending"] as const)("refuses all export entry points for inactive account %s", async status=>{
 const f=await fixture();await runAsUser(owner,()=>requestOwnerExport(db,f.hh,f.requestId));
 await admin.user.update({where:{id:owner},data:{status}});
 try {
  await expect(runAsUser(owner,()=>requestOwnerExport(db,f.hh,randomUUID()))).rejects.toThrow();
  await expect(runAsUser(owner,()=>readOwnerExportStatus(db,f.hh,f.requestId))).rejects.toThrow();
  await expect(runAsUser(owner,()=>readOwnerExportPage(db,f.hh,f.requestId,"items"))).rejects.toThrow();
  await expect(runAsUser(owner,()=>readOwnerExportSnapshot(db,f.hh,f.requestId))).rejects.toThrow();
 } finally {await admin.user.update({where:{id:owner},data:{status:"active"}});}
});

/** Recreate only locally authenticated historical bytes. No old real artifact/key. */
async function historicalArtifact(f:Awaited<ReturnType<typeof vaultFixture>>,version:number,extra:Record<string,unknown>={}){
 const {createCipheriv}=await import("node:crypto");const current=await runAsUser(owner,()=>readOwnerExportSnapshot(db,f.hh,f.requestId));
 const {account,profile,household,notificationPreferences,notificationHistory,activityHistory,testSubscription,documentWork,...legacy}=current;
 void account;void profile;void household;void notificationPreferences;void notificationHistory;void activityHistory;void testSubscription;void documentWork;
 const snapshot=version===2?{...current,...extra}:{...legacy,version,...extra};
 if(version===2){delete (snapshot as Record<string,unknown>).testSubscription;delete (snapshot as Record<string,unknown>).documentWork;}
 const prefix=Buffer.from("pellum-local-export/v1\n"),nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",f.key,nonce);
 cipher.setAAD(Buffer.from(`pellum-local-export/v1\n${f.hh}\n${f.requestId}`));
 const body=Buffer.concat([cipher.update(JSON.stringify(snapshot)),cipher.final()]);
 await writeFile(f.file,Buffer.concat([prefix,nonce,cipher.getAuthTag(),body]),{mode:0o600});
}
it.each([1,2])("reads authenticated historical export v%s without inventing uncaptured data",async version=>{
 const f=await vaultFixture();try{
  await historicalArtifact(f,version);const bytes=await readFile(f.file);
  const built=await runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId));expect(built.reused).toBe(true);
  const text=(await runAsUser(owner,()=>f.vault.download(db,f.hh,f.requestId))).toString(),lines=text.trim().split("\n").map(l=>JSON.parse(l));
  expect(lines[0]).toMatchObject({version,complete:false,omissions:expect.arrayContaining(["test-subscription-state"])});
  expect(lines[0]).not.toHaveProperty("testSubscription");
  expect(lines[0]).not.toHaveProperty("documentWork");
  expect(lines[0].omissions).toContain("document-work-state");
  if(version===1){expect(lines.some(l=>l.type==="account")).toBe(false);expect(lines[0].omissions).toContain("account-and-profile");}
  expect(await readFile(f.file)).toEqual(bytes);
  await runAsUser(owner,()=>f.vault.revoke(db,f.hh,f.requestId));
  await expect(runAsUser(owner,()=>f.vault.download(db,f.hh,f.requestId))).rejects.toThrow();
 }finally{await f.cleanup();}
});
it.each([{version:3,extra:{}},{version:1,extra:{account:{email:"unapproved@example.test"}}},{version:1,extra:{complete:true}},{version:1,extra:{providerToken:"synthetic-forbidden"}}])("refuses unknown version or expanded legacy export schema %j",async value=>{
 const f=await vaultFixture();try{await historicalArtifact(f,value.version,value.extra);
  await expect(runAsUser(owner,()=>f.vault.build(db,f.hh,f.requestId))).rejects.toThrow("Local export unavailable");
  expect(await admin.localExportArtifact.count({where:{householdId:f.hh}})).toBe(0);
 }finally{await f.cleanup();}
});
