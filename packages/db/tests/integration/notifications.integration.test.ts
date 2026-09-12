import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database, type ScopedClient } from "../../src/scoped.js";
import { runAsUser } from "../../src/audit.js";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

let admin: PrismaClient, app: PrismaClient, db: Database;
const userA = randomUUID(), userB = randomUUID(), householdA = randomUUID(), householdB = randomUUID();
const own = randomUUID(), otherUser = randomUUID(), otherHousehold = randomUUID();
beforeAll(async () => {
  await bootstrapDatabase(); await grantAppUserLogin(); admin = adminClient();
  app = new PrismaClient({ datasourceUrl: APP_URL }); db = new Database(app);
  await admin.user.createMany({ data: [userA, userB].map((id) => ({ id, email: `${id}@example.test` })) });
  await admin.household.createMany({ data: [{ id: householdA, name: "A", createdBy: userA }, { id: householdB, name: "B", createdBy: userB }] });
  await admin.notification.createMany({ data: [
    { id: own, householdId: householdA, userId: userA },
    { id: otherUser, householdId: householdA, userId: userB },
    { id: otherHousehold, householdId: householdB, userId: userA },
  ].map((row) => ({ ...row, kind: "obligation.due_soon", title: "Saved notice", body: "A confirmed deadline", dedupeKey: "event-one" })) });
  await admin.notificationDelivery.createMany({ data: [own, otherUser, otherHousehold].map((notificationId) => ({ notificationId, channel: "email" })) });
  await admin.notificationPreference.createMany({ data: [userA, userB].map((userId) => ({ userId, kind: "digest.weekly", channel: "email", enabled: true })) });
}, 120_000);
afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { householdId: { in: [householdA, householdB] } } });
  await admin?.household.deleteMany({ where: { id: { in: [householdA, householdB] } } });
  await admin?.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await admin?.$disconnect(); await app?.$disconnect();
});
const scope = <T>(fn: (tx: ScopedClient) => Promise<T>) => runAsUser(userA, () => db.withHousehold(householdA, fn));

describe("notification request-role isolation", () => {
  it("requires both household and principal even for another user's notice in the same household", async () => {
    const rows = await scope<Array<{ id: string }>>((tx) => tx.notification.findMany());
    expect(rows.map((row) => row.id)).toEqual([own]);
    for (const id of [otherUser, otherHousehold]) expect(await scope((tx) => tx.notification.findUnique({ where: { id } }))).toBeNull();
    const deliveries = await scope<Array<{ notificationId: string }>>((tx) => tx.notificationDelivery.findMany());
    expect(deliveries.map((row) => row.notificationId)).toEqual([own]);
    const preferences = await scope<Array<{ userId: string }>>((tx) => tx.notificationPreference.findMany());
    expect(preferences.map((row) => row.userId)).toEqual([userA]);
  });
  it("fails closed with missing scope and does not retain settings on pooled connections", async () => {
    expect(await app.notification.findMany()).toEqual([]);
    expect(await app.notificationDelivery.findMany()).toEqual([]);
    expect(await app.notificationPreference.findMany()).toEqual([]);
    expect(await db.withHousehold(householdA, (tx) => tx.notification.findMany())).toEqual([]);
  });
  it("allows only read-state changes, not content forgery or delivery-state changes", async () => {
    const now = new Date();
    await scope((tx) => tx.notification.update({ where: { id: own }, data: { readAt: now } }));
    expect((await admin.notification.findUniqueOrThrow({ where: { id: own } })).readAt).toEqual(now);
    expect(await scope((tx) => tx.notification.updateMany({ where: { id: otherUser }, data: { readAt: now } }))).toEqual({ count: 0 });
    await expect(scope((tx) => tx.notification.update({ where: { id: own }, data: { title: "Forged notice" } }))).rejects.toThrow();
    await expect(scope((tx) => tx.notification.create({ data: { householdId: householdA, userId: userA, kind: "security", title: "Forged", body: "Forged", dedupeKey: "forged" } }))).rejects.toThrow();
    await expect(scope((tx) => tx.notificationDelivery.updateMany({ data: { status: "delivered" } }))).rejects.toThrow();
    expect(await admin.notification.count({ where: { dedupeKey: "forged" } })).toBe(0);
  });
  it("isolates preference writes and enforces non-suppressible security notices in the database", async () => {
    await scope((tx) => tx.notificationPreference.update({ where: { userId_kind_channel: { userId: userA, kind: "digest.weekly", channel: "email" } }, data: { enabled: false } }));
    expect(await scope((tx) => tx.notificationPreference.updateMany({ where: { userId: userB }, data: { enabled: false } }))).toEqual({ count: 0 });
    await expect(scope((tx) => tx.notificationPreference.create({ data: { userId: userB, kind: "value.found", channel: "email" } }))).rejects.toThrow();
    await expect(scope((tx) => tx.notificationPreference.create({ data: { userId: userA, kind: "security", channel: "email", enabled: false } }))).rejects.toThrow();
    expect((await admin.notificationPreference.findUniqueOrThrow({ where: { userId_kind_channel: { userId: userB, kind: "digest.weekly", channel: "email" } } })).enabled).toBe(true);
  });
  it("deduplicates the notice and each channel without crossing tenant or principal boundaries", async () => {
    await expect(admin.notification.create({ data: { householdId: householdA, userId: userA, kind: "obligation.due_soon", title: "Duplicate", body: "Duplicate", dedupeKey: "event-one" } })).rejects.toThrow();
    await expect(admin.notificationDelivery.create({ data: { notificationId: own, channel: "email" } })).rejects.toThrow();
    expect(await admin.notification.count({ where: { householdId: { in: [householdA, householdB] } } })).toBe(3);
  });
  it("forces RLS on all three new tables and leaves the request role without ownership or bypass", async () => {
    const rows = await admin.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; request_owner: boolean }>>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) = 'app_user' AS request_owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('notifications','notification_deliveries','notification_preferences')`;
    expect(rows).toHaveLength(3); expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity && !row.request_owner)).toBe(true);
    const roles = await admin.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`;
    expect(roles).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const indexes = await admin.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications' AND indexname = 'notifications_user_id_idx'`;
    expect(indexes).toHaveLength(1);
  });
});
