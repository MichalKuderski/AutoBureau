import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@autobureau/db";
import {
  adminClient,
  assertExpectedServer,
  grantAppUserLogin,
  APP_URL,
} from "@/test/integration/database";
import { RequestContextError, membershipsVia, resolveRequestContext } from "@/server/auth/context";
import type { JwtVerifier } from "@/server/auth/jwt";
import { mirrorIdentity } from "./mirror";
import { bootstrapHouseholdId, ensureHousehold } from "./bootstrap";
import type { VerifiedPrincipal } from "@/server/auth/jwt";

/**
 * First-household bootstrap against PostgreSQL 16 (blueprint P1-02).
 *
 * Every assertion below runs on the `app_user` connection, where RLS applies. The admin
 * client appears only to seed a foreign household and to count rows from outside the
 * policy — a count taken on the application connection would prove nothing about
 * isolation, because the policy would have hidden the very rows the test is looking for.
 */

const FIRST = randomUUID();
const REPEAT = randomUUID();
const RACER = randomUUID();
const INVITED = randomUUID();
const STRANGER = randomUUID();
const FOREIGN_HOUSEHOLD = randomUUID();
const ATOMIC = randomUUID();

const created: string[] = [FIRST, REPEAT, RACER, INVITED, STRANGER, ATOMIC];

let admin: PrismaClient;
let db: Database;

const principal = (userId: string): VerifiedPrincipal => ({
  userId,
  email: `${userId}@example.test`,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  issuedAt: Math.floor(Date.now() / 1000),
});

/** A verifier that believes exactly one token — the subject is what the test controls. */
const verifierFor = (userId: string): JwtVerifier =>
  ({
    verify: async (token: string) => {
      if (token !== `token-for-${userId}`) throw new Error("unexpected token");
      return principal(userId);
    },
  }) as unknown as JwtVerifier;

/** The real resolver, driven exactly as `(app)/layout.tsx` and the `/v1` boundary drive it. */
function resolveFor(userId: string, householdHeader?: string) {
  const headers = new Headers({ cookie: `ab_session=token-for-${userId}` });
  if (householdHeader) headers.set("x-household-id", householdHeader);
  return resolveRequestContext(new Request("http://localhost/", { headers }), {
    verifier: verifierFor(userId),
    memberships: membershipsVia(db),
    cookieName: "ab_session",
  });
}

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();
  admin = adminClient();
  db = createDatabase(APP_URL());
}, 120_000);

afterAll(async () => {
  await admin?.household.deleteMany({
    where: { id: { in: [...created.map(bootstrapHouseholdId), FOREIGN_HOUSEHOLD] } },
  });
  await admin?.user.deleteMany({ where: { id: { in: created } } });
  await admin?.$disconnect();
  await db?.disconnect();
});

