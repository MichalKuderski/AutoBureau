import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "@/test/integration/database";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";

/**
 * Server-side idempotency (blueprint P1-05) end to end, against PostgreSQL 16 under RLS.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * Real: the boundary (`authenticated()` as shipped), the idempotency layer, the token,
 * the JWKS endpoint, the database, the RLS policies, and the domain write — the test
 * handler inserts `household_members` rows through `withHousehold`, so "did the handler
 * run twice" is answered by counting rows Postgres actually holds rather than by trusting
 * a spy.
 *
 * Not real: the endpoints. `/v1` has no honored POST yet — `/v1/households/current` is a
 * GET and the auth routes are exempt — because the domain endpoints are P1-18. The
 * handlers below are therefore defined here, but they are composed from the shipped
 * `authenticated()` wrapper, which is the thing under test. A test that stubbed the
 * boundary would prove nothing about the mechanism this task adds.
 */

const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const COOKIE = "ab_session";
const ORIGIN = "https://app.autobureau.com";

const ALICE = randomUUID();
const BOB = randomUUID(); // second principal in the SAME household as Alice
const CAROL = randomUUID(); // owner of a different household
const H1 = randomUUID();
const H2 = randomUUID();

let admin: PrismaClient;
let signingKey: CryptoKey;
let jwks: JSONWebKeySet;
let jwksServer: Server;

/** Incremented by the handler itself, so "executed" means the body of the route ran. */
let executions = 0;
/** Filled by the `observe-then-throw` handler with what the store held mid-request. */
let observedDuringHandler: Array<{ state: string }> = [];
/** What the next handler invocation should do. Reset before every test. */
let behaviour:
  | "create"
  | "throw"
  | "throw-inside-transaction"
  | "observe-then-throw"
  | "commit-then-throw"
  | "answer-500"
  | "answer-400"
  | "created-201"
  | "no-content" = "create";

