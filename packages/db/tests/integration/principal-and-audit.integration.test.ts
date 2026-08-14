import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../../src/scoped.js";
import { AuditError, recordAudit, runAsSystem, runAsUser } from "../../src/audit.js";
import { APP_URL, adminClient, bootstrapDatabase, grantAppUserLogin } from "./setup.js";

/**
 * ADR-009 D5/D6, proved against the database CI actually runs.
 *
 * These behaviours were originally established by throwaway probes that — as it later
 * turned out — ran against a stray PostgreSQL 18 instance shadowing the container. The
 * conclusions held, but "held on PG18" is not the claim the acceptance criteria make.
 * This suite re-establishes them on pgvector/pg16 through the shipped code path rather
 * than through hand-written SQL, so what is proved is what is deployed.
 *
 * Acceptance criteria covered: A9, A10, A11, A12, A13, A14, A15, A16, and the D1
 * resolution rules that sit on top of phase-1 enumeration.
 */

const U_MULTI = randomUUID(); // member of H1 and H2 — the ambiguous case
const U_SINGLE = randomUUID(); // member of H1 only
const U_NONE = randomUUID(); // member of nothing
const U_OTHER = randomUUID(); // member of H3 only
const H1 = randomUUID();
const H2 = randomUUID();
const H3 = randomUUID();

let admin: PrismaClient;
let appPrisma: PrismaClient;
let db: Database;
let seededObligation: string;

beforeAll(async () => {
  await bootstrapDatabase();
  await grantAppUserLogin();
  admin = adminClient();

  await admin.user.createMany({
    data: [U_MULTI, U_SINGLE, U_NONE, U_OTHER].map((id) => ({ id, email: `${id}@example.test` })),
    skipDuplicates: true,
  });
  await admin.household.createMany({
    data: [
      { id: H1, name: "H1", createdBy: U_MULTI },
      { id: H2, name: "H2", createdBy: U_MULTI },
      { id: H3, name: "H3", createdBy: U_OTHER },
    ],
  });
  await admin.householdUser.createMany({
    data: [
      { householdId: H1, userId: U_MULTI, role: "owner" },
      { householdId: H2, userId: U_MULTI, role: "owner" },
      { householdId: H1, userId: U_SINGLE, role: "member" },
      { householdId: H3, userId: U_OTHER, role: "owner" },
    ],
  });
  await admin.item.createMany({
    data: [
      { householdId: H1, kind: "passport", name: "H1 passport" },
      { householdId: H3, kind: "passport", name: "H3 passport" },
    ],
  });
  const ob = await admin.obligation.create({
    data: { householdId: H1, title: "seed", kind: "renewal", source: "system", dueAt: new Date() },
  });
  seededObligation = ob.id;

  appPrisma = new PrismaClient({ datasources: { db: { url: APP_URL } } });
  db = new Database(appPrisma);
}, 120_000);

afterAll(async () => {
  await admin?.household.deleteMany({ where: { id: { in: [H1, H2, H3] } } });
  await admin?.user.deleteMany({ where: { id: { in: [U_MULTI, U_SINGLE, U_NONE, U_OTHER] } } });
  await admin?.$disconnect();
  await appPrisma?.$disconnect();
});

const auditCount = () => admin.auditLog.count();
const lastAudit = () => admin.auditLog.findFirst({ orderBy: { id: "desc" } });

// ─────────────────────────── D5 phase 1 ───────────────────────────

describe("A9 · phase 1 enumerates only the principal's own memberships", () => {
  it.each([
    ["one membership", () => U_SINGLE, 1],
    ["two memberships", () => U_MULTI, 2],
    ["no memberships", () => U_NONE, 0],
  ])("%s", async (_label, user, expected) => {
    const rows = await db.withPrincipal(user(), (tx) => tx.householdUser.findMany());
    expect(rows).toHaveLength(expected);
    expect(rows.every((r) => r.userId === user())).toBe(true);
  });

  it("cannot read another user's membership rows", async () => {
    const rows = await db.withPrincipal(U_NONE, (tx) =>
      tx.householdUser.findMany({ where: { userId: U_MULTI } }),
    );
    expect(rows).toEqual([]);
  });

  it("cannot read a household's membership list it does not belong to", async () => {
    const rows = await db.withPrincipal(U_OTHER, (tx) =>
      tx.householdUser.findMany({ where: { householdId: H1 } }),
    );
    expect(rows).toEqual([]);
  });

  it("grants no household data — only the identity needed to choose one", async () => {
    const items = await db.withPrincipal(U_MULTI, (tx) => tx.item.findMany());
    expect(items).toEqual([]);
  });

  it("lists exactly the principal's own households", async () => {
    const mine = await db.withPrincipal(U_MULTI, (tx) => tx.household.findMany());
    expect(mine.map((h) => h.id).sort()).toEqual([H1, H2].sort());
    expect(await db.withPrincipal(U_NONE, (tx) => tx.household.findMany())).toEqual([]);
  });
});

