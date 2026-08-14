import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "@/test/integration/database";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";

/**
 * ADR-009 A1–A8, end to end over HTTP against PostgreSQL 16.
 *
 * The subject under test is the *shipped* handler: `GET` is imported from
 * `app/v1/households/current/route.ts` and invoked with real `Request` objects, and the
 * assertions are made on the real `Response`. Nothing below the boundary is stubbed —
 * the token is signed with a real key and resolved through a real JWKS endpoint,
 * membership comes from Postgres under RLS, and the household read is scoped by the
 * policy rather than by a where-clause.
 *
 * The route reads its configuration from the environment, so the environment is what
 * this file sets up (the same pattern the session and PKCE suites use). Injecting a
 * config object instead would mean testing a handler assembled here rather than the one
 * that ships — which is exactly the defect this file previously had.
 */

const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const COOKIE = "ab_session";
const ORIGIN = "https://app.autobureau.com";

const OWNER = randomUUID(); // owner of A, member of B → ambiguous without a header
const VIEWER = randomUUID(); // viewer of A only
const LONER = randomUUID(); // member of C only
const ORPHAN = randomUUID(); // member of nothing
const A = randomUUID();
const B = randomUUID();
const C = randomUUID();

let admin: PrismaClient;
let signingKey: CryptoKey;
let jwks: JSONWebKeySet;
let jwksServer: Server;
/** The exported handler from the route module — not a copy assembled here. */
let GET: (request: Request) => Promise<Response>;

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();

  admin = adminClient();
  await admin.user.createMany({
    data: [OWNER, VIEWER, LONER, ORPHAN].map((id) => ({ id, email: `${id}@example.test` })),
  });
  await admin.household.createMany({
    data: [
      { id: A, name: "Household A", createdBy: OWNER },
      { id: B, name: "Household B", createdBy: OWNER },
      { id: C, name: "Household C", createdBy: LONER },
    ],
  });
  await admin.householdUser.createMany({
    data: [
      { householdId: A, userId: OWNER, role: "owner" },
      { householdId: B, userId: OWNER, role: "member" },
      { householdId: A, userId: VIEWER, role: "viewer" },
      { householdId: C, userId: LONER, role: "owner" },
    ],
  });

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  signingKey = privateKey;
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(jwks));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const port = (jwksServer.address() as AddressInfo).port;

  // Set before the route module is imported: it resolves its configuration on first
  // request and caches it. `apiUrl`/`anonKey` are required by the config shape but never
  // reached — this boundary verifies tokens, it does not call the provider.
  process.env["AUTH_ISSUER"] = ISSUER;
  process.env["AUTH_AUDIENCE"] = AUDIENCE;
  process.env["AUTH_JWKS_URL"] = `http://127.0.0.1:${port}/jwks.json`;
  process.env["AUTH_API_URL"] = `http://127.0.0.1:${port}`;
  process.env["AUTH_ANON_KEY"] = "unused-by-this-boundary";
  process.env["AUTH_COOKIE_NAME"] = COOKIE;
  process.env["APP_ORIGIN"] = ORIGIN;

  ({ GET } = await import("@/app/v1/households/current/route"));
}, 120_000);

afterAll(async () => {
  await admin?.household.deleteMany({ where: { id: { in: [A, B, C] } } });
  await admin?.user.deleteMany({ where: { id: { in: [OWNER, VIEWER, LONER, ORPHAN] } } });
  await admin?.$disconnect();
  await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
});

async function token(sub: string, expiresIn: string | number = "1h"): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime(expiresIn)
    .sign(signingKey);
}