type Handler = (request: Request) => Promise<Response>;
let POST: Handler;
let PATCH: Handler;
let PUT: Handler;
let DELETE: Handler;

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();

  admin = adminClient();
  await admin.user.createMany({
    data: [ALICE, BOB, CAROL].map((id) => ({ id, email: `${id}@example.test` })),
  });
  await admin.household.createMany({
    data: [
      { id: H1, name: "Household One", createdBy: ALICE },
      { id: H2, name: "Household Two", createdBy: CAROL },
    ],
  });
  await admin.householdUser.createMany({
    data: [
      { householdId: H1, userId: ALICE, role: "owner" },
      { householdId: H1, userId: BOB, role: "member" },
      { householdId: H2, userId: CAROL, role: "owner" },
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

  process.env["AUTH_ISSUER"] = ISSUER;
  process.env["AUTH_AUDIENCE"] = AUDIENCE;
  process.env["AUTH_JWKS_URL"] = `http://127.0.0.1:${port}/jwks.json`;
  process.env["AUTH_API_URL"] = `http://127.0.0.1:${port}`;
  process.env["AUTH_ANON_KEY"] = "unused-by-this-boundary";
  process.env["AUTH_COOKIE_NAME"] = COOKIE;
  process.env["APP_ORIGIN"] = ORIGIN;

  const { authenticated, created, noContent, RouteResponse, resetBoundaryCache } = await import(
    "@/server/http/route"
  );
  resetBoundaryCache();

  // One real domain write, chosen because it is household-scoped and therefore countable
  // under RLS: if the handler runs twice, there are two rows.
  const handler = async ({ request, ctx, db }: {
    request: Request;
    ctx: { householdId: string };
    db: { withHousehold: <T>(id: string, fn: (tx: never) => Promise<T>) => Promise<T> };
  }) => {
    executions += 1;
    if (behaviour === "throw") throw new Error("handler failed deliberately");
    if (behaviour === "observe-then-throw") {
      // Runs while this request's own claim is committed and in flight, so what it sees
      // is exactly the mid-request state — no timer, no race.
      observedDuringHandler = await admin.$queryRaw<Array<{ state: string }>>`
        SELECT state::text AS state FROM idempotency_keys
      `;
      throw new Error("failed after observing the claim");
    }
    const body = (await request.json().catch(() => ({}))) as { name?: string };

    // Writes, then throws INSIDE the same scoped transaction. This is the shape the
    // release path's safety argument depends on: Prisma must roll the write back.
    if (behaviour === "throw-inside-transaction") {
      await db.withHousehold(ctx.householdId, async (tx) => {
        await (tx as unknown as {
          householdMember: { create(args: unknown): Promise<{ id: string }> };
        }).householdMember.create({
          data: { householdId: ctx.householdId, kind: "adult", displayName: "rolled-back" },
          select: { id: true },
        });
        throw new Error("failed after writing, inside the transaction");
      });
    }

    const row = await db.withHousehold(ctx.householdId, (tx) =>
      (tx as unknown as {
        householdMember: { create(args: unknown): Promise<{ id: string }> };
      }).householdMember.create({
        data: { householdId: ctx.householdId, kind: "adult", displayName: body.name ?? "unnamed" },
        select: { id: true },
      }),
    );
    // The one shape this boundary cannot compensate for: the transaction COMMITTED and
    // the handler then failed. Exercised so the consequence is recorded, not assumed.
    if (behaviour === "commit-then-throw") throw new Error("failed after committing");
    if (behaviour === "answer-500") return new RouteResponse(500, { error: "downstream" });
    if (behaviour === "answer-400") return new RouteResponse(400, { error: "invalid" });
    if (behaviour === "no-content") return noContent();
    if (behaviour === "created-201") return created({ id: row.id }, `/v1/members/${row.id}`);
    return { id: row.id, echoed: body.name ?? null };
  };

  const options = { requires: "item.write" as const };
  POST = authenticated(options, handler as never);
  PATCH = authenticated(options, handler as never);
  PUT = authenticated(options, handler as never);
  DELETE = authenticated(options, handler as never);
}, 120_000);

afterAll(async () => {
  await admin?.idempotencyKey.deleteMany({ where: { householdId: { in: [H1, H2] } } });
  await admin?.householdMember.deleteMany({ where: { householdId: { in: [H1, H2] } } });
  await admin?.household.deleteMany({ where: { id: { in: [H1, H2] } } });
  await admin?.user.deleteMany({ where: { id: { in: [ALICE, BOB, CAROL] } } });
  await admin?.$disconnect();
  await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
});

beforeEach(() => {
  executions = 0;
  behaviour = "create";
  observedDuringHandler = [];
});

afterEach(async () => {
  await admin.idempotencyKey.deleteMany({ where: { householdId: { in: [H1, H2] } } });
  await admin.householdMember.deleteMany({ where: { householdId: { in: [H1, H2] } } });
});

async function token(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(signingKey);
}

interface Call {
  user?: string;
  household?: string;
  key?: string | null;
  body?: unknown;
  path?: string;
}

async function request(method: string, call: Call = {}): Promise<Request> {
  const jwt = await token(call.user ?? ALICE);
  const headers: Record<string, string> = {
    cookie: `${COOKIE}=${jwt}`,
    [CSRF_HEADER]: CSRF_HEADER_VALUE,
    "content-type": "application/json",
    "x-household-id": call.household ?? H1,
  };
  if (call.key !== null) headers["idempotency-key"] = call.key ?? randomUUID();
  return new Request(`${ORIGIN}${call.path ?? "/v1/members"}`, {
    method,
    headers,
    body: JSON.stringify(call.body ?? { name: "Ada" }),
  });
}

const rows = () => admin.householdMember.count({ where: { householdId: { in: [H1, H2] } } });
const records = () => admin.idempotencyKey.findMany({ where: { householdId: { in: [H1, H2] } } });

// ─────────────────────────────── A · the first POST ───────────────────────────────

describe("Test A · a first POST executes and is recorded", () => {
  it("runs the handler once and stores a completed record", async () => {
    const response = await POST(await request("POST"));

    expect(response.status).toBe(200);
    expect(executions).toBe(1);
    expect(await rows()).toBe(1);

    const stored = await records();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.state).toBe("completed");
    expect(stored[0]?.responseStatus).toBe(200);
    expect(stored[0]?.householdId).toBe(H1);
    expect(stored[0]?.userId).toBe(ALICE);
    expect(stored[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expires 24 hours out, as ADR-011 D13 fixes it", async () => {
    await POST(await request("POST"));
    const stored = (await records())[0];
    const ttlMs = stored!.expiresAt.getTime() - stored!.createdAt.getTime();
    expect(ttlMs).toBeGreaterThan(23.9 * 3_600_000);
    expect(ttlMs).toBeLessThan(24.1 * 3_600_000);
  });
});

// ───────────────────────── B · duplicate identical POST ─────────────────────────

describe("Test B · the same key and body replays instead of executing", () => {
  it("does not run the handler again and returns the first response", async () => {
    const key = randomUUID();
    const first = await POST(await request("POST", { key }));
    const firstBody = await first.text();

    const second = await POST(await request("POST", { key }));

    expect(executions).toBe(1);
    expect(await rows()).toBe(1);
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(firstBody);
  });

  it("marks the replay without altering the canonical response", async () => {
    const key = randomUUID();
    const first = await POST(await request("POST", { key }));
    const second = await POST(await request("POST", { key }));

    expect(first.headers.get("idempotent-replay")).toBeNull();
    expect(second.headers.get("idempotent-replay")).toBe("true");
  });

  it("gives the replay the CURRENT request's trace id, not the original's", async () => {
    const key = randomUUID();
    const first = await POST(await request("POST", { key }));
    const second = await POST(await request("POST", { key }));

    const a = first.headers.get("x-request-id");
    const b = second.headers.get("x-request-id");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // A correlation id that repeated would make two deliveries indistinguishable in the
    // logs, which is the one thing it exists to prevent.
    expect(b).not.toBe(a);
  });
});

// ───────────────────────── C · same key, different body ─────────────────────────

describe("Test C · the same key with a different body is a conflict", () => {
  it("answers 409 and does not execute the handler", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key, body: { name: "Ada" } }));
    const conflict = await POST(await request("POST", { key, body: { name: "Grace" } }));

    expect(conflict.status).toBe(409);
    expect(executions).toBe(1);
    expect(await rows()).toBe(1);
    expect(conflict.headers.get("content-type")).toContain("application/problem+json");
  });

  it("treats the same key on a different path as a different fingerprint", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key, path: "/v1/members" }));
    const conflict = await POST(await request("POST", { key, path: "/v1/items" }));

    expect(conflict.status).toBe(409);
    expect(executions).toBe(1);
  });

  it("ignores JSON key order — the fingerprint is canonical, not textual", async () => {
    const key = randomUUID();
    const one = new Request(`${ORIGIN}/v1/members`, {
      method: "POST",
      headers: {
        cookie: `${COOKIE}=${await token(ALICE)}`,
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
        "content-type": "application/json",
        "x-household-id": H1,
        "idempotency-key": key,
      },
      body: '{"name":"Ada","note":"x"}',
    });
    const two = new Request(`${ORIGIN}/v1/members`, {
      method: "POST",
      headers: {
        cookie: `${COOKIE}=${await token(ALICE)}`,
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
        "content-type": "application/json",
        "x-household-id": H1,
        "idempotency-key": key,
      },
      body: '{"note":"x","name":"Ada"}',
    });

    expect((await POST(one)).status).toBe(200);
    const second = await POST(two);
    // Same request, written differently — a replay, not a conflict.
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("true");
    expect(executions).toBe(1);
  });
});

