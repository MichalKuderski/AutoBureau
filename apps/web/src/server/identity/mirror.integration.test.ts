import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditError, createDatabase, runAsUser, type Database } from "@autobureau/db";
import { adminClient, assertExpectedServer, grantAppUserLogin, APP_URL } from "@/test/integration/database";
import { MirrorError, mirrorIdentity } from "./mirror";
import type { VerifiedPrincipal } from "@/server/auth/jwt";

/**
 * Identity mirroring against PostgreSQL 16 (ADR-009 D8).
 *
 * The principal here stands in for a verified token — every field on it is something
 * the verifier extracted from a signature it checked. No provider is involved: this
 * slice is about what happens to the database once a token has been believed.
 */

const NEW_USER = randomUUID();
const RACER = randomUUID();
const NO_EMAIL = randomUUID();
const MEMBER = randomUUID();
const HOUSEHOLD = randomUUID();

let admin: PrismaClient;
let db: Database;

const principal = (userId: string, email: string | undefined): VerifiedPrincipal => ({
  userId,
  email,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  issuedAt: Math.floor(Date.now() / 1000),
});

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();
  admin = adminClient();
  db = createDatabase(APP_URL());
}, 120_000);

afterAll(async () => {
  await admin?.household.deleteMany({ where: { id: HOUSEHOLD } });
  await admin?.user.deleteMany({ where: { id: { in: [NEW_USER, RACER, NO_EMAIL, MEMBER] } } });
  await admin?.$disconnect();
  await db?.disconnect();
});

const auditFor = (userId: string) =>
  admin.auditLog.findMany({ where: { actorId: userId }, orderBy: { id: "asc" } });

describe("a new authenticated identity is mirrored", () => {
  it("creates the users row from the verified claims", async () => {
    const result = await mirrorIdentity(db, principal(NEW_USER, "new@example.test"));
    expect(result.created).toBe(true);

    const user = await admin.user.findUniqueOrThrow({ where: { id: NEW_USER } });
    expect(user.email).toBe("new@example.test");
    expect(user.status).toBe("active");
  });

  it("creates the user_profiles row", async () => {
    const profile = await admin.userProfile.findUniqueOrThrow({ where: { userId: NEW_USER } });
    // display_name is NOT NULL with no default and no frozen guidance; the verified
    // address is the only value the system knows at this moment. Onboarding replaces it.
    expect(profile.displayName).toBe("new@example.test");
    expect(profile.locale).toBe("en-US");
  });

  it("audits the mirror as a household-less row attributed by the database", async () => {
    const rows = await auditFor(NEW_USER);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.householdId).toBeNull();
      expect(row.actorId).toBe(NEW_USER);
      expect(row.actorType).toBe("user");
    }
    expect(rows.map((r) => r.action)).toContain("user.createmany");
  });
});

describe("mirroring is idempotent", () => {
  it("finds the existing identity and creates nothing", async () => {
    const before = await admin.auditLog.count();
    const result = await mirrorIdentity(db, principal(NEW_USER, "new@example.test"));
    expect(result.created).toBe(false);

    expect(await admin.user.count({ where: { id: NEW_USER } })).toBe(1);
    expect(await admin.userProfile.count({ where: { userId: NEW_USER } })).toBe(1);
    // The common path writes nothing, so it audits nothing. A row per sign-in would be
    // noise rather than a record.
    expect(await admin.auditLog.count()).toBe(before);
  });

  it("does not overwrite a profile the user has since edited", async () => {
    await admin.userProfile.update({
      where: { userId: NEW_USER },
      data: { displayName: "Dana Reyes" },
    });
    await mirrorIdentity(db, principal(NEW_USER, "new@example.test"));
    const profile = await admin.userProfile.findUniqueOrThrow({ where: { userId: NEW_USER } });
    expect(profile.displayName).toBe("Dana Reyes");
  });
});

