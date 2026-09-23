import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database, type ScopedClient } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";
let admin: PrismaClient, app: PrismaClient, db: Database;
const user = randomUUID(), household = randomUUID(), foreignHousehold = randomUUID();
const own = randomUUID(), second = randomUUID(), foreign = randomUUID();
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient();
  app = new PrismaClient({ datasourceUrl: APP_URL }); db = new Database(app);
  await admin.user.create({ data: { id: user, email: `${user}@example.test` } });
  await admin.household.createMany({ data: [household, foreignHousehold].map((id) => ({ id, name: "Upload test", createdBy: user })) });
  await admin.document.createMany({ data: [own, second, foreign].map((id) => ({ id, householdId: id === foreign ? foreignHousehold : household,
    source: "upload", storagePath: `pending/${id}`, mimeType: "application/pdf", sizeBytes: 10, sha256: null })) });
  await admin.documentUpload.createMany({ data: [own, foreign].map((documentId) => ({ documentId, objectKey: `hh/${documentId}/pending`, expiresAt: new Date(Date.now() + 900_000) })) });
}, 120_000);
afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { householdId: { in: [household, foreignHousehold] } } });
  await admin?.household.deleteMany({ where: { id: { in: [household, foreignHousehold] } } });
  await admin?.user.deleteMany({ where: { id: user } }); await admin?.$disconnect(); await app?.$disconnect();
});
const scoped = <T>(fn: (tx: ScopedClient) => Promise<T>) => runAsUser(user, () => db.withHousehold(household, fn));
describe("upload capability ledger boundaries", () => {
  it("allows pending unknown hashes but retains household uniqueness for verified hashes", async () => {
    expect(await admin.document.count({ where: { householdId: household, sha256: null } })).toBe(2);
    const hash = createHash("sha256").update("actual-test-bytes").digest();
    await admin.document.update({ where: { id: own }, data: { sha256: hash } });
    await expect(admin.document.update({ where: { id: second }, data: { sha256: hash } })).rejects.toThrow();
    await admin.document.update({ where: { id: foreign }, data: { sha256: hash } });
  });
  it("derives read/insert visibility from the parent document and fails closed without scope", async () => {
    expect((await scoped((tx) => tx.documentUpload.findMany())).map((row) => row.documentId)).toEqual([own]);
    expect(await app.documentUpload.findMany()).toEqual([]);
    expect(await scoped((tx) => tx.documentUpload.findUnique({ where: { documentId: foreign } }))).toBeNull();
    await scoped((tx) => tx.documentUpload.create({ data: { documentId: second, objectKey: `pending/${second}`, expiresAt: new Date(Date.now() + 900_000) } }));
    await admin.documentUpload.delete({ where: { documentId: foreign } });
    await expect(scoped((tx) => tx.documentUpload.create({ data: { documentId: foreign, objectKey: "forged", expiresAt: new Date(Date.now() + 900_000) } }))).rejects.toThrow();
    expect(await admin.documentUpload.findUnique({ where: { documentId: foreign } })).toBeNull();
  });
  it("allows completion timestamps but rejects capability-key or expiry extension through the request role", async () => {
    const completedAt = new Date();
    await scoped((tx) => tx.documentUpload.update({ where: { documentId: own }, data: { completedAt } }));
    expect((await admin.documentUpload.findUniqueOrThrow({ where: { documentId: own } })).completedAt).toEqual(completedAt);
    await expect(scoped((tx) => tx.documentUpload.update({ where: { documentId: own }, data: { objectKey: "replaced" } }))).rejects.toThrow();
    await expect(scoped((tx) => tx.documentUpload.update({ where: { documentId: own }, data: { expiresAt: new Date(Date.now() + 86_400_000) } }))).rejects.toThrow();
    await expect(scoped((tx) => tx.documentUpload.delete({ where: { documentId: own } }))).rejects.toThrow();
  });
  it("rejects invalid lifecycle timestamps and cascades only the deleted document's capability", async () => {
    await expect(admin.documentUpload.update({ where: { documentId: own }, data: { expiresAt: new Date(0) } })).rejects.toThrow();
    await expect(scoped((tx) => tx.documentUpload.update({ where: { documentId: own }, data: { completedAt: new Date(0) } }))).rejects.toThrow();
    await admin.document.delete({ where: { id: second } });
    expect(await admin.documentUpload.findUnique({ where: { documentId: second } })).toBeNull();
    expect(await admin.documentUpload.findUnique({ where: { documentId: own } })).not.toBeNull();
    const rows = await admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>>`
      SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class
      WHERE oid = 'public.document_uploads'::regclass`;
    expect(rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(rows[0]?.owner).not.toBe("app_user");
  });
});
