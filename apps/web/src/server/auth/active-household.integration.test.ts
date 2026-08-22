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
import { activeHouseholdFrom } from "@/lib/active-household";
import {
  HOUSEHOLD_HEADER,
  RequestContextError,
  membershipsVia,
  resolveRequestContext,
} from "./context";
import type { JwtVerifier } from "./jwt";

/**
 * Active-household selection against PostgreSQL 16 (blueprint P1-03).
 *
 * The shape the blueprint asks for: P belongs to A and B, Q belongs only to C. Every
 * assertion runs on the `app_user` connection where RLS applies, and the scoped reads
 * name no household id — the policy is what answers, so a resolver that picked the wrong
 * household would surface as the wrong household's data rather than as a passing test.
 */

const P = randomUUID();
const Q = randomUUID();
const A = randomUUID();
const B = randomUUID();
const C = randomUUID();

let admin: PrismaClient;
let db: Database;

const verifierFor = (userId: string): JwtVerifier =>
  ({
    verify: async (token: string) => {
      if (token !== `token-${userId}`) throw new Error("unexpected token");
      return { userId, email: `${userId}@example.test`, expiresAt: 0, issuedAt: 0 };
    },
  }) as unknown as JwtVerifier;

/** Drives the resolver exactly as the `/v1` boundary does: a real Request, real headers. */
function resolve(userId: string, candidate?: string | null) {
  const headers = new Headers({ cookie: `ab_session=token-${userId}` });
  if (candidate) headers.set(HOUSEHOLD_HEADER, candidate);
  return resolveRequestContext(new Request("http://localhost/v1/households/current", { headers }), {
    verifier: verifierFor(userId),
    memberships: membershipsVia(db),
    cookieName: "ab_session",
  });
}

/** The household name visible under the resolved scope — RLS decides which row that is. */
async function nameUnderScope(userId: string, candidate?: string | null): Promise<string | null> {
  const ctx = await resolve(userId, candidate);
  return db.withHousehold(ctx.householdId, async (tx) => {
    const row = await tx.household.findFirst({ select: { name: true } });
    return row?.name ?? null;
  });
}

const rejection = async (promise: Promise<unknown>): Promise<RequestContextError> => {
  try {
    await promise;
    throw new Error("expected a rejection");
  } catch (cause) {
    if (cause instanceof RequestContextError) return cause;
    throw cause;
  }
};

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();
  admin = adminClient();
  db = createDatabase(APP_URL());

  await admin.user.createMany({
    data: [
      { id: P, email: `${P}@example.test` },
      { id: Q, email: `${Q}@example.test` },
    ],
    skipDuplicates: true,
  });
  await admin.household.createMany({
    data: [
      { id: A, name: "Household A", createdBy: P },
      { id: B, name: "Household B", createdBy: P },
      { id: C, name: "Household C", createdBy: Q },
    ],
    skipDuplicates: true,
  });
  await admin.householdUser.createMany({
    data: [
      { householdId: A, userId: P, role: "owner" },
      { householdId: B, userId: P, role: "member" },
      { householdId: C, userId: Q, role: "owner" },
    ],
    skipDuplicates: true,
  });
}, 120_000);

afterAll(async () => {
  await admin?.household.deleteMany({ where: { id: { in: [A, B, C] } } });
  await admin?.user.deleteMany({ where: { id: { in: [P, Q] } } });
  await admin?.$disconnect();
  await db?.disconnect();
});

describe("Test C · more than one membership and no selection refuses to guess", () => {
  it("rejects with ambiguous-household, 400", async () => {
    const error = await rejection(resolve(P));
    expect(error.reason).toBe("ambiguous-household");
    expect(error.status).toBe(400);
  });
});

describe("Test D · a named membership resolves that household, and RLS follows", () => {
  it("P naming A reads A's data", async () => {
    const ctx = await resolve(P, A);
    expect(ctx.householdId).toBe(A);
    expect(ctx.role).toBe("owner");
    expect(await nameUnderScope(P, A)).toBe("Household A");
  });

  it("P naming B reads B's data — the same principal, a different scope", async () => {
    const ctx = await resolve(P, B);
    expect(ctx.householdId).toBe(B);
    // The role travels with the membership, not with the principal.
    expect(ctx.role).toBe("member");
    expect(await nameUnderScope(P, B)).toBe("Household B");
  });

  it("switching back and forth never leaks the other household's rows", async () => {
    for (const [household, expected] of [
      [A, "Household A"],
      [B, "Household B"],
      [A, "Household A"],
      [B, "Household B"],
    ] as const) {
      expect(await nameUnderScope(P, household)).toBe(expected);
      const visible = await db.withHousehold(household, (tx) =>
        tx.household.findMany({ select: { id: true } }),
      );
      expect(visible.map((h) => h.id)).toEqual([household]);
    }
  });
});

