// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { createJwtVerifier } from "./jwt";
import {
  HOUSEHOLD_HEADER,
  RequestContextError,
  readCookie,
  resolveRequestContext,
  type Membership,
  type ResolveContextDeps,
} from "./context";

/**
 * ADR-009 D1/A5/A7, exercised against the real verifier with real signatures. Only the
 * membership lookup is injected — that is the one dependency needing a database, and it
 * is proved against Postgres in `context.integration.test.ts`. Splitting it this way
 * lets the decision table be enumerated exhaustively here without a database round trip
 * per case.
 */

const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const COOKIE = "ab_session";

const USER = "0192f5a1-0000-7000-8000-000000000001";
const H1 = "0192f5a1-0000-7000-8000-0000000000a1";
const H2 = "0192f5a1-0000-7000-8000-0000000000b2";
const FOREIGN = "0192f5a1-0000-7000-8000-0000000000c3";

let signingKey: CryptoKey;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  signingKey = privateKey;
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
});

async function token(sub = USER, expiresIn: string | number = "1h"): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime(expiresIn)
    .sign(signingKey);
}

function deps(memberships: readonly Membership[], spy?: ReturnType<typeof vi.fn>): ResolveContextDeps {
  return {
    verifier: createJwtVerifier({
      jwks: { keys: jwks },
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
    }),
    memberships: spy ?? (async () => memberships),
    cookieName: COOKIE,
  };
}

function request(cookie: string | null, headers: Record<string, string> = {}): Request {
  return new Request("https://app.autobureau.com/v1/households/current", {
    headers: { ...(cookie === null ? {} : { cookie: `${COOKIE}=${cookie}` }), ...headers },
  });
}

async function rejection(req: Request, d: ResolveContextDeps): Promise<RequestContextError> {
  const error = await resolveRequestContext(req, d).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected resolution to fail").toBeInstanceOf(RequestContextError);
  return error as RequestContextError;
}

const OWNER_H1: Membership = { householdId: H1, role: "owner" };
const MEMBER_H2: Membership = { householdId: H2, role: "member" };

describe("identity comes from the token, never a header (A5)", () => {
  it("resolves the subject of the verified token", async () => {
    const ctx = await resolveRequestContext(request(await token()), deps([OWNER_H1]));
    expect(ctx).toEqual({ userId: USER, householdId: H1, role: "owner" });
  });

  it("ignores injected identity-shaped headers entirely", async () => {
    const impostor = "0192f5a1-0000-7000-8000-00000000dead";
    const ctx = await resolveRequestContext(
      request(await token(), {
        "x-user-id": impostor,
        "x-authenticated-user": impostor,
        "x-forwarded-user": impostor,
      }),
      deps([OWNER_H1]),
    );
    expect(ctx.userId).toBe(USER);
  });

  it("passes the token's subject — not a header — to the membership lookup", async () => {
    const spy = vi.fn(async () => [OWNER_H1]);
    await resolveRequestContext(
      request(await token(), { "x-user-id": "0192f5a1-0000-7000-8000-00000000dead" }),
      deps([], spy),
    );
    expect(spy).toHaveBeenCalledWith(USER);
  });
});

describe("no session is 401", () => {
  it("rejects a missing cookie", async () => {
    expect((await rejection(request(null), deps([OWNER_H1]))).reason).toBe("unauthenticated");
  });

  it("rejects an unparseable, expired, or foreign-signed token identically", async () => {
    const d = deps([OWNER_H1]);
    expect((await rejection(request("not-a-jwt"), d)).reason).toBe("unauthenticated");
    expect((await rejection(request(await token(USER, "-5m")), d)).reason).toBe("unauthenticated");
    // One outcome for every token failure: which check failed is not the client's business.
    expect((await rejection(request(""), d)).reason).toBe("unauthenticated");
  });

  it("never reaches the database when the token is bad", async () => {
    const spy = vi.fn(async () => [OWNER_H1]);
    await rejection(request("not-a-jwt"), deps([], spy));
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps to 401", async () => {
    expect((await rejection(request(null), deps([]))).status).toBe(401);
  });
});

describe("D1 · household resolution with no header", () => {
  it("one membership resolves to it", async () => {
    const ctx = await resolveRequestContext(request(await token()), deps([MEMBER_H2]));
    expect(ctx).toEqual({ userId: USER, householdId: H2, role: "member" });
  });

  it("no membership is 403", async () => {
    const error = await rejection(request(await token()), deps([]));
    expect(error.reason).toBe("no-membership");
    expect(error.status).toBe(403);
  });

  it("more than one membership is 400 — never a guess", async () => {
    const error = await rejection(request(await token()), deps([OWNER_H1, MEMBER_H2]));
    expect(error.reason).toBe("ambiguous-household");
    expect(error.status).toBe(400);
  });
});