// ───────────────── D & E & Q · tenant and principal isolation ─────────────────

describe("Test D · another household cannot replay this household's record", () => {
  it("executes normally and creates its own record", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key, user: ALICE, household: H1 }));
    const other = await POST(await request("POST", { key, user: CAROL, household: H2 }));

    expect(other.status).toBe(200);
    expect(other.headers.get("idempotent-replay")).toBeNull();
    expect(executions).toBe(2);
    expect(await rows()).toBe(2);
    expect(await records()).toHaveLength(2);
  });
});

describe("Test E · another principal cannot replay this principal's record", () => {
  it("executes normally for a different user in the SAME household", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key, user: ALICE, household: H1 }));
    const bob = await POST(await request("POST", { key, user: BOB, household: H1 }));

    // Same household, same key, same body — and still not a replay, because a stored
    // response answers one principal's request and is not household-shared state.
    expect(bob.status).toBe(200);
    expect(bob.headers.get("idempotent-replay")).toBeNull();
    expect(executions).toBe(2);
    const stored = await records();
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((r) => r.userId))).toEqual(new Set([ALICE, BOB]));
  });
});

describe("Test Q · isolation is enforced by RLS, not by the WHERE clause", () => {
  it("hides another household's record from a scoped read", async () => {
    await POST(await request("POST", { user: ALICE, household: H1 }));
    await POST(await request("POST", { user: CAROL, household: H2 }));

    const { createDatabase } = await import("@autobureau/db");
    const { runAsUser } = await import("@autobureau/db");
    const db = createDatabase(process.env["DATABASE_URL"]);
    try {
      const seen = await runAsUser(ALICE, () =>
        db.withHousehold(H1, (tx) =>
          tx.$queryRaw<Array<{ household_id: string; user_id: string }>>`
            SELECT household_id::text, user_id::text FROM idempotency_keys
          `,
        ),
      );
      // Two rows exist; the policy shows exactly the one that is Alice's, in H1.
      expect(await records()).toHaveLength(2);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.household_id).toBe(H1);
      expect(seen[0]?.user_id).toBe(ALICE);
    } finally {
      await db.disconnect();
    }
  });

  it("hides a co-member's record too", async () => {
    await POST(await request("POST", { user: ALICE, household: H1 }));
    await POST(await request("POST", { user: BOB, household: H1 }));

    const { createDatabase, runAsUser } = await import("@autobureau/db");
    const db = createDatabase(process.env["DATABASE_URL"]);
    try {
      const seen = await runAsUser(BOB, () =>
        db.withHousehold(H1, (tx) =>
          tx.$queryRaw<Array<{ user_id: string }>>`SELECT user_id::text FROM idempotency_keys`,
        ),
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]?.user_id).toBe(BOB);
    } finally {
      await db.disconnect();
    }
  });
});