describe("D1 · household resolution rules sit on phase-1 enumeration", () => {
  /** The resolver's decision, expressed exactly as ADR-009 D1 states it. */
  const resolve = async (userId: string, candidate?: string) => {
    const memberships = await db.withPrincipal(userId, (tx) => tx.householdUser.findMany());
    if (candidate !== undefined) {
      const match = memberships.find((m) => m.householdId === candidate);
      return match ? { status: 200, household: candidate, role: match.role } : { status: 403 };
    }
    if (memberships.length === 0) return { status: 403 };
    if (memberships.length > 1) return { status: 400 };
    return { status: 200, household: memberships[0]!.householdId, role: memberships[0]!.role };
  };

  it("no header, one membership → that household", async () => {
    expect(await resolve(U_SINGLE)).toEqual({ status: 200, household: H1, role: "member" });
  });

  it("no header, no membership → 403", async () => {
    expect(await resolve(U_NONE)).toEqual({ status: 403 });
  });

  it("no header, ambiguous → 400, never a guess", async () => {
    expect(await resolve(U_MULTI)).toEqual({ status: 400 });
  });

  it("forged candidate → 403, and no household scope is ever opened", async () => {
    expect(await resolve(U_SINGLE, H3)).toEqual({ status: 403 });
  });

  it("valid candidate → resolves with the role from the membership row", async () => {
    expect(await resolve(U_MULTI, H2)).toEqual({ status: 200, household: H2, role: "owner" });
  });
});

// ─────────────────────────── D5 phase 2 ───────────────────────────

describe("A10 · phase 2 admits no union from the self-read policies", () => {
  it("sees the selected household's members and none of the principal's elsewhere", async () => {
    const rows = await runAsUser(U_MULTI, () =>
      db.withHousehold(H1, (tx) => tx.householdUser.findMany()),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.householdId !== H1)).toEqual([]);
    expect(rows.some((r) => r.householdId === H2)).toBe(false);
  });

  it("sees only the selected household itself", async () => {
    const rows = await runAsUser(U_MULTI, () =>
      db.withHousehold(H1, (tx) => tx.household.findMany()),
    );
    expect(rows.map((h) => h.id)).toEqual([H1]);
  });

  it("keeps household isolation intact for domain rows", async () => {
    const own = await runAsUser(U_MULTI, () => db.withHousehold(H1, (tx) => tx.item.findMany()));
    expect(own).toHaveLength(1);

    const foreign = await runAsUser(U_MULTI, () =>
      db.withHousehold(H1, (tx) => tx.item.findMany({ where: { householdId: H3 } })),
    );
    expect(foreign).toEqual([]);

    const target = await admin.item.findFirstOrThrow({ where: { householdId: H3 } });
    const byPk = await runAsUser(U_MULTI, () =>
      db.withHousehold(H1, (tx) => tx.item.findUnique({ where: { id: target.id } })),
    );
    expect(byPk).toBeNull();
  });
});

describe("A12 · self-read policies do not widen writes", () => {
  it("a principal cannot grant itself membership", async () => {
    await expect(
      db.withPrincipal(U_NONE, (tx) =>
        tx.householdUser.create({ data: { householdId: H1, userId: U_NONE, role: "owner" } }),
      ),
    ).rejects.toThrow();
    expect(await admin.householdUser.count({ where: { userId: U_NONE } })).toBe(0);
  });

  it("a principal cannot escalate its own role", async () => {
    await expect(
      db.withPrincipal(U_SINGLE, (tx) =>
        tx.householdUser.updateMany({ where: { userId: U_SINGLE }, data: { role: "owner" } }),
      ),
    ).rejects.toThrow();
    const row = await admin.householdUser.findFirstOrThrow({ where: { userId: U_SINGLE } });
    expect(row.role).toBe("member");
  });
});

// ─────────────────────────── D6 audit ───────────────────────────