describe("concurrent first logins converge on one identity", () => {
  it("produces exactly one users and one user_profiles row", async () => {
    const attempts = Array.from({ length: 8 }, () =>
      mirrorIdentity(db, principal(RACER, "racer@example.test")),
    );
    const results = await Promise.allSettled(attempts);

    // Constraints, not a mutex: the losers insert zero rows via ON CONFLICT DO NOTHING.
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected, JSON.stringify(rejected.map((r) => String((r as PromiseRejectedResult).reason)))).toHaveLength(0);

    expect(await admin.user.count({ where: { id: RACER } })).toBe(1);
    expect(await admin.userProfile.count({ where: { userId: RACER } })).toBe(1);
  });

  it("survives two transactions reaching the insert at once", async () => {
    // The suite above rarely reaches the constraint: mirrorIdentity reads first, and the
    // pool usually lets one attempt finish before the next looks. This drives the write
    // path directly so the ON CONFLICT DO NOTHING behaviour is actually exercised —
    // without it the second transaction raises a unique violation.
    const id = randomUUID();
    const email = `${id}@example.test`;
    const insert = () =>
      runAsUser(id, () =>
        db.withIdentity(id, async (tx) => {
          await tx.user.createMany({ data: [{ id, email }], skipDuplicates: true });
          await tx.userProfile.createMany({
            data: [{ userId: id, displayName: email }],
            skipDuplicates: true,
          });
        }),
      );

    const results = await Promise.allSettled([insert(), insert()]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(
      rejected,
      JSON.stringify(rejected.map((r) => String((r as PromiseRejectedResult).reason))),
    ).toHaveLength(0);
    expect(await admin.user.count({ where: { id } })).toBe(1);
    expect(await admin.userProfile.count({ where: { userId: id } })).toBe(1);

    await admin.user.deleteMany({ where: { id } });
  });

  it("leaves the identity consistent afterwards", async () => {
    const user = await admin.user.findUniqueOrThrow({ where: { id: RACER } });
    const profile = await admin.userProfile.findUniqueOrThrow({ where: { userId: RACER } });
    expect(user.email).toBe("racer@example.test");
    expect(profile.userId).toBe(user.id);
  });
});

describe("mirroring fails closed", () => {
  it("refuses a token with no email rather than inventing one", async () => {
    await expect(mirrorIdentity(db, principal(NO_EMAIL, undefined))).rejects.toBeInstanceOf(
      MirrorError,
    );
    expect(await admin.user.count({ where: { id: NO_EMAIL } })).toBe(0);
    expect(await admin.userProfile.count({ where: { userId: NO_EMAIL } })).toBe(0);
  });

  it("rolls back completely when the unit of work fails partway", async () => {
    const id = randomUUID();
    const before = await admin.auditLog.count();
    await expect(
      runAsUser(id, () =>
        db.withIdentity(id, async (tx) => {
          await tx.user.createMany({ data: [{ id, email: `${id}@example.test` }] });
          throw new Error("failure after the users row");
        }),
      ),
    ).rejects.toThrow("failure after the users row");

    // No partially usable identity: no user, no profile, no audit row.
    expect(await admin.user.count({ where: { id } })).toBe(0);
    expect(await admin.userProfile.count({ where: { userId: id } })).toBe(0);
    expect(await admin.auditLog.count()).toBe(before);
  });

  it("refuses to write identity rows with no actor established", async () => {
    // The D5 floor still applies inside an identity scope: a mutation nobody is
    // accountable for is refused before it reaches the database.
    const id = randomUUID();
    await expect(
      db.withIdentity(id, (tx) =>
        tx.user.createMany({ data: [{ id, email: `${id}@example.test` }] }),
      ),
    ).rejects.toBeInstanceOf(AuditError);
    expect(await admin.user.count({ where: { id } })).toBe(0);
  });

  it("rejects a non-UUID subject before opening a transaction", async () => {
    await expect(mirrorIdentity(db, principal("not-a-uuid", "x@example.test"))).rejects.toThrow();
  });
});

describe("a mirrored identity can then resolve a household", () => {
  it("resolves membership once one exists, and not before", async () => {
    await mirrorIdentity(db, principal(MEMBER, "member@example.test"));

    // Freshly mirrored and not yet in any household: the existing no-membership answer.
    const none = await db.withPrincipal(MEMBER, (tx) => tx.householdUser.findMany());
    expect(none).toEqual([]);

    await admin.household.create({ data: { id: HOUSEHOLD, name: "H", createdBy: MEMBER } });
    await admin.householdUser.create({
      data: { householdId: HOUSEHOLD, userId: MEMBER, role: "owner" },
    });

    const memberships = await db.withPrincipal(MEMBER, (tx) => tx.householdUser.findMany());
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.householdId).toBe(HOUSEHOLD);
    expect(memberships[0]?.role).toBe("owner");
  });

  it("the foreign key that made mirroring necessary is real", async () => {
    // Without a mirrored users row this insert is impossible — which is precisely why an
    // unmirrored principal could never have a membership to find.
    const orphan = randomUUID();
    await expect(
      admin.householdUser.create({ data: { householdId: HOUSEHOLD, userId: orphan, role: "member" } }),
    ).rejects.toThrow();
  });
});