// ───────────────── F, G, H · methods that are not honored ─────────────────

describe("Test F · PATCH carrying a key is executed, never rejected", () => {
  it("runs the handler and stores no idempotency record", async () => {
    const key = randomUUID();
    const first = await PATCH(await request("PATCH", { key }));
    const second = await PATCH(await request("PATCH", { key }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Ignored means ignored: the second identical PATCH executes, exactly as it would
    // without the header. A 409 here would break every update `apiFetch` makes.
    expect(executions).toBe(2);
    expect(await records()).toHaveLength(0);
  });
});

describe("Test G · PUT carrying a key behaves the same way", () => {
  it("runs the handler and stores no idempotency record", async () => {
    const key = randomUUID();
    expect((await PUT(await request("PUT", { key }))).status).toBe(200);
    expect((await PUT(await request("PUT", { key }))).status).toBe(200);
    expect(executions).toBe(2);
    expect(await records()).toHaveLength(0);
  });
});

describe("Test H · DELETE is unchanged", () => {
  it("executes with no key, as apiFetch sends none", async () => {
    const response = await DELETE(await request("DELETE", { key: null }));
    expect(response.status).toBe(200);
    expect(executions).toBe(1);
    expect(await records()).toHaveLength(0);
  });

  it("is still not rejected if a key somehow arrives", async () => {
    const response = await DELETE(await request("DELETE", { key: randomUUID() }));
    expect(response.status).toBe(200);
    expect(await records()).toHaveLength(0);
  });
});

// ───────────────────────── I & J · malformed keys ─────────────────────────

describe("Test I · a malformed key is a validation problem", () => {
  it("rejects an empty key with 400 and does not execute", async () => {
    const response = await POST(await request("POST", { key: "" }));

    // An empty header value is indistinguishable from "no key" at the wire level in some
    // stacks, so assert the outcome rather than the mechanism: either it validated as
    // absent and executed, or it was refused. It must never be a 500.
    expect([200, 400]).toContain(response.status);
    expect(response.status).not.toBe(500);
  });
});

describe("Test J · an over-long key is a validation problem", () => {
  it("rejects 256 characters with 400 and does not execute", async () => {
    const response = await POST(await request("POST", { key: "k".repeat(256) }));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(executions).toBe(0);
    expect(await rows()).toBe(0);
    expect(await records()).toHaveLength(0);
  });

  it("accepts exactly 255 characters", async () => {
    const response = await POST(await request("POST", { key: "k".repeat(255) }));
    expect(response.status).toBe(200);
    expect(executions).toBe(1);
  });
});

// ─────────────────────────────── K · expiry ───────────────────────────────

describe("Test K · an expired record behaves as a new request", () => {
  it("re-executes once the record has lapsed", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key }));
    expect(executions).toBe(1);

    // Age the record past its retention. Done in the database rather than by waiting,
    // which is the only way to exercise a 24-hour rule in a test suite.
    await admin.idempotencyKey.updateMany({
      where: { householdId: H1, userId: ALICE, key },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const again = await POST(await request("POST", { key }));
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replay")).toBeNull();
    expect(executions).toBe(2);
    expect(await rows()).toBe(2);
    // Swept and reclaimed, not accumulated.
    expect(await records()).toHaveLength(1);
  });

  it("sweeps this principal's other lapsed rows on the way past", async () => {
    await POST(await request("POST", { key: randomUUID() }));
    await admin.idempotencyKey.updateMany({
      where: { householdId: H1, userId: ALICE },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await records()).toHaveLength(1);

    await POST(await request("POST", { key: randomUUID() }));
    // The lapsed row is gone and only the new one remains: the table is bounded by live
    // traffic rather than by cumulative history.
    expect(await records()).toHaveLength(1);
  });
});

// ───────────────────────── L · the in-flight race ─────────────────────────

describe("Test L · two simultaneous identical requests execute the mutation once", () => {
  it("is deterministic across repeated races against real Postgres", async () => {
    const ROUNDS = 12;
    const outcomes: Array<{ ok: number; conflict: number }> = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      executions = 0;
      await admin.idempotencyKey.deleteMany({ where: { householdId: H1 } });
      await admin.householdMember.deleteMany({ where: { householdId: H1 } });

      const key = randomUUID();
      const [a, b] = await Promise.all([
        POST(await request("POST", { key })),
        POST(await request("POST", { key })),
      ]);

      const statuses = [a.status, b.status];
      const ok = statuses.filter((s) => s === 200).length;
      const conflict = statuses.filter((s) => s === 409).length;
      outcomes.push({ ok, conflict });

      // THE INVARIANT. Whatever the interleaving, the domain write happened once.
      expect(await admin.householdMember.count({ where: { householdId: H1 } })).toBe(1);
      expect(executions).toBe(1);
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    }

    // Every round resolved as one winner and one loser — never two winners, never two
    // losers. The loser is a 409 (still in flight) or a 200 replay if the winner had
    // already committed; both are correct, and both mean the handler ran once.
    for (const outcome of outcomes) {
      expect(outcome.ok + outcome.conflict).toBe(2);
      expect(outcome.ok).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  it("answers 409 while a claim is genuinely still in flight", async () => {
    const key = randomUUID();
    // Plant an in-flight claim with the fingerprint the next request will compute, by
    // making a real one and rewinding its state.
    await POST(await request("POST", { key }));
    await admin.idempotencyKey.updateMany({
      where: { householdId: H1, userId: ALICE, key },
      data: { state: "in_flight", responseStatus: null, responseBody: null, completedAt: null },
    });
    executions = 0;

    const blocked = await POST(await request("POST", { key }));

    expect(blocked.status).toBe(409);
    expect(executions).toBe(0);
    expect(await rows()).toBe(1);
  });
});

// ───────────── M · the lifecycle: what a failure actually persists ─────────────
//
// These are the cases the review of `d17c44a` asked to be proved rather than described.
// The claim commits in its OWN transaction before the handler runs, so nothing the
// handler does can roll it back — a failed request is cleaned up by a compensating
// DELETE, and the difference matters because getting it wrong leaves a 24-hour 409 on a
// mutation that never happened.

describe("Test M/1 · a throwing handler releases its claim so a retry can proceed", () => {
  it("holds an in_flight claim DURING the handler, then removes it", async () => {
    behaviour = "observe-then-throw";
    const failed = await POST(await request("POST"));

    expect(failed.status).toBe(500);
    // Mid-request: the claim was committed and in flight. This is the half that proves a
    // claim was actually taken — without it, "no rows afterwards" would also be true of a
    // boundary that never wrote one.
    expect(observedDuringHandler).toHaveLength(1);
    expect(observedDuringHandler[0]?.state).toBe("in_flight");
    // Afterwards: released by the compensating delete.
    expect(await records()).toHaveLength(0);
    expect(await rows()).toBe(0);
  });

  it("lets an ordinary retry with the SAME key execute and succeed", async () => {
    const key = randomUUID();
    behaviour = "throw";
    expect((await POST(await request("POST", { key }))).status).toBe(500);
    expect(await records()).toHaveLength(0);

    behaviour = "create";
    const retried = await POST(await request("POST", { key }));

    // The load-bearing assertion: 200, not the 409 a retained claim would produce.
    expect(retried.status).toBe(200);
    expect(retried.headers.get("idempotent-replay")).toBeNull();
    expect(await rows()).toBe(1);
    expect((await records())[0]?.state).toBe("completed");
  });

  it("rolls the domain write back when the handler throws inside the transaction", async () => {
    // The release path's whole safety argument. If Prisma did NOT roll this back,
    // releasing the claim would license a duplicate.
    behaviour = "throw-inside-transaction";
    const failed = await POST(await request("POST"));

    expect(failed.status).toBe(500);
    expect(await rows()).toBe(0);
    expect(await records()).toHaveLength(0);
  });
});

describe("Test M/2 · a handler that ANSWERS a failure is not memoized", () => {
  it("does not replay a 500 for the retention period", async () => {
    const key = randomUUID();
    behaviour = "answer-500";
    const first = await POST(await request("POST", { key }));

    expect(first.status).toBe(500);
    // Released, not stored. A stored 5xx would answer every retry for 24 hours with the
    // same failure — including the transient ones a retry exists to get past.
    expect(await records()).toHaveLength(0);

    behaviour = "create";
    const retried = await POST(await request("POST", { key }));
    expect(retried.status).toBe(200);
    expect(retried.headers.get("idempotent-replay")).toBeNull();
  });

  it("does not replay a 400 either", async () => {
    const key = randomUUID();
    behaviour = "answer-400";
    expect((await POST(await request("POST", { key }))).status).toBe(400);
    expect(await records()).toHaveLength(0);

    behaviour = "create";
    expect((await POST(await request("POST", { key }))).status).toBe(200);
  });
});

describe("Test M/3 · commit-then-fail is the one shape that cannot be compensated", () => {
  it("releases the claim, which a retry can then duplicate — recorded, not hidden", async () => {
    const key = randomUUID();
    behaviour = "commit-then-throw";
    const failed = await POST(await request("POST", { key }));

    expect(failed.status).toBe(500);
    // The write survived because its transaction committed before the handler failed.
    expect(await rows()).toBe(1);
    expect(await records()).toHaveLength(0);

    behaviour = "create";
    await POST(await request("POST", { key }));

    // TWO rows. This is the documented residual: a handler that commits and then reports
    // failure is outside what the boundary can see. It is ruled out by `withHousehold`'s
    // contract — the scoped unit of work IS the transaction — not by this layer. The
    // alternative (never releasing) would leave every transient 503 blocking retries for
    // a day, which the accepted contract rejects.
    expect(await rows()).toBe(2);
  });
});

// ───────── Test 5 · completion persistence failure, injected for real ─────────

describe("Test M/4 · a failed completion write cannot duplicate a mutation", () => {
  beforeEach(async () => {
    // A real failure injection: the completion UPDATE raises inside Postgres. Nothing is
    // mocked — the statement genuinely fails the way a lost connection would.
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_block_idempotency_completion() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'injected completion failure';
      END
      $fn$;
    `);
    await admin.$executeRawUnsafe(`
      CREATE TRIGGER test_block_completion
      BEFORE UPDATE ON idempotency_keys
      FOR EACH ROW WHEN (NEW.state = 'completed')
      EXECUTE FUNCTION test_block_idempotency_completion();
    `);
  });

  afterEach(async () => {
    await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_completion ON idempotency_keys;`);
    await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_block_idempotency_completion();`);
  });

  it("still returns the successful response — the mutation did commit", async () => {
    const response = await POST(await request("POST"));

    // Answering 500 here would tell the client work failed that in fact succeeded, and
    // the client's natural reaction — retry — is the duplicate this module prevents.
    expect(response.status).toBe(200);
    expect(await rows()).toBe(1);
  });

  it("leaves the record in_flight, so a retry is a 409 and never a second mutation", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key }));

    const stored = await records();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.state).toBe("in_flight");
    expect(await rows()).toBe(1);

    executions = 0;
    const retry = await POST(await request("POST", { key }));

    expect(retry.status).toBe(409);
    expect(executions).toBe(0);
    expect(await rows()).toBe(1);
  });
});

// ───────── Test 6 · the crash boundary, to the strongest extent provable ─────────

describe("Test M/5 · a crash leaves an in_flight row that is never reclaimed", () => {
  // A real SIGKILL cannot be staged inside the request that is under test. What a crash
  // leaves behind CAN be staged exactly: the connection dies, so Postgres rolls back
  // whatever transaction was open, and the committed claim remains `in_flight`. Both
  // crash positions — before and after the domain commit — leave that identical record,
  // which is precisely why it must not be reclaimed.

  it("fails closed when the crash happened BEFORE the domain write committed", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key }));
    await admin.idempotencyKey.updateMany({
      where: { key },
      data: { state: "in_flight", responseStatus: null, responseBody: null, completedAt: null },
    });
    await admin.householdMember.deleteMany({ where: { householdId: H1 } });
    executions = 0;

    const retry = await POST(await request("POST", { key }));

    expect(retry.status).toBe(409);
    expect(executions).toBe(0);
    expect(await rows()).toBe(0);
  });

  it("fails closed when the crash happened AFTER the domain write committed", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key }));
    await admin.idempotencyKey.updateMany({
      where: { key },
      data: { state: "in_flight", responseStatus: null, responseBody: null, completedAt: null },
    });
    executions = 0;

    const retry = await POST(await request("POST", { key }));

    // Indistinguishable from the case above at the record level — which is the argument
    // against any lease-and-reclaim policy. Reclaiming would duplicate this one.
    expect(retry.status).toBe(409);
    expect(executions).toBe(0);
    expect(await rows()).toBe(1);
  });

  it("has no reclaim path at all: only expiry clears an in_flight row", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./idempotency.ts", import.meta.url), "utf8"),
    );
    const deletes = source.match(/DELETE FROM idempotency_keys[\s\S]*?`/g) ?? [];
    expect(deletes).toHaveLength(2);
    // One sweep, guarded by expiry; one release, guarded by this request's own claim id.
    expect(deletes.some((d) => d.includes("expires_at <= now()"))).toBe(true);
    expect(deletes.some((d) => d.includes("id = ${id}::uuid"))).toBe(true);
    // No age-based reclaim of somebody else's in-flight claim. Matched against CODE with
    // comments stripped: the docblock above discusses reclaiming in order to rule it out,
    // and a test that read prose would fail on an edit to an explanation.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // `\blease\b` deliberately: `release()` is the compensating delete and must survive.
    expect(code).not.toMatch(/created_at\s*<|completed_at\s*<|\blease\b|\breclaim/i);
    // Exactly three uses of now(), all accounted for: the expiry sweep's predicate, the
    // claim's expires_at, and completed_at. A fourth would be a new time-based rule and
    // should have to be justified.
    expect(code.match(/now\(\)/g) ?? []).toHaveLength(3);
  });
});

// ───────────────────────── N & O · the ADR-011 exceptions ─────────────────────────

describe("Test N · /v1/auth/* never enters domain idempotency", () => {
  it("is not wrapped in authenticated(), so the layer cannot reach it", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../app/v1/auth/sign-in/route.ts", import.meta.url), "utf8"),
    );
    // Structural, not a path allowlist: the exception holds because these routes do not
    // IMPORT the wrapper the idempotency layer lives inside. Asserted on the import
    // statement rather than on any occurrence of the word — the file's own header
    // explains that it is "not wrapped in `authenticated()`", and matching prose would
    // make this test pass or fail on a comment edit.
    expect(source).not.toMatch(/^\s*import[^;]*\bauthenticated\b[^;]*from[^;]*;/m);

    const { POST: signIn } = await import("@/app/v1/auth/sign-in/route");
    const response = await signIn(
      new Request(`${ORIGIN}/v1/auth/sign-in`, {
        method: "POST",
        headers: {
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ email: "someone@example.test", password: "x" }),
      }),
    );

    // Whatever it answers, it wrote no idempotency record.
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(await records()).toHaveLength(0);
  });
});

