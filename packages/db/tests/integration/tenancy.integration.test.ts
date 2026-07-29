import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database, ScopeError } from "../../src/scoped.js";
import { outbox } from "../../src/outbox.js";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

/**
 * Tenant-isolation suite — the executable form of review blocker F-01.
 *
 * These tests are the reason the RLS design is trustworthy rather than merely
 * documented. They are required to pass before any feature work merges (doc 11 §1).
 */

const HOUSEHOLD_A = randomUUID();
const HOUSEHOLD_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();

let admin: PrismaClient;
let appPrisma: PrismaClient;
let db: Database;

beforeAll(async () => {
  bootstrapDatabase();
  await grantAppUserLogin();

  admin = adminClient();
  // Seed two households as the superuser (bypasses RLS by design).
  await admin.user.createMany({
    data: [
      { id: USER_A, email: `a-${USER_A}@example.test` },
      { id: USER_B, email: `b-${USER_B}@example.test` },
    ],
    skipDuplicates: true,
  });
  await admin.household.createMany({
    data: [
      { id: HOUSEHOLD_A, name: "Household A", createdBy: USER_A },
      { id: HOUSEHOLD_B, name: "Household B", createdBy: USER_B },
    ],
    skipDuplicates: true,
  });
  await admin.item.createMany({
    data: [
      { householdId: HOUSEHOLD_A, kind: "passport", name: "A: passport" },
      { householdId: HOUSEHOLD_A, kind: "lease", name: "A: lease" },
      { householdId: HOUSEHOLD_B, kind: "passport", name: "B: passport" },
    ],
  });

  appPrisma = new PrismaClient({ datasources: { db: { url: APP_URL } } });
  db = new Database(appPrisma);
}, 120_000);

afterAll(async () => {
  await admin?.household.deleteMany({ where: { id: { in: [HOUSEHOLD_A, HOUSEHOLD_B] } } });
  await admin?.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  await admin?.$disconnect();
  await appPrisma?.$disconnect();
});

describe("scoped reads", () => {
  it("returns only the scoped household's rows", async () => {
    const items = await db.withHousehold(HOUSEHOLD_A, (tx) =>
      tx.item.findMany({ orderBy: { name: "asc" } }),
    );
    expect(items.map((i) => i.name)).toEqual(["A: lease", "A: passport"]);
  });

  it("cannot see another household even when explicitly filtering for it", async () => {
    const leaked = await db.withHousehold(HOUSEHOLD_A, (tx) =>
      tx.item.findMany({ where: { householdId: HOUSEHOLD_B } }),
    );
    expect(leaked).toEqual([]);
  });

  it("cannot reach another household's row by primary key", async () => {
    const target = await admin.item.findFirstOrThrow({ where: { householdId: HOUSEHOLD_B } });
    const found = await db.withHousehold(HOUSEHOLD_A, (tx) =>
      tx.item.findUnique({ where: { id: target.id } }),
    );
    expect(found).toBeNull();
  });
});

describe("scoped writes", () => {
  it("rejects writing a row into another household (RLS WITH CHECK)", async () => {
    await expect(
      db.withHousehold(HOUSEHOLD_A, (tx) =>
        tx.item.create({
          data: { householdId: HOUSEHOLD_B, kind: "warranty", name: "smuggled" },
        }),
      ),
    ).rejects.toThrow();

    const count = await admin.item.count({ where: { name: "smuggled" } });
    expect(count).toBe(0);
  });

  it("cannot update another household's row", async () => {
    const target = await admin.item.findFirstOrThrow({ where: { householdId: HOUSEHOLD_B } });
    const result = await db.withHousehold(HOUSEHOLD_A, (tx) =>
      tx.item.updateMany({ where: { id: target.id }, data: { name: "hijacked" } }),
    );
    expect(result.count).toBe(0);

    const after = await admin.item.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.name).toBe("B: passport");
  });
});