describe("Test A · the first principal gets a household, membership and entitlement", () => {
  it("creates exactly one of each, all pointing at the same household", async () => {
    await mirrorIdentity(db, principal(FIRST));

    // The pre-P1-02 state, asserted rather than assumed: mirrored, and belonging nowhere.
    await expect(resolveFor(FIRST)).rejects.toMatchObject({ reason: "no-membership", status: 403 });

    const result = await ensureHousehold(db, FIRST);
    expect(result.created).toBe(true);

    const households = await admin.household.findMany({ where: { createdBy: FIRST } });
    expect(households).toHaveLength(1);
    expect(households[0]!.id).toBe(result.householdId);

    const memberships = await admin.householdUser.findMany({ where: { userId: FIRST } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.householdId).toBe(result.householdId);
    expect(memberships[0]!.role).toBe("owner");

    const entitlements = await admin.entitlement.findMany({
      where: { householdId: result.householdId },
    });
    expect(entitlements).toHaveLength(1);
    // The schema's own defaults — this task invents no plan, quota or billing state.
    expect(entitlements[0]!.plan).toBe("free");
    expect(entitlements[0]!.docsPerMonth).toBe(10);
    expect(entitlements[0]!.membersMax).toBe(2);
    expect(entitlements[0]!.docsUsedThisPeriod).toBe(0);
  });
});

describe("Test D · the new household reaches the authenticated application", () => {
  it("resolves a RequestContext through the real resolver", async () => {
    const ctx = await resolveFor(FIRST);
    expect(ctx.userId).toBe(FIRST);
    expect(ctx.householdId).toBe(bootstrapHouseholdId(FIRST));
    expect(ctx.role).toBe("owner");
  });

  it("serves the data the (app) layout reads, through RLS", async () => {
    const ctx = await resolveFor(FIRST);
    // The same scoped reads `(app)/layout.tsx` performs — no household id in any `where`,
    // because the policy is what scopes them.
    const data = await db.withHousehold(ctx.householdId, async (tx) => ({
      household: await tx.household.findFirst({ select: { id: true, name: true } }),
      entitlement: await tx.entitlement.findFirst({ select: { plan: true } }),
    }));
    expect(data.household?.id).toBe(ctx.householdId);
    expect(data.household?.name).toBe("Your household");
    expect(data.entitlement?.plan).toBe("free");
  });
});

describe("Test B / H · repeating the bootstrap converges instead of creating another", () => {
  it("returns the same household and writes nothing on the second call", async () => {
    await mirrorIdentity(db, principal(REPEAT));
    const first = await ensureHousehold(db, REPEAT);
    expect(first.created).toBe(true);

    const auditBefore = await admin.auditLog.count();
    const second = await ensureHousehold(db, REPEAT);

    expect(second.created).toBe(false);
    expect(second.householdId).toBe(first.householdId);
    expect(await admin.auditLog.count()).toBe(auditBefore);
    expect(await admin.household.count({ where: { createdBy: REPEAT } })).toBe(1);
    expect(await admin.householdUser.count({ where: { userId: REPEAT } })).toBe(1);
    expect(await admin.entitlement.count({ where: { householdId: first.householdId } })).toBe(1);
  });

  it("is stable across many repeats", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) ids.add((await ensureHousehold(db, REPEAT)).householdId);
    expect(ids.size).toBe(1);
    expect(await admin.household.count({ where: { createdBy: REPEAT } })).toBe(1);
  });
});