describe("Test E / F · a household the principal is not in is refused, and says nothing", () => {
  it("P naming C is not-a-member, 403", async () => {
    const error = await rejection(resolve(P, C));
    expect(error.reason).toBe("not-a-member");
    expect(error.status).toBe(403);
  });

  it("a household id that exists nowhere is refused identically", async () => {
    const nonexistent = await rejection(resolve(P, randomUUID()));
    const foreign = await rejection(resolve(P, C));
    // Same reason, same status, same message: confirming that C exists but belongs to
    // someone else would be an enumeration oracle.
    expect(nonexistent.reason).toBe(foreign.reason);
    expect(nonexistent.status).toBe(foreign.status);
    expect(nonexistent.message).toBe(foreign.message);
  });

  it("Q — a single-household principal — cannot reach A or B either", async () => {
    expect((await rejection(resolve(Q, A))).reason).toBe("not-a-member");
    expect((await rejection(resolve(Q, B))).reason).toBe("not-a-member");
  });
});

describe("Test B / H · one membership needs no selection, and cannot be redirected by one", () => {
  it("Q with no selection resolves C", async () => {
    const ctx = await resolve(Q);
    expect(ctx.householdId).toBe(C);
    expect(await nameUnderScope(Q)).toBe("Household C");
  });

  it("Q naming a foreign household is refused rather than switched", async () => {
    expect((await rejection(resolve(Q, A))).status).toBe(403);
    // And the refusal changes nothing: Q still resolves C on the next request.
    expect(await nameUnderScope(Q)).toBe("Household C");
  });
});

describe("Test G · a malformed selection is refused without a database lookup", () => {
  it.each(["not-a-uuid", "'; DROP TABLE households; --", "../../etc/passwd", "12345"])(
    "%s is malformed-household, 400",
    async (candidate) => {
      const error = await rejection(resolve(P, candidate));
      expect(error.reason).toBe("malformed-household");
      expect(error.status).toBe(400);
      // The message names no household and echoes nothing the caller sent.
      expect(error.message).not.toContain(candidate);
    },
  );
});

describe("Test I · the selection survives as a cookie across requests", () => {
  it("the cookie a browser would send resolves the same household every time", async () => {
    // What `(app)/layout.tsx` does: read the preference off the Cookie header, hand it to
    // the resolver as a candidate. Three separate requests, one persisted choice.
    const cookieHeader = `ab_session=token-${P}; ab_household=${B}; theme=dark`;
    for (let i = 0; i < 3; i += 1) {
      const preference = activeHouseholdFrom(cookieHeader);
      expect(preference).toBe(B);
      expect(await nameUnderScope(P, preference)).toBe("Household B");
    }
  });

  it("a tampered cookie is refused exactly like a tampered header", async () => {
    const tampered = activeHouseholdFrom(`ab_session=token-${P}; ab_household=${C}`);
    expect(tampered).toBe(C);
    expect((await rejection(resolve(P, tampered))).reason).toBe("not-a-member");
  });

  it("no cookie means no candidate, which is the ambiguity the chooser answers", async () => {
    expect(activeHouseholdFrom(`ab_session=token-${P}`)).toBeNull();
    expect((await rejection(resolve(P, null))).reason).toBe("ambiguous-household");
  });
});

describe("the switcher's option list is read under phase-1 scope", () => {
  it("P sees both households, Q sees only its own", async () => {
    const forP = await db.withPrincipal(P, (tx) =>
      tx.household.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } }),
    );
    expect(forP.map((h) => h.id).sort()).toEqual([A, B].sort());

    const forQ = await db.withPrincipal(Q, (tx) => tx.household.findMany({ select: { id: true } }));
    expect(forQ.map((h) => h.id)).toEqual([C]);
  });
});
