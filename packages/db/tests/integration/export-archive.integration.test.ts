import { randomUUID, createSecretKey, randomBytes, createHash } from "node:crypto";
import { mkdtemp, chmod, rm, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import { requestOwnerExport } from "../../src/privacy-export.js";
import { createLocalExportArchiveVault } from "../../src/local-export-archive.js";
import { localCleanCustody } from "../../src/local-clean-custody.js";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

let admin: PrismaClient, app: PrismaClient, db: Database, vaultRoot: string, custodyRoot: string;
const owner = randomUUID(), other = randomUUID(), households: string[] = [], key = createSecretKey(randomBytes(32));
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient(); app = new PrismaClient({ datasourceUrl: APP_URL }); db = new Database(app);
  await admin.user.createMany({ data: [owner, other].map(id => ({ id, email: `${id}@example.test` })) });
  vaultRoot = await mkdtemp("/private/tmp/pellum-export-vault-"); await chmod(vaultRoot, 0o700);
  custodyRoot = await mkdtemp("/private/tmp/pellum-clean-custody-"); await chmod(custodyRoot, 0o700);
}, 120_000);
afterAll(async () => {
  if (admin) {
    const where = { householdId: { in: households } };
    await admin.localExportArtifact.deleteMany({ where }); await admin.householdDeletion.deleteMany({ where });
    await admin.documentCustody.deleteMany({ where }); await admin.documentScan.deleteMany({ where });
    await admin.household.deleteMany({ where: { id: { in: households } } });
    await admin.outboxEvent.deleteMany({ where }); await admin.auditLog.deleteMany({ where });
    await admin.user.deleteMany({ where: { id: { in: [owner, other] } } });
  }
  await app?.$disconnect(); await admin?.$disconnect();
  await rm(vaultRoot, { recursive: true, force: true }); await rm(custodyRoot, { recursive: true, force: true });
});

/** Household with names/free text/attributes, one clean-custody original and, optionally, one unscanned upload. */
async function fixture(options: { unscanned?: boolean; secret?: boolean } = {}) {
  const hh = randomUUID(); households.push(hh);
  await admin.household.create({ data: { id: hh, name: "PUBLIC Reyes household", createdBy: owner } });
  await admin.householdUser.create({ data: { householdId: hh, userId: owner, role: "owner" } });
  await admin.userProfile.upsert({ where: { userId: owner }, create: { userId: owner, displayName: "PUBLIC Elena" }, update: {} });
  const member = await admin.householdMember.create({ data: { householdId: hh, displayName: "PUBLIC Elena Reyes", kind: "adult", dateOfBirth: new Date("1980-02-03") } });
  const item = await admin.item.create({ data: { householdId: hh, memberId: member.id, kind: "insurance_policy", name: "PUBLIC Home policy", vendorName: "PUBLIC Insurer", attrs: { deductibleNote: "PUBLIC free text" } } });
  await admin.obligation.create({ data: { householdId: hh, itemId: item.id, title: "PUBLIC Renew home policy", kind: "renewal", dueAt: new Date(Date.now() + 86400_000 * 20), source: "user" } });
  await admin.notification.create({ data: { householdId: hh, userId: owner, kind: "deadline", title: "PUBLIC Renewal soon", body: "PUBLIC body text", dedupeKey: randomUUID() } });
  const bytes = Buffer.from(`PUBLIC SYNTHETIC ${randomUUID()}`), sha = createHash("sha256").update(bytes).digest();
  const doc = randomUUID(), seal = randomUUID(), objectId = randomUUID(), scan = randomUUID();
  await admin.document.create({ data: { id: doc, householdId: hh, source: "upload", status: "processed", storagePath: `hh/${hh}/upload/${doc}/sealed/${seal}`,
    sizeBytes: bytes.length, mimeType: "application/pdf", sha256: sha, title: "PUBLIC Declarations page", extracted: { summary: "PUBLIC extracted" } } });
  await admin.documentScan.create({ data: { id: scan, householdId: hh, documentId: doc, sealId: seal, sha256: sha, sizeBytes: bytes.length, state: "clean" } });
  await admin.documentCustody.create({ data: { householdId: hh, documentId: doc, scanId: scan, objectId, sha256: sha, sizeBytes: bytes.length, state: "ready", reviewAt: new Date(Date.now() + 7 * 86400_000) } });
  localCleanCustody(custodyRoot).copy({ householdId: hh, objectId, sha256: sha.toString("hex"), size: bytes.length }, bytes);
  let pending: string | undefined;
  if (options.unscanned) { pending = randomUUID(); await admin.document.create({ data: { id: pending, householdId: hh, source: "upload", status: "scanning", storagePath: `hh/${hh}/upload/${pending}/sealed/${randomUUID()}`, sizeBytes: 10, mimeType: "image/png" } }); }
  if (options.secret) await admin.itemSecret.create({ data: { itemId: item.id, field: "policy_number", ciphertext: randomBytes(40), keyVersion: 1, last4: "9876" } });
  const requestId = randomUUID();
  await runAsUser(owner, () => requestOwnerExport(db, hh, requestId));
  return { hh, requestId, doc, pending, objectId, bytes };
}
const vault = () => createLocalExportArchiveVault(vaultRoot, key, localCleanCustody(custodyRoot));
/** Independent store-only ZIP reader: central directory -> names -> CRC-checked bytes. */
function unzip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10), cdOffset = zip.readUInt32LE(end + 16), files = new Map<string, Buffer>();
  for (let i = 0, p = cdOffset; i < count; i++) {
    const nameLen = zip.readUInt16LE(p + 28), crc = zip.readUInt32LE(p + 16), size = zip.readUInt32LE(p + 20), local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("ascii"), start = local + 30 + zip.readUInt16LE(local + 26);
    const data = zip.subarray(start, start + size); expect(crc32(data) >>> 0).toBe(crc);
    files.set(name, data); p += 46 + nameLen;
  }
  return files;
}
const lines = (b: Buffer | undefined) => (b?.toString("utf8") ?? "").split("\n").filter(Boolean).map(l => JSON.parse(l));