describe("Test C · concurrent first sign-ins converge on one household", () => {
  it("produces exactly one household, one owner membership and one entitlement", async () => {
    await mirrorIdentity(db, principal(RACER));

    // Eight at once, all racing the same derived primary key.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => ensureHousehold(db, RACER)),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(
      rejected,
      JSON.stringify(rejected.map((r) => String((r as PromiseRejectedResult).reason))),
    ).toHaveLength(0);

    const householdIds = new Set(
      results.map((r) => (r as PromiseFulfilledResult<{ householdId: string }>).value.householdId),
    );
    expect(householdIds.size).toBe(1);
    expect([...householdIds][0]).toBe(bootstrapHouseholdId(RACER));

    // Exactly one winner reports having created it.
    expect(
      results.filter(
        (r) => (r as PromiseFulfilledResult<{ created: boolean }>).value.created,
      ),
    ).toHaveLength(1);

    expect(await admin.household.count({ where: { createdBy: RACER } })).toBe(1);
    expect(await admin.householdUser.count({ where: { userId: RACER } })).toBe(1);
    expect(await admin.entitlement.count({ where: { householdId: bootstrapHouseholdId(RACER) } })).toBe(1);
  });

  it("the primary key is what converges them — losers raise P2002 and write nothing", async () => {
    // `ensureHousehold` reads before it writes, and the pool often lets one attempt finish
    // before the next looks — so the suite above can converge without ever reaching the
    // constraint. This drives the creating transaction directly, which is the only way to
    // prove the invariant the design actually rests on.
    const racer = randomUUID();
    created.push(racer);
    await mirrorIdentity(db, principal(racer));
    const householdId = bootstrapHouseholdId(racer);

    const { runAsUser } = await import("@autobureau/db");
    const create = () =>
      runAsUser(racer, () =>
        db.withHousehold(householdId, async (tx) => {
          await tx.household.create({
            data: { id: householdId, name: "Your household", createdBy: racer },
          });
          await tx.householdUser.create({ data: { householdId, userId: racer, role: "owner" } });
          await tx.entitlement.create({ data: { householdId, periodStart: new Date() } });
        }),
      );

    const results = await Promise.allSettled([create(), create(), create(), create()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const failure of rejected) {
      expect((failure.reason as { code?: string }).code).toBe("P2002");
    }
    // Three aborted transactions, and not one of them left a row anywhere.
    expect(await admin.household.count({ where: { id: householdId } })).toBe(1);
    expect(await admin.householdUser.count({ where: { userId: racer } })).toBe(1);
    expect(await admin.entitlement.count({ where: { householdId } })).toBe(1);
  });

  it("refuses to attach membership to a household it did not create", async () => {
    // The defensive branch, and the reason the household row is inserted first: if the id
    // is already taken by a household this principal has no membership in, the bootstrap
    // must fail rather than quietly granting itself a seat in someone else's household.
    const intruder = randomUUID();
    const occupant = randomUUID();
    created.push(intruder, occupant);
    await mirrorIdentity(db, principal(intruder));
    await mirrorIdentity(db, principal(occupant));
    const householdId = bootstrapHouseholdId(intruder);
    await admin.household.create({
      data: { id: householdId, name: "Occupied", createdBy: occupant },
    });

    await expect(ensureHousehold(db, intruder)).rejects.toMatchObject({ code: "P2002" });
    expect(await admin.householdUser.count({ where: { userId: intruder } })).toBe(0);
    expect(await admin.entitlement.count({ where: { householdId } })).toBe(0);
  });

  it("leaves no partial lifecycle behind — the losers wrote nothing at all", async () => {
    const householdId = bootstrapHouseholdId(RACER);
    const audit = await admin.auditLog.findMany({ where: { householdId } });
    // One creating transaction: household, membership, entitlement. The seven losers
    // aborted before commit, so none of their audit rows survive either.
    expect(audit.map((row) => row.action).sort()).toEqual([
      "entitlement.create",
      "household.create",
      "householduser.create",
    ]);
    for (const row of audit) {
      expect(row.actorId).toBe(RACER);
      expect(row.actorType).toBe("user");
    }
  });
});

describe("Test E / F · RLS and foreign households", () => {
  it("the owner sees only their own household under scope", async () => {
    await admin.user.create({ data: { id: STRANGER, email: `${STRANGER}@example.test` } });
    await admin.household.create({
      data: { id: FOREIGN_HOUSEHOLD, name: "Someone else", createdBy: STRANGER },
    });
    await admin.householdUser.create({
      data: { householdId: FOREIGN_HOUSEHOLD, userId: STRANGER, role: "owner" },
    });

    const ctx = await resolveFor(FIRST);
    const visible = await db.withHousehold(ctx.householdId, (tx) =>
      tx.household.findMany({ select: { id: true } }),
    );
    expect(visible.map((h) => h.id)).toEqual([ctx.householdId]);
  });

  it("refuses a foreign household named in the header, indistinguishably from a missing one", async () => {
    await expect(resolveFor(FIRST, FOREIGN_HOUSEHOLD)).rejects.toMatchObject({
      reason: "not-a-member",
      status: 403,
    });
    // A household id that exists nowhere produces the identical rejection.
    await expect(resolveFor(FIRST, randomUUID())).rejects.toMatchObject({
      reason: "not-a-member",
      status: 403,
    });
  });

  it("a new household sees none of the foreign household's rows", async () => {
    const rows = await db.withHousehold(FOREIGN_HOUSEHOLD, (tx) =>
      tx.householdUser.findMany({ where: { userId: FIRST } }),
    );
    expect(rows).toEqual([]);
  });
});