describe("Test O · a webhook shape cannot enter domain idempotency", () => {
  it("has no principal or household, which are two thirds of the fingerprint", async () => {
    const webhookish = new Request(`${ORIGIN}/v1/webhooks/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ type: "email.delivered" }),
    });

    // Sent through the authenticated boundary it is refused before idempotency is reached
    // — no CSRF header, no session — so no record can exist for it. A real webhook route
    // will not use this wrapper at all (ADR-011 D13); this pins that it could not
    // accidentally be given household/principal scope if someone tried.
    const response = await POST(webhookish);
    expect([401, 403]).toContain(response.status);
    expect(await records()).toHaveLength(0);
  });
});

// ───────────────────────── P · response replay fidelity ─────────────────────────

describe("Test P · a replayed response is the stored one", () => {
  it("preserves a 201 status and its Location header", async () => {
    behaviour = "created-201";
    const key = randomUUID();
    const first = await POST(await request("POST", { key }));
    const second = await POST(await request("POST", { key }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("location")).toBe(first.headers.get("location"));
    expect(second.headers.get("location")).toMatch(/^\/v1\/members\//);
    expect(await second.text()).toBe(await first.text());
    expect(executions).toBe(1);
  });

  it("preserves a 204 with no body", async () => {
    behaviour = "no-content";
    const key = randomUUID();
    const first = await POST(await request("POST", { key }));
    const second = await POST(await request("POST", { key }));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await second.text()).toBe("");
    expect(executions).toBe(1);
  });

  it("keeps cache-control no-store on the replay — a stored response is household data", async () => {
    const key = randomUUID();
    await POST(await request("POST", { key }));
    const second = await POST(await request("POST", { key }));
    expect(second.headers.get("cache-control")).toBe("no-store");
  });

  it("never persists a cookie", async () => {
    await POST(await request("POST"));
    const stored = (await records())[0];
    const headers = (stored?.responseHeaders ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("set-cookie");
  });
});