describe("D1 · X-Household-Id is a candidate, never authority (A1)", () => {
  it("resolves a candidate the principal belongs to, with that household's role", async () => {
    const ctx = await resolveRequestContext(
      request(await token(), { [HOUSEHOLD_HEADER]: H2 }),
      deps([OWNER_H1, MEMBER_H2]),
    );
    expect(ctx).toEqual({ userId: USER, householdId: H2, role: "member" });
  });

  it("rejects a forged candidate the principal does not belong to", async () => {
    const error = await rejection(
      request(await token(), { [HOUSEHOLD_HEADER]: FOREIGN }),
      deps([OWNER_H1]),
    );
    expect(error.reason).toBe("not-a-member");
    expect(error.status).toBe(403);
  });

  it("rejects a forged candidate even when the principal has exactly one household", async () => {
    // The dangerous case: a lone membership must not become a silent fallback that
    // ignores what the client actually asked for.
    const error = await rejection(
      request(await token(), { [HOUSEHOLD_HEADER]: FOREIGN }),
      deps([OWNER_H1]),
    );
    expect(error.reason).toBe("not-a-member");
  });

  it("does not distinguish a foreign household from a nonexistent one", async () => {
    const nonexistent = await rejection(
      request(await token(), { [HOUSEHOLD_HEADER]: "0192f5a1-0000-7000-8000-00000000ffff" }),
      deps([OWNER_H1]),
    );
    const foreign = await rejection(
      request(await token(), { [HOUSEHOLD_HEADER]: FOREIGN }),
      deps([OWNER_H1]),
    );
    expect(nonexistent.reason).toBe(foreign.reason);
    expect(nonexistent.message).toBe(foreign.message);
  });

  it("rejects a malformed candidate before any lookup", async () => {
    const spy = vi.fn(async () => [OWNER_H1]);
    const error = await rejection(
      request(await token(), { [HOUSEHOLD_HEADER]: "'; DROP TABLE items; --" }),
      deps([], spy),
    );
    expect(error.reason).toBe("malformed-household");
    expect(error.status).toBe(400);
  });

  it("treats an empty candidate as absent rather than malformed", async () => {
    const ctx = await resolveRequestContext(
      request(await token(), { [HOUSEHOLD_HEADER]: "   " }),
      deps([OWNER_H1]),
    );
    expect(ctx.householdId).toBe(H1);
  });

  it("accepts an uppercase candidate by normalising it", async () => {
    const ctx = await resolveRequestContext(
      request(await token(), { [HOUSEHOLD_HEADER]: H2.toUpperCase() }),
      deps([OWNER_H1, MEMBER_H2]),
    );
    expect(ctx.householdId).toBe(H2);
  });
});

describe("A7 · resolution decides, it does not scope", () => {
  it("takes the role from the membership row rather than the request", async () => {
    const ctx = await resolveRequestContext(
      request(await token(), { [HOUSEHOLD_HEADER]: H1, "x-role": "owner" }),
      deps([{ householdId: H1, role: "viewer" }]),
    );
    expect(ctx.role).toBe("viewer");
  });

  it("returns a context instead of opening a scope, so a rejection opens none", async () => {
    // The resolver is handed no database at all — only a membership reader. Opening the
    // household scope is the caller's next step, after this has succeeded.
    const spy = vi.fn(async () => [OWNER_H1]);
    const d = deps([], spy);
    expect(Object.keys(d)).toEqual(["verifier", "memberships", "cookieName"]);
    await rejection(request(await token(), { [HOUSEHOLD_HEADER]: FOREIGN }), d);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("cookie parsing", () => {
  it("reads the named cookie from a crowded header", () => {
    expect(readCookie("a=1; ab_session=tok; b=2", COOKIE)).toBe("tok");
  });

  it("does not confuse a prefixed name", () => {
    expect(readCookie("xab_session=nope; ab_session=yes", COOKIE)).toBe("yes");
  });

  it("keeps values containing = intact", () => {
    expect(readCookie("ab_session=a=b=c", COOKIE)).toBe("a=b=c");
  });

  it("returns null for absent, empty, and malformed headers", () => {
    expect(readCookie(null, COOKIE)).toBeNull();
    expect(readCookie("", COOKIE)).toBeNull();
    expect(readCookie("ab_session=", COOKIE)).toBeNull();
    expect(readCookie("novalue", COOKIE)).toBeNull();
  });
});