describe("an invited principal joins the household they were invited to", () => {
  it("does not create a second, empty household of their own", async () => {
    await mirrorIdentity(db, principal(INVITED));
    // Membership granted by an owner before this principal ever signed in.
    await admin.householdUser.create({
      data: { householdId: FOREIGN_HOUSEHOLD, userId: INVITED, role: "member" },
    });

    const result = await ensureHousehold(db, INVITED);
    expect(result.created).toBe(false);
    expect(result.householdId).toBe(FOREIGN_HOUSEHOLD);
    expect(await admin.household.count({ where: { createdBy: INVITED } })).toBe(0);

    const ctx = await resolveFor(INVITED);
    expect(ctx.householdId).toBe(FOREIGN_HOUSEHOLD);
    expect(ctx.role).toBe("member");
  });
});

describe("Test I · the lifecycle is atomic", () => {
  it("leaves nothing behind when the unit of work fails partway", async () => {
    await mirrorIdentity(db, principal(ATOMIC));
    const householdId = bootstrapHouseholdId(ATOMIC);
    const auditBefore = await admin.auditLog.count();

    // Drive the same transaction shape the bootstrap uses and fail it after the household
    // and membership rows exist — the state that must never survive.
    const { runAsUser } = await import("@autobureau/db");
    await expect(
      runAsUser(ATOMIC, () =>
        db.withHousehold(householdId, async (tx) => {
          await tx.household.create({
            data: { id: householdId, name: "Your household", createdBy: ATOMIC },
          });
          await tx.householdUser.create({ data: { householdId, userId: ATOMIC, role: "owner" } });
          throw new Error("failure before the entitlement");
        }),
      ),
    ).rejects.toThrow("failure before the entitlement");

    expect(await admin.household.count({ where: { id: householdId } })).toBe(0);
    expect(await admin.householdUser.count({ where: { userId: ATOMIC } })).toBe(0);
    expect(await admin.entitlement.count({ where: { householdId } })).toBe(0);
    expect(await admin.auditLog.count()).toBe(auditBefore);

    // And the principal is still admissible afterwards — a failed bootstrap is retryable.
    const recovered = await ensureHousehold(db, ATOMIC);
    expect(recovered.created).toBe(true);
    expect(recovered.householdId).toBe(householdId);
  });
});

describe("Test G · an unauthenticated caller reaches none of this", () => {
  it("resolves nothing without a session cookie", async () => {
    await expect(
      resolveRequestContext(new Request("http://localhost/"), {
        verifier: verifierFor(FIRST),
        memberships: membershipsVia(db),
        cookieName: "ab_session",
      }),
    ).rejects.toBeInstanceOf(RequestContextError);
  });

  it("refuses to bootstrap a principal that was never mirrored", async () => {
    // No `users` row means the membership foreign key cannot be satisfied. The lifecycle
    // fails rather than inventing an identity, and writes nothing.
    const ghost = randomUUID();
    await expect(ensureHousehold(db, ghost)).rejects.toThrow();
    expect(await admin.household.count({ where: { id: bootstrapHouseholdId(ghost) } })).toBe(0);
    expect(await admin.householdUser.count({ where: { userId: ghost } })).toBe(0);
  });
});

describe("Test J · the derived id is stable and well formed", () => {
  it("is deterministic for a principal and different across principals", () => {
    expect(bootstrapHouseholdId(FIRST)).toBe(bootstrapHouseholdId(FIRST));
    expect(bootstrapHouseholdId(FIRST)).not.toBe(bootstrapHouseholdId(REPEAT));
  });

  it("is a UUID the scoped client will accept", () => {
    // `scoped.ts` validates version 1-8 and the RFC 9562 variant before opening a scope;
    // an id that failed this would make every bootstrap throw ScopeError instead.
    expect(bootstrapHouseholdId(FIRST)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