describe("A13 · the audit floor cannot be bypassed", () => {
  it("rejects a mutation with no actor established, and writes nothing", async () => {
    const before = await auditCount();
    await expect(
      db.withHousehold(H1, (tx) =>
        tx.item.create({ data: { householdId: H1, kind: "lease", name: "no-actor" } }),
      ),
    ).rejects.toBeInstanceOf(AuditError);

    expect(await admin.item.count({ where: { name: "no-actor" } })).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("still allows reads without an actor — only mutations are attributed", async () => {
    const items = await db.withHousehold(H1, (tx) => tx.item.findMany());
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("A11 · the actor is stamped by the database", () => {
  it("attributes a mutation to the authenticated principal", async () => {
    const before = await auditCount();
    await runAsUser(U_MULTI, () =>
      db.withHousehold(H1, (tx) =>
        tx.item.create({ data: { householdId: H1, kind: "warranty", name: "attributed" } }),
      ),
    );
    expect(await auditCount()).toBe(before + 1);

    const row = await lastAudit();
    expect(row?.actorId).toBe(U_MULTI);
    expect(row?.actorType).toBe("user");
    expect(row?.action).toBe("item.create");
    expect(row?.householdId).toBe(H1);
  });

  it("records system work without a principal", async () => {
    const before = await auditCount();
    await runAsSystem("integration fixture write", () =>
      db.withHousehold(H1, (tx) =>
        tx.item.create({ data: { householdId: H1, kind: "loan", name: "system-made" } }),
      ),
    );
    const row = await lastAudit();
    expect(await auditCount()).toBe(before + 1);
    expect(row?.actorType).toBe("system");
    expect(row?.actorId).toBeNull();
  });

  it("refuses a user-attributed row with no principal in scope", async () => {
    // The CHECK constraint, reached directly: a system-actor transaction sets no
    // principal, so an INSERT claiming actor_type='user' has nothing to stamp.
    await expect(
      runAsSystem("check constraint probe", () =>
        db.withHousehold(H1, (tx) =>
          tx.$executeRaw`INSERT INTO audit_log (household_id, actor_type, action, target_type)
                         VALUES (${H1}::uuid, 'user', 'obligation.dismissed', 'obligation')`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("A14 · a required domain verb cannot be omitted", () => {
  it("rejects the mutation and leaves the domain row untouched", async () => {
    const before = await auditCount();
    await expect(
      runAsUser(U_MULTI, () =>
        db.withHousehold(H1, (tx) =>
          tx.obligation.update({ where: { id: seededObligation }, data: { title: "silent" } }),
        ),
      ),
    ).rejects.toBeInstanceOf(AuditError);

    const row = await admin.obligation.findUniqueOrThrow({ where: { id: seededObligation } });
    expect(row.title).toBe("seed");
    expect(await auditCount()).toBe(before);
  });

  it("records the declared verb in place of the CRUD action", async () => {
    await runAsUser(U_MULTI, () =>
      db.withHousehold(
        H1,
        (tx) => tx.obligation.update({ where: { id: seededObligation }, data: { status: "dismissed" } }),
        { verb: "obligation.dismissed" },
      ),
    );
    expect((await lastAudit())?.action).toBe("obligation.dismissed");
  });
});

describe("A15 · audit is atomic with the domain write", () => {
  it("rolls the audit row back when the unit of work fails", async () => {
    const before = await auditCount();
    await expect(
      runAsUser(U_MULTI, () =>
        db.withHousehold(H1, async (tx) => {
          await tx.item.create({ data: { householdId: H1, kind: "vehicle", name: "doomed" } });
          throw new Error("domain failure after the mutation");
        }),
      ),
    ).rejects.toThrow("domain failure");

    expect(await admin.item.count({ where: { name: "doomed" } })).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("writes one row per mutation and none for reads", async () => {
    const before = await auditCount();
    await runAsUser(U_MULTI, () =>
      db.withHousehold(H1, async (tx) => {
        await tx.item.create({ data: { householdId: H1, kind: "membership", name: "m1" } });
        await tx.item.create({ data: { householdId: H1, kind: "certification", name: "m2" } });
        await tx.item.findMany();
      }),
    );
    expect(await auditCount()).toBe(before + 2);
  });
});

describe("A16 · actions no write-interceptor can observe", () => {
  it("records secret.revealed explicitly, with the actor still stamped by the database", async () => {
    const before = await auditCount();
    await runAsUser(U_SINGLE, () =>
      db.withHousehold(H1, (tx) =>
        recordAudit(tx, "secret.revealed", { type: "item_secret", id: null }),
      ),
    );
    const row = await lastAudit();
    expect(await auditCount()).toBe(before + 1);
    expect(row?.action).toBe("secret.revealed");
    expect(row?.actorId).toBe(U_SINGLE);
  });

  it("refuses an action outside the registry", async () => {
    await expect(
      runAsUser(U_SINGLE, () =>
        db.withHousehold(H1, (tx) =>
          // @ts-expect-error — the type rejects it; the runtime check is the belt.
          recordAudit(tx, "item.smuggled", { type: "item" }),
        ),
      ),
    ).rejects.toBeInstanceOf(AuditError);
  });
});