describe("export v3 archive", () => {
  it("contains every category with names, free text, attributes, audit and the verified original, and says what is missing", async () => {
    const f = await fixture({ unscanned: true });
    const built = await runAsUser(owner, () => vault().build(db, f.hh, f.requestId));
    expect(built).toMatchObject({ reused: false, complete: false, omissions: ["original-documents"] });
    const files = unzip(await runAsUser(owner, () => vault().download(db, f.hh, f.requestId)));
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    for (const c of manifest.categories) expect(createHash("sha256").update(files.get(c.file)!).digest("hex")).toBe(c.sha256);
    expect(manifest.categories.map((c: { name: string }) => c.name)).toContain("auditTrail");
    expect(manifest.originals.included).toEqual([expect.objectContaining({ documentId: f.doc, file: `originals/${f.doc}.pdf`, bytes: f.bytes.length })]);
    expect(files.get(`originals/${f.doc}.pdf`)!.equals(f.bytes)).toBe(true);
    expect(manifest.originals.notIncluded).toEqual([{ documentId: f.pending, reason: "not-scanned-clean" }]);
    expect(lines(files.get("data/items.jsonl"))[0]).toMatchObject({ name: "PUBLIC Home policy", vendorName: "PUBLIC Insurer", attributes: { deductibleNote: "PUBLIC free text" } });
    expect(lines(files.get("data/obligations.jsonl"))[0]).toMatchObject({ title: "PUBLIC Renew home policy" });
    expect(lines(files.get("data/members.jsonl"))[0]).toMatchObject({ displayName: "PUBLIC Elena Reyes", dateOfBirth: "1980-02-03" });
    expect(lines(files.get("data/notifications.jsonl"))[0]).toMatchObject({ body: "PUBLIC body text" });
    expect(lines(files.get("data/documents.jsonl")).find((d: { id: string }) => d.id === f.doc)).toMatchObject({ title: "PUBLIC Declarations page", extracted: { summary: "PUBLIC extracted" } });
    const everything = [...files.values()].map(b => b.toString("latin1")).join("");
    expect(everything).not.toContain(f.objectId);
    expect(everything).not.toContain("/sealed/");
    expect(await admin.localExportArtifact.findFirstOrThrow({ where: { householdId: f.hh, requestId: f.requestId } })).toMatchObject({ format: "archive-v3", complete: false });
    // Build is idempotent per request: a second call reuses the same authenticated artifact.
    expect(await runAsUser(owner, () => vault().build(db, f.hh, f.requestId))).toMatchObject({ reused: true, complete: false });
  });
  it("is complete only when nothing in scope is missing", async () => {
    const f = await fixture();
    expect(await runAsUser(owner, () => vault().build(db, f.hh, f.requestId))).toMatchObject({ complete: true, omissions: [] });
    const manifest = JSON.parse(unzip(await runAsUser(owner, () => vault().download(db, f.hh, f.requestId))).get("manifest.json")!.toString());
    expect(manifest).toMatchObject({ complete: true, omissions: [], originals: { notIncluded: [] } });
  });
  it("never reveals identifier values and is incomplete while any are stored", async () => {
    const f = await fixture({ secret: true });
    expect(await runAsUser(owner, () => vault().build(db, f.hh, f.requestId))).toMatchObject({ complete: false, omissions: ["identifier-values"] });
    const files = unzip(await runAsUser(owner, () => vault().download(db, f.hh, f.requestId)));
    expect([...files.values()].map(b => b.toString("latin1")).join("")).not.toContain("9876");
  });
  it("refuses tampered, transplanted or custody-mismatched bytes and non-owners", async () => {
    const f = await fixture(), g = await fixture();
    await runAsUser(owner, () => vault().build(db, f.hh, f.requestId));
    const file = join(vaultRoot, `${f.hh}_${f.requestId}.archive`), original = await readFile(file);
    const tampered = Buffer.from(original); tampered[tampered.length - 40] ^= 1; await writeFile(file, tampered);
    await expect(runAsUser(owner, () => vault().download(db, f.hh, f.requestId))).rejects.toThrow("Local export unavailable");
    await writeFile(file, original);
    // Another household's intent cannot open this ciphertext (household/request AAD).
    await copyFile(file, join(vaultRoot, `${g.hh}_${g.requestId}.archive`));
    await expect(runAsUser(owner, () => vault().download(db, g.hh, g.requestId))).rejects.toThrow("Local export unavailable");
    await rm(join(vaultRoot, `${g.hh}_${g.requestId}.archive`));
    await expect(runAsUser(other, () => vault().build(db, g.hh, g.requestId))).rejects.toThrow();
    // Custody bytes that no longer match the immutable binding refuse the whole build.
    const custodyFile = (await readdir(custodyRoot)).find(n => n.startsWith(g.hh))!;
    await chmod(join(custodyRoot, custodyFile), 0o600); await writeFile(join(custodyRoot, custodyFile), `PUBLIC SYNTHETIC ${randomUUID()}`);
    await expect(runAsUser(owner, () => vault().build(db, g.hh, g.requestId))).rejects.toThrow();
    expect(await admin.localExportArtifact.count({ where: { householdId: g.hh } })).toBe(0);
  });
  it("revocation removes the artifact and denies further downloads; a deletion fence refuses builds", async () => {
    const f = await fixture(), g = await fixture();
    await runAsUser(owner, () => vault().build(db, f.hh, f.requestId));
    expect(await runAsUser(owner, () => vault().revoke(db, f.hh, f.requestId))).toEqual({ localArtifactAbsent: true, providerAndBackupProof: false });
    await expect(runAsUser(owner, () => vault().download(db, f.hh, f.requestId))).rejects.toThrow();
    await expect(runAsUser(owner, () => vault().build(db, f.hh, f.requestId))).rejects.toThrow();
    await admin.householdDeletion.create({ data: { householdId: g.hh, requestedBy: owner, requestedAt: new Date(Date.now() - 20 * 86400000), undoUntil: new Date(Date.now() - 6 * 86400000), state: "fenced", fencedAt: new Date(Date.now() - 3600000), settleUntil: new Date(Date.now() - 2700000) } });
    await expect(runAsUser(owner, () => vault().build(db, g.hh, g.requestId))).rejects.toThrow();
  });
});
describe("export request bound", () => {
  it("allows three new requests per household per day, replays stay idempotent, a fourth refuses", async () => {
    const f = await fixture();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) await runAsUser(owner, () => requestOwnerExport(db, f.hh, id));
    await runAsUser(owner, () => requestOwnerExport(db, f.hh, ids[0]!));
    await expect(runAsUser(owner, () => requestOwnerExport(db, f.hh, randomUUID()))).rejects.toThrow("Privacy export unavailable");
    expect(await admin.outboxEvent.count({ where: { householdId: f.hh, eventType: "export.requested" } })).toBe(3);
  });
});