describe("fail-closed behavior", () => {
  it("returns zero rows when no scope is established", async () => {
    // Querying outside withHousehold: the GUC is unset, app.current_household()
    // is NULL, every policy predicate is NULL. This is the deny-all half of F-01 —
    // proving it is deny-all and not allow-all is the point of this test.
    const items = await appPrisma.item.findMany();
    expect(items).toEqual([]);
  });

  it("rejects a non-UUID household id before touching the database", async () => {
    await expect(
      db.withHousehold("'; DROP TABLE items; --", async () => "unreachable"),
    ).rejects.toBeInstanceOf(ScopeError);
  });
});

describe("scope lifetime (the pooled-connection leak F-01 warned about)", () => {
  it("does not leak scope into a subsequent transaction on the same connection", async () => {
    await db.withHousehold(HOUSEHOLD_A, (tx) => tx.item.findMany());

    // Same pool, immediately after: if the scope had been set at session level it
    // would still be in force here and this would return household A's rows.
    const afterScoped = await appPrisma.item.findMany();
    expect(afterScoped).toEqual([]);

    const raw = await appPrisma.$queryRaw<Array<{ h: string | null }>>`
      SELECT app.current_household()::text AS h`;
    expect(raw[0]?.h).toBeNull();
  });

  it("keeps scopes independent across interleaved households", async () => {
    const [a, b] = await Promise.all([
      db.withHousehold(HOUSEHOLD_A, (tx) => tx.item.count()),
      db.withHousehold(HOUSEHOLD_B, (tx) => tx.item.count()),
    ]);
    expect(a).toBe(2);
    expect(b).toBe(1);
  });
});

describe("outbox atomicity (ADR-005)", () => {
  it("writes the domain row and its event in one transaction", async () => {
    const name = `atomic-${randomUUID()}`;
    await db.withHousehold(HOUSEHOLD_A, async (tx) => {
      const item = await tx.item.create({
        data: { householdId: HOUSEHOLD_A, kind: "subscription", name },
      });
      await outbox(tx).emit({
        event_type: "item.created",
        aggregate_type: "item",
        aggregate_id: item.id,
        household_id: HOUSEHOLD_A,
        payload: { kind: "subscription" },
      });
    });

    const events = await admin.outboxEvent.findMany({ where: { householdId: HOUSEHOLD_A } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("item.created");
  });

  it("rolls the event back when the domain write fails", async () => {
    const before = await admin.outboxEvent.count();
    await expect(
      db.withHousehold(HOUSEHOLD_A, async (tx) => {
        const item = await tx.item.create({
          data: { householdId: HOUSEHOLD_A, kind: "vehicle", name: "doomed" },
        });
        await outbox(tx).emit({
          event_type: "item.created",
          aggregate_type: "item",
          aggregate_id: item.id,
          household_id: HOUSEHOLD_A,
          payload: {},
        });
        throw new Error("domain failure after event write");
      }),
    ).rejects.toThrow("domain failure");

    expect(await admin.outboxEvent.count()).toBe(before);
    expect(await admin.item.count({ where: { name: "doomed" } })).toBe(0);
  });
});

describe("audit log is append-only", () => {
  it("permits insert but denies update and delete", async () => {
    await db.withHousehold(HOUSEHOLD_A, (tx) =>
      tx.auditLog.create({
        data: {
          householdId: HOUSEHOLD_A,
          actorType: "user",
          actorId: USER_A,
          action: "item.created",
          targetType: "item",
        },
      }),
    );

    await expect(
      db.withHousehold(HOUSEHOLD_A, (tx) =>
        tx.auditLog.updateMany({ where: { householdId: HOUSEHOLD_A }, data: { action: "tampered" } }),
      ),
    ).rejects.toThrow();

    await expect(
      db.withHousehold(HOUSEHOLD_A, (tx) =>
        tx.auditLog.deleteMany({ where: { householdId: HOUSEHOLD_A } }),
      ),
    ).rejects.toThrow();
  });
});