function get(cookie: string | null, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/v1/households/current`, {
    method: "GET",
    headers: { ...(cookie === null ? {} : { cookie: `${COOKIE}=${cookie}` }), ...headers },
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

// ─────────────────────────── A2 · authenticated context ───────────────────────────

describe("A2 · an authenticated request resolves and is served", () => {
  it("returns the single household of a single-membership principal", async () => {
    const response = await GET(get(await token(LONER)));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ id: C, name: "Household C", role: "owner" });
  });

  it("carries the role from the membership row", async () => {
    const response = await GET(get(await token(VIEWER)));
    expect(await body(response)).toMatchObject({ id: A, role: "viewer" });
  });

  it("never caches household data", async () => {
    const response = await GET(get(await token(LONER)));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("unauthenticated requests are refused", () => {
  it.each([
    ["no cookie", null],
    ["garbage token", "not-a-jwt"],
    ["empty cookie", ""],
  ])("%s → 401 problem+json", async (_label, cookie) => {
    const response = await GET(get(cookie));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await body(response)).toMatchObject({
      type: "https://autobureau.com/problems/unauthorized",
      status: 401,
    });
  });

  it("refuses an expired token", async () => {
    expect((await GET(get(await token(LONER, "-5m")))).status).toBe(401);
  });

  it("refuses a token signed by a foreign key", async () => {
    const foreign = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(LONER)
      .setExpirationTime("1h")
      .sign(foreign.privateKey);
    expect((await GET(get(forged))).status).toBe(401);
  });
});

// ─────────────────────── A1 · forged household · A5 · identity ───────────────────────

describe("A1 · X-Household-Id is a candidate, never authority", () => {
  it("serves a household the principal belongs to when named", async () => {
    const response = await GET(get(await token(OWNER), { "x-household-id": B }));
    expect(await body(response)).toEqual({ id: B, name: "Household B", role: "member" });
  });

  it("refuses a household the principal does not belong to", async () => {
    const response = await GET(get(await token(LONER), { "x-household-id": A }));
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({ status: 403 });
  });

  it("refuses a foreign household even for a single-membership principal", async () => {
    // The dangerous shape: a lone membership must not become a silent fallback.
    const response = await GET(get(await token(VIEWER), { "x-household-id": C }));
    expect(response.status).toBe(403);
  });

  it("does not distinguish a foreign household from one that does not exist", async () => {
    const foreign = await body(await GET(get(await token(LONER), { "x-household-id": A })));
    const absent = await body(await GET(get(await token(LONER), { "x-household-id": randomUUID() })));
    expect(foreign).toEqual(absent);
  });

  it("rejects a malformed household id as 400", async () => {
    const response = await GET(get(await token(OWNER), { "x-household-id": "'; DROP TABLE items; --" }));
    expect(response.status).toBe(400);
  });
});

describe("A5 · identity is not header-injectable", () => {
  it("ignores identity-shaped headers and serves the token's principal", async () => {
    const response = await GET(
      get(await token(LONER), {
        "x-user-id": OWNER,
        "x-authenticated-user": OWNER,
        "x-forwarded-user": OWNER,
      }),
    );
    // If any of those were honoured, LONER would be ambiguous (OWNER has two households)
    // or would resolve to A. It resolves to C, the token subject's only household.
    expect(await body(response)).toMatchObject({ id: C });
  });

  it("ignores a role header", async () => {
    const response = await GET(get(await token(VIEWER), { "x-role": "owner" }));
    expect(await body(response)).toMatchObject({ role: "viewer" });
  });
});

// ─────────────────────────── A2 · membership arithmetic ───────────────────────────

describe("zero and ambiguous membership fail closed", () => {
  it("no membership → 403", async () => {
    const response = await GET(get(await token(ORPHAN)));
    expect(response.status).toBe(403);
  });

  it("ambiguous membership without a header → 400, never a guess", async () => {
    const response = await GET(get(await token(OWNER)));
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ status: 400 });
  });

  it("the same principal succeeds once it names a household", async () => {
    expect((await GET(get(await token(OWNER), { "x-household-id": A }))).status).toBe(200);
  });
});

// ─────────────────────── cross-household isolation over HTTP ───────────────────────

describe("cross-household isolation holds through the boundary", () => {
  it("two principals of different households see only their own", async () => {
    const one = await body(await GET(get(await token(LONER))));
    const two = await body(await GET(get(await token(VIEWER))));
    expect(one["id"]).toBe(C);
    expect(two["id"]).toBe(A);
    expect(one["name"]).not.toBe(two["name"]);
  });

  it("the same principal gets different data per household it names", async () => {
    const inA = await body(await GET(get(await token(OWNER), { "x-household-id": A })));
    const inB = await body(await GET(get(await token(OWNER), { "x-household-id": B })));
    expect(inA).toMatchObject({ name: "Household A", role: "owner" });
    expect(inB).toMatchObject({ name: "Household B", role: "member" });
  });

  it("the response body never contains another household's name", async () => {
    const response = await GET(get(await token(LONER)));
    const text = JSON.stringify(await body(response));
    expect(text).not.toContain("Household A");
    expect(text).not.toContain("Household B");
  });
});

// ─────────────────────────── A6 · CSRF ───────────────────────────

describe("A6 · CSRF is enforced at the boundary", () => {
  // These drive the exported handler directly with an unsafe method. In production Next
  // would answer 405 first, since the route exports only GET — so what is proved here is
  // the boundary's ordering and its refusal, not that this URL accepts a POST.
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"] as const;

  async function send(method: string, headers: Record<string, string> = {}): Promise<Response> {
    return GET(
      new Request(`${ORIGIN}/v1/households/current`, {
        method,
        headers: { cookie: `${COOKIE}=${await token(LONER)}`, ...headers },
      }),
    );
  }

  it.each(unsafe)("%s without the CSRF header → 403", async (method) => {
    const response = await send(method);
    expect(response.status).toBe(403);
  });

  it.each(unsafe)("%s with the CSRF header passes the check", async (method) => {
    const response = await send(method, { [CSRF_HEADER]: CSRF_HEADER_VALUE });
    expect(response.status).toBe(200);
  });

  it("DELETE is not exempt, and Idempotency-Key is not a substitute", async () => {
    expect((await send("DELETE")).status).toBe(403);
    expect((await send("DELETE", { "idempotency-key": randomUUID() })).status).toBe(403);
  });

  it("rejects a cross-site origin before authenticating", async () => {
    const response = await send("POST", {
      [CSRF_HEADER]: CSRF_HEADER_VALUE,
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
  });

  it("is checked before identity — an unauthenticated POST is a CSRF failure", async () => {
    const response = await GET(
      new Request(`${ORIGIN}/v1/households/current`, { method: "POST" }),
    );
    // 403 rather than 401: the cheapest check runs first and needs no database.
    expect(response.status).toBe(403);
  });
});

// ─────────────────────── A2/A4 · capability enforcement ───────────────────────

describe("authorization is enforced by the boundary, not the handler", () => {
  it("refuses a viewer an owner-only capability without running the handler", async () => {
    let handlerRan = false;
    const { authenticated } = await import("@/server/http/route");
    const ownerOnly = authenticated(
      { requires: "member.manage" },
      async () => {
        handlerRan = true;
        return { ok: true };
      },
    );
    const response = await ownerOnly(get(await token(VIEWER)));
    expect(response.status).toBe(403);
    expect(handlerRan).toBe(false);
  });

  it("allows the owner of that household the same capability", async () => {
    const { authenticated } = await import("@/server/http/route");
    const ownerOnly = authenticated({ requires: "member.manage" }, async () => ({
      ok: true,
    }));
    expect((await ownerOnly(get(await token(OWNER), { "x-household-id": A }))).status).toBe(200);
  });

  it("refuses the same principal in a household where they are only a member", async () => {
    const { authenticated } = await import("@/server/http/route");
    const ownerOnly = authenticated({ requires: "member.manage" }, async () => ({
      ok: true,
    }));
    // OWNER is `member` in B — the capability follows the membership row, not the person.
    expect((await ownerOnly(get(await token(OWNER), { "x-household-id": B }))).status).toBe(403);
  });
});

// ─────────────────────────── A7 · ordering · A8 · no leakage ───────────────────────────

describe("A7 · a rejected request never opens a household scope", () => {
  it("writes no audit row and touches no household data when rejected", async () => {
    const before = await admin.auditLog.count();
    await GET(get(await token(LONER), { "x-household-id": A }));
    await GET(get(await token(ORPHAN)));
    await GET(get("not-a-jwt"));
    expect(await admin.auditLog.count()).toBe(before);
  });
});

describe("A8 · errors leak nothing", () => {
  it("returns problem+json with no internals in any rejection", async () => {
    const responses = await Promise.all([
      GET(get(null)),
      GET(get(await token(ORPHAN))),
      GET(get(await token(OWNER))),
      GET(get(await token(LONER), { "x-household-id": A })),
    ]);
    for (const response of responses) {
      const text = JSON.stringify(await body(response));
      expect(text).not.toMatch(/postgres|prisma|select |household_id =|app_user|password/i);
      expect(text).toContain("https://autobureau.com/problems/");
    }
  });

  it("does not disclose whether a household exists", async () => {
    const real = await body(await GET(get(await token(LONER), { "x-household-id": A })));
    const fake = await body(await GET(get(await token(LONER), { "x-household-id": randomUUID() })));
    expect(real).toEqual(fake);
  });
});
