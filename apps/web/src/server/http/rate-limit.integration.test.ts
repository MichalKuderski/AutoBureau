import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "@/test/integration/database";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";
import type { LogRecord } from "@/server/observability";

/**
 * Authentication rate limiting (blueprint P1-08) end to end, against PostgreSQL 16.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * Real: the shipped `/v1/auth/sign-in` and `/v1/auth/magic-link` handlers, the limiter, the
 * `withGlobalTable` access path, the database, its RLS policies, and the counters — "was
 * this attempt counted" is answered by rows Postgres actually holds, never by a spy. The
 * concurrency test drives genuinely parallel requests through the real upsert.
 *
 * Not real: the identity provider, which is a local server speaking the documented GoTrue
 * contract. There is no Supabase project, and `provider.ts` says so itself. That is fine
 * here because the property under test is what happens BEFORE the provider is reached.
 *
 * NOT PROVEN, AND NOT CLAIMED: production edge behaviour. ADR-013 D5 records the right-most
 * `x-forwarded-for` rule as its own inference, and doc 09 §9.9 records that no live
 * deployment has ever run. These tests prove this application's parsing of a header they
 * construct — never that the real Vercel edge populates it that way.
 */

const ORIGIN = "https://app.autobureau.com";
const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const COOKIE = "ab_session";
const SUBJECT = "0192f5a1-0000-7000-8000-0000000000f1";
const EMAIL = "limiter@example.test";
const IP = "203.0.113.7";

let admin: PrismaClient;
let provider: Server;
let providerCalls: string[] = [];
let providerMode: "ok" | "reject" = "ok";
let ACCESS = "";

let signIn: (request: Request) => Promise<Response>;
let magicLink: (request: Request) => Promise<Response>;
let records: LogRecord[] = [];

/* ─────────────────────────────── helpers ─────────────────────────────── */

function signInRequest(body: { email: string; password: string }, ip: string | null = IP): Request {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "content-type": "application/json",
    [CSRF_HEADER]: CSRF_HEADER_VALUE,
  };
  if (ip !== null) headers["x-forwarded-for"] = ip;
  return new Request(`${ORIGIN}/v1/auth/sign-in`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function magicLinkRequest(email: string, ip: string | null = IP): Request {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "content-type": "application/json",
    [CSRF_HEADER]: CSRF_HEADER_VALUE,
  };
  if (ip !== null) headers["x-forwarded-for"] = ip;
  return new Request(`${ORIGIN}/v1/auth/magic-link`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });
}

async function counters(): Promise<Array<{ policy: string; attempts: number }>> {
  const rows = await admin.$queryRaw<Array<{ policy: string; attempts: number }>>`
    SELECT policy, attempts FROM auth_rate_limits ORDER BY policy
  `;
  return rows;
}

async function clearCounters(): Promise<void> {
  await admin.$executeRawUnsafe(`DELETE FROM auth_rate_limits`);
}

/** Drive `n` sequential sign-ins with wrong credentials and report each status. */
async function attemptSignIn(n: number, email = EMAIL, ip: string | null = IP): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const response = await signIn(signInRequest({ email, password: "wrong" }, ip));
    statuses.push(response.status);
  }
  return statuses;
}

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();
  admin = adminClient();

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwks: JSONWebKeySet = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }],
  };
  ACCESS = await new SignJWT({ email: EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setExpirationTime("1h")
    .sign(privateKey);

  provider = createServer((req, res) => {
    const url = req.url ?? "";
    providerCalls.push(url);
    if (url.startsWith("/jwks.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    if (providerMode === "reject") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    if (url.startsWith("/otp")) {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ access_token: ACCESS, refresh_token: "rt", expires_in: 3600 }));
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const port = (provider.address() as AddressInfo).port;

  process.env["AUTH_ISSUER"] = ISSUER;
  process.env["AUTH_AUDIENCE"] = AUDIENCE;
  process.env["AUTH_JWKS_URL"] = `http://127.0.0.1:${port}/jwks.json`;
  process.env["AUTH_API_URL"] = `http://127.0.0.1:${port}`;
  process.env["AUTH_ANON_KEY"] = "anon";
  process.env["AUTH_COOKIE_NAME"] = COOKIE;
  process.env["APP_ORIGIN"] = ORIGIN;

  const { resetDatabase } = await import("@/server/db");
  resetDatabase();

  signIn = (await import("@/app/v1/auth/sign-in/route")).POST;
  magicLink = (await import("@/app/v1/auth/magic-link/route")).POST;

  const { setLogSink } = await import("@/server/observability");
  setLogSink((record) => records.push(record));
});

afterAll(async () => {
  const { resetLogSink } = await import("@/server/observability");
  resetLogSink();
  await clearCounters();
  // Order matters: `ensureHousehold` gave this principal a household, and the
  // `household_creator` relation has no cascade, so the household goes first.
  await admin.householdUser.deleteMany({ where: { userId: SUBJECT } });
  await admin.household.deleteMany({ where: { createdBy: SUBJECT } });
  await admin.userProfile.deleteMany({ where: { userId: SUBJECT } });
  await admin.user.deleteMany({ where: { id: SUBJECT } });
  await admin.$disconnect();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

beforeEach(async () => {
  providerCalls = [];
  providerMode = "reject";
  records = [];
  await clearCounters();
});

afterEach(async () => {
  await clearCounters();
});

/* ─────────────────────────── counting behaviour ─────────────────────────── */

describe("A · counter creation and increment", () => {
  it("A1 the first attempt creates one row per enforced policy", async () => {
    await attemptSignIn(1);

    const rows = await counters();
    expect(rows.map((r) => r.policy)).toEqual([
      "sign_in.identifier",
      "sign_in.identifier_ip",
      "sign_in.ip",
    ]);
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
  });

  it("A2 repeated attempts within one window increment the SAME row", async () => {
    await attemptSignIn(3);

    const rows = await counters();
    // Three attempts, three policies, three rows — not nine. A new row per attempt would
    // mean the window key is not deterministic.
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.attempts === 3)).toBe(true);
  });

  it("A3 a rejected attempt is still counted in every dimension", async () => {
    // ADR-013 D6: "every attempt counts". If a 429 stopped incrementing the broad per-IP
    // bucket, an attacker who trips the narrow one would stop accruing in the dimension
    // that catches them spreading out.
    await attemptSignIn(7);

    const rows = await counters();
    expect(rows.every((r) => r.attempts === 7)).toBe(true);
  });

  it("A4 different identifiers get different buckets", async () => {
    await attemptSignIn(1, "one@example.test");
    await attemptSignIn(1, "two@example.test");

    const identifierRows = await admin.$queryRaw<Array<{ bucket: string }>>`
      SELECT bucket FROM auth_rate_limits WHERE policy = 'sign_in.identifier'
    `;
    expect(new Set(identifierRows.map((r) => r.bucket)).size).toBe(2);
    // …but they share the per-IP bucket, which is the dimension that catches spraying.
    const ipRows = await admin.$queryRaw<Array<{ attempts: number }>>`
      SELECT attempts FROM auth_rate_limits WHERE policy = 'sign_in.ip'
    `;
    expect(ipRows).toHaveLength(1);
    expect(ipRows[0]?.attempts).toBe(2);
  });
});

describe("B · the threshold boundary", () => {
  it("B1 permits exactly the limit, then rejects (identifier+IP = 5)", async () => {
    const statuses = await attemptSignIn(6);

    // 401 is the provider refusing the credentials — the request reached it. 429 is us.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it("B2 stays rejected for subsequent attempts in the same window", async () => {
    await attemptSignIn(6);
    const statuses = await attemptSignIn(3);
    expect(statuses).toEqual([429, 429, 429]);
  });

  it("B3 the limit is per-account, not global — the blueprint's acceptance property", async () => {
    // Burn one account to its limit, then a DIFFERENT account from the same source must
    // still be served: its identifier buckets are its own.
    await attemptSignIn(6, "victim@example.test");
    const other = await attemptSignIn(1, "bystander@example.test");
    expect(other).toEqual([401]);
  });
});

describe("C · window rollover", () => {
  it("C1 a lapsed window starts a new counter rather than staying blocked", async () => {
    await attemptSignIn(6);
    expect((await attemptSignIn(1))[0]).toBe(429);

    // Age every counter past its window. The next request floors `now()` to a new window
    // boundary, so it must key a NEW row rather than the exhausted one.
    await admin.$executeRawUnsafe(`
      UPDATE auth_rate_limits
      SET window_started_at = window_started_at - interval '1 hour',
          expires_at = expires_at - interval '1 hour'
    `);

    expect((await attemptSignIn(1))[0]).toBe(401);

    const fresh = await admin.$queryRaw<Array<{ attempts: number }>>`
      SELECT attempts FROM auth_rate_limits
      WHERE policy = 'sign_in.identifier_ip' AND expires_at > now()
    `;
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.attempts).toBe(1);
  });
});

describe("D · concurrency", () => {
  it("D1 concurrent attempts are counted exactly once each — no lost updates", async () => {
    // The property that a read-then-write would break: ten parallel requests must produce
    // ten distinct counter values, so exactly five clear the limit of five. This holds for
    // ANY interleaving, which is why the assertion is exact rather than approximate.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => signIn(signInRequest({ email: EMAIL, password: "wrong" }))),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);

    const rows = await admin.$queryRaw<Array<{ attempts: number }>>`
      SELECT attempts FROM auth_rate_limits WHERE policy = 'sign_in.identifier_ip'
    `;
    // One row, and it counted all ten. Two rows would mean the window key raced.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(10);
  });

  it("D2 concurrent attempts never create duplicate rows for one bucket", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () => signIn(signInRequest({ email: EMAIL, password: "wrong" }))),
    );
    const rows = await counters();
    expect(rows).toHaveLength(3);
  });
});

describe("E · identifier normalization through the route", () => {
  it("E1 casing variants share one counter", async () => {
    for (const email of [EMAIL, EMAIL.toUpperCase(), "LiMiTeR@Example.TEST"]) {
      await signIn(signInRequest({ email, password: "wrong" }));
    }

    const rows = await admin.$queryRaw<Array<{ attempts: number }>>`
      SELECT attempts FROM auth_rate_limits WHERE policy = 'sign_in.identifier'
    `;
    // One bucket, three attempts. Three buckets would mean the limit is evaded by the
    // shift key — which is the whole reason case folding is not optional.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(3);
  });

  it("E1b a padded address never reaches the limiter — validation rejects it first", async () => {
    // Worth pinning rather than assuming: `normalizeIdentifier` trims, but D9 puts schema
    // validation AHEAD of the limiter and Zod's `.email()` refuses surrounding whitespace.
    // So the trim is belt-and-braces on this path, not the thing doing the work, and a
    // padded address is a 400 that is never counted at all.
    const response = await signIn(signInRequest({ email: `  ${EMAIL}  `, password: "wrong" }));
    expect(response.status).toBe(400);
    expect(await counters()).toEqual([]);
  });

  it("E2 SECURITY: a limit cannot be evaded by re-casing the address", async () => {
    await attemptSignIn(5, EMAIL);
    const evasion = await signIn(signInRequest({ email: EMAIL.toUpperCase(), password: "wrong" }));
    expect(evasion.status).toBe(429);
  });
});

describe("F · the IP dimension", () => {
  it("F1 a different source address gets its own identifier+IP bucket", async () => {
    await attemptSignIn(5, EMAIL, "198.51.100.1");
    // Same account, different source: the strict identifier+IP bucket is fresh, and the
    // looser identifier-only limit (20) has room, so this is served.
    expect((await attemptSignIn(1, EMAIL, "198.51.100.2"))[0]).toBe(401);
  });

  it("F2 SECURITY: a spoofed left-hand X-Forwarded-For cannot mint fresh buckets", async () => {
    await attemptSignIn(6, EMAIL, "198.51.100.9");

    // The caller prepends its own values; the edge appends the real peer on the right. A
    // left-most reader would see a brand-new "IP" each time and reset the bucket.
    const spoofed = await signIn(
      new Request(`${ORIGIN}/v1/auth/sign-in`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
          "x-forwarded-for": "1.2.3.4, 198.51.100.9",
        },
        body: JSON.stringify({ email: EMAIL, password: "wrong" }),
      }),
    );
    expect(spoofed.status).toBe(429);
  });

  it("F3 no trustworthy IP: the dimension is skipped and the identifier limit still holds", async () => {
    // No `x-forwarded-for` at all — a local run, or a request that never crossed the edge.
    const statuses = await attemptSignIn(21, EMAIL, null);

    // The identifier-only limit (20) is what bites; identifier+IP and per-IP are skipped.
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);

    const rows = await counters();
    expect(rows.map((r) => r.policy)).toEqual(["sign_in.identifier"]);
  });

  it("F4 a skipped IP dimension is reported, never silent", async () => {
    await attemptSignIn(1, EMAIL, null);

    const degraded = records.filter((r) => r.event === "auth.rate_limit_degraded");
    expect(degraded).toHaveLength(1);
    expect(degraded[0]?.level).toBe("warn");
    expect(degraded[0]?.meta?.["skipped_policies"]).toEqual([
      "sign_in.identifier_ip",
      "sign_in.ip",
    ]);
  });

  it("F5 an unparseable IP is treated as absent, not guessed at", async () => {
    await attemptSignIn(1, EMAIL, "not-an-ip");
    const rows = await counters();
    expect(rows.map((r) => r.policy)).toEqual(["sign_in.identifier"]);
  });
});

/* ─────────────────────────── ordering and response ─────────────────────────── */

describe("G · ordering — the limiter runs before the provider", () => {
  it("G1 sign-in: a rejected attempt makes no outbound call", async () => {
    await attemptSignIn(5);
    const before = providerCalls.length;

    const limited = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));

    expect(limited.status).toBe(429);
    // The whole point: an attacker's traffic costs us nothing outbound, and the 429 cannot
    // depend on whether the account exists.
    expect(providerCalls.length).toBe(before);
  });

  it("G2 magic-link: a rejected request sends no mail and starts no PKCE flow", async () => {
    providerMode = "ok";
    for (let i = 0; i < 3; i += 1) await magicLink(magicLinkRequest(EMAIL));
    const before = providerCalls.length;

    const limited = await magicLink(magicLinkRequest(EMAIL));

    expect(limited.status).toBe(429);
    expect(providerCalls.length).toBe(before);
    // No pending verifier cookie: a refused request must leave no half-started flow.
    expect(limited.headers.get("set-cookie")).toBeNull();
  });

  it("G3 CSRF is still checked ahead of the limiter", async () => {
    // A forged cross-site post must not be able to burn a victim's allowance.
    const forged = new Request(`${ORIGIN}/v1/auth/sign-in`, {
      method: "POST",
      headers: { origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: "wrong" }),
    });
    expect((await signIn(forged)).status).toBe(403);
    expect(await counters()).toEqual([]);
  });

  it("G4 a malformed body is rejected without touching the store", async () => {
    const bad = new Request(`${ORIGIN}/v1/auth/sign-in`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
      },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect((await signIn(bad)).status).toBe(400);
    expect(await counters()).toEqual([]);
  });
});

describe("H · the 429 response contract (ADR-013 D10)", () => {
  it("H1 is problem+json with the rate-limited type and no-store", async () => {
    await attemptSignIn(5);
    const limited = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("content-type")).toBe("application/problem+json");
    expect(limited.headers.get("cache-control")).toBe("no-store");

    const body = (await limited.json()) as { type: string; status: number; detail: string };
    expect(body.type).toBe("https://autobureau.com/problems/rate-limited");
    expect(body.status).toBe(429);
  });

  it("H2 carries a plausible Retry-After in seconds", async () => {
    await attemptSignIn(5);
    const limited = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));

    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    // Bounded by the 15-minute window and never zero — a `Retry-After: 0` invites the
    // immediate retry the header exists to prevent.
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
  });

  it("H3 Retry-After is the real remaining lifetime of the window that tripped", async () => {
    await attemptSignIn(6);
    const limited = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
    const header = Number(limited.headers.get("retry-after"));

    // Compared against the database's own arithmetic rather than a wall-clock delta: the
    // window is aligned to a 15-minute boundary, so how much of it remains depends on when
    // the suite happens to run, and an elapsed-time assertion would be flaky by design.
    const [row] = await admin.$queryRaw<Array<{ remaining: number }>>`
      SELECT ceil(extract(epoch FROM expires_at - now()))::int AS remaining
      FROM auth_rate_limits WHERE policy = 'sign_in.identifier_ip'
    `;
    expect(row).toBeDefined();
    expect(Math.abs(header - (row?.remaining ?? -999))).toBeLessThanOrEqual(2);
  });

  it("H4b Retry-After shrinks as the window is consumed", async () => {
    await attemptSignIn(6);
    const first = Number(
      (await signIn(signInRequest({ email: EMAIL, password: "wrong" }))).headers.get("retry-after"),
    );

    // Push the whole window five minutes into the past WITHOUT expiring it, so the same
    // row is still the live one and only its remaining time changes.
    await admin.$executeRawUnsafe(`
      UPDATE auth_rate_limits SET expires_at = expires_at - interval '1 minute'
    `);
    const later = Number(
      (await signIn(signInRequest({ email: EMAIL, password: "wrong" }))).headers.get("retry-after"),
    );

    // Strictly smaller, and by about the minute we removed. A limiter that restarted the
    // clock on every rejection would hold a caller off forever.
    expect(later).toBeLessThan(first);
    expect(first - later).toBeGreaterThanOrEqual(55);
  });

  it("H4 SECURITY: emits no RateLimit-* headers", async () => {
    await attemptSignIn(5);
    const limited = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));

    // Remaining-budget headers on an unauthenticated endpoint are an enumeration oracle and
    // a countdown for an attacker (ADR-013 D10).
    for (const [name] of limited.headers) {
      expect(name.toLowerCase().startsWith("ratelimit-")).toBe(false);
      expect(name.toLowerCase().startsWith("x-ratelimit-")).toBe(false);
    }
  });

  it("H5 SECURITY: the body leaks no counter, threshold, dimension, or subject", async () => {
    await attemptSignIn(5);
    const limited = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
    const text = await limited.text();

    for (const forbidden of [EMAIL, "limiter", IP, "sign_in", "identifier", "bucket", "policy"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/\b(?:5|20|60|900)\b/);
  });

  it("H6 SECURITY: an unknown address is rate-limited identically to a known one", async () => {
    // If a 429 only fired for real accounts, the limiter would undo the neutral
    // wrong-password/unknown-address message it sits in front of.
    await attemptSignIn(5, "definitely-not-a-user@example.test");
    const limited = await signIn(
      signInRequest({ email: "definitely-not-a-user@example.test", password: "wrong" }),
    );
    expect(limited.status).toBe(429);
  });
});

/* ─────────────────────────── failure mode ─────────────────────────── */

describe("I · fail open, loudly (ADR-013 D7)", () => {
  /** The ADR's own named scenario: a live deployment whose migration has not landed. */
  async function withMissingTable(fn: () => Promise<void>): Promise<void> {
    await admin.$executeRawUnsafe(`ALTER TABLE auth_rate_limits RENAME TO auth_rate_limits_hidden`);
    try {
      await fn();
    } finally {
      await admin.$executeRawUnsafe(
        `ALTER TABLE auth_rate_limits_hidden RENAME TO auth_rate_limits`,
      );
    }
  }

  it("I1 authentication still works when the limiter store is unreachable", async () => {
    await withMissingTable(async () => {
      const response = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
      // 401 from the provider, NOT a 429 and NOT a 503. Turning "the counters are
      // unreachable" into "nobody may sign in" would make the limiter the outage.
      expect(response.status).toBe(401);
    });
  });

  it("I2 magic-link also fails open", async () => {
    providerMode = "ok";
    await withMissingTable(async () => {
      expect((await magicLink(magicLinkRequest(EMAIL))).status).toBe(204);
    });
  });

  it("I3 the fail-open is recorded at error level — the condition the risk was accepted on", async () => {
    await withMissingTable(async () => {
      await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
    });

    const unavailable = records.filter((r) => r.event === "auth.rate_limit_unavailable");
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.level).toBe("error");
    expect(unavailable[0]?.meta?.["policy"]).toBe("sign_in.identifier_ip");
    expect(unavailable[0]?.error_message).toBeDefined();
  });

  it("I4 exactly ONE record per request, not one per policy", async () => {
    // Three policies fail together during an outage. Three records per sign-in would
    // triple log volume at exactly the moment logging matters most.
    await withMissingTable(async () => {
      await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
      await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
    });
    expect(records.filter((r) => r.event === "auth.rate_limit_unavailable")).toHaveLength(2);
  });

  it("I5 a store that ANSWERS 'over limit' is still honoured", async () => {
    // Fail-open covers only "could not be consulted", never a verdict actually returned.
    await attemptSignIn(6);
    expect((await attemptSignIn(1))[0]).toBe(429);
    expect(records.filter((r) => r.event === "auth.rate_limit_unavailable")).toHaveLength(0);
  });

  it("I6 a rejection is recorded as a warn with the policy that tripped", async () => {
    await attemptSignIn(6);

    const limited = records.filter((r) => r.event === "auth.rate_limited");
    expect(limited).toHaveLength(1);
    expect(limited[0]?.level).toBe("warn");
    expect(limited[0]?.status).toBe(429);
    expect(limited[0]?.meta?.["policy"]).toBe("sign_in.identifier_ip");
  });
});

describe("J · privacy of the observability record (ADR-013 D12/R3)", () => {
  it("J1 no record carries the address, the IP, the bucket, or a password", async () => {
    const { bucketOf, normalizeIdentifier } = await import("./rate-limit");
    await attemptSignIn(6);
    const text = JSON.stringify(records);

    for (const forbidden of [EMAIL, "limiter@", IP, "203.0.113", "wrong"]) {
      expect(text).not.toContain(forbidden);
    }

    // R3: no per-subject field at all — not even a truncated digest. Asserted against the
    // ACTUAL bucket values rather than a hex pattern, because a `[0-9a-f]{12,}` rule would
    // also flag `trace_id`, which is a uuidv7 and belongs in every record.
    const subject = normalizeIdentifier(EMAIL);
    for (const policy of ["sign_in.identifier", "sign_in.ip", "sign_in.identifier_ip"] as const) {
      const digest = bucketOf(policy, subject);
      expect(text).not.toContain(digest);
      expect(text).not.toContain(digest.slice(0, 12));
    }
    // And no full digest of any shape reached a record.
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("J2 the records still carry the policy class, which is what makes them actionable", async () => {
    await attemptSignIn(6);
    const limited = records.find((r) => r.event === "auth.rate_limited");
    expect(limited?.meta?.["policy"]).toBe("sign_in.identifier_ip");
    expect(limited?.route).toBe("/v1/auth/sign-in");
  });
});

/* ─────────────────────────── success clears ─────────────────────────── */

describe("K · a successful sign-in clears its identifier buckets (ADR-013 D6)", () => {
  it("K1 clears identifier buckets so a user who mistyped is not left near a lockout", async () => {
    await attemptSignIn(4);
    providerMode = "ok";

    const ok = await signIn(signInRequest({ email: EMAIL, password: "right" }));
    expect(ok.status).toBe(204);

    const identifierRows = await admin.$queryRaw<Array<{ policy: string }>>`
      SELECT policy FROM auth_rate_limits
      WHERE policy IN ('sign_in.identifier', 'sign_in.identifier_ip')
    `;
    expect(identifierRows).toEqual([]);
  });

  it("K2 SECURITY: it does NOT clear the shared per-IP bucket", async () => {
    await attemptSignIn(4);
    providerMode = "ok";
    await signIn(signInRequest({ email: EMAIL, password: "right" }));

    const ipRows = await admin.$queryRaw<Array<{ attempts: number }>>`
      SELECT attempts FROM auth_rate_limits WHERE policy = 'sign_in.ip'
    `;
    // Five attempts still counted against the source address. Clearing this would refund an
    // attacker's budget every time a neighbour behind the same CGNAT signed in.
    expect(ipRows).toHaveLength(1);
    expect(ipRows[0]?.attempts).toBe(5);
  });

  it("K3 a FAILED sign-in clears nothing", async () => {
    await attemptSignIn(3);
    const rows = await counters();
    expect(rows.every((r) => r.attempts === 3)).toBe(true);
  });
});

/* ─────────────────────────── retention ─────────────────────────── */

describe("L · retention and cleanup (ADR-013 D11)", () => {
  it("L1 a lapsed row is ignored even before it is physically removed", async () => {
    await attemptSignIn(6);
    expect((await attemptSignIn(1))[0]).toBe(429);

    // Expire the rows without deleting them. Correctness must not depend on a cleaner.
    await admin.$executeRawUnsafe(`UPDATE auth_rate_limits SET expires_at = now() - interval '1s'`);
    // The next request floors to a new window, so it keys a different row entirely.
    await admin.$executeRawUnsafe(`
      UPDATE auth_rate_limits SET window_started_at = window_started_at - interval '1 hour'
    `);

    expect((await attemptSignIn(1))[0]).toBe(401);
  });

  it("L2 an increment opportunistically sweeps its own policy's expired rows", async () => {
    await admin.$executeRawUnsafe(`
      INSERT INTO auth_rate_limits (policy, bucket, window_started_at, attempts, expires_at)
      SELECT 'sign_in.identifier', repeat(md5(g::text), 2), now() - interval '2 hours', 3,
             now() - interval '1 hour'
      FROM generate_series(1, 5) g
    `);
    expect(await countRows("sign_in.identifier")).toBe(5);

    await attemptSignIn(1);

    // The five lapsed rows are gone; only this attempt's live row remains.
    const remaining = await admin.$queryRaw<Array<{ attempts: number; expired: boolean }>>`
      SELECT attempts, expires_at <= now() AS expired
      FROM auth_rate_limits WHERE policy = 'sign_in.identifier'
    `;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.expired).toBe(false);
  });

  it("L3 the sweep is bounded, so one request can never do unbounded work", async () => {
    // 150 expired rows against a LIMIT of 100: the request must still succeed promptly and
    // must not attempt to delete all of them in one statement.
    await admin.$executeRawUnsafe(`
      INSERT INTO auth_rate_limits (policy, bucket, window_started_at, attempts, expires_at)
      SELECT 'magic_link.ip', repeat(md5(g::text), 2), now() - interval '2 hours', 1,
             now() - interval '1 hour'
      FROM generate_series(1, 150) g
    `);
    providerMode = "ok";

    expect((await magicLink(magicLinkRequest(EMAIL))).status).toBe(204);

    const left = await countRows("magic_link.ip");
    // 150 expired − at most 100 swept + 1 live. The lower bound is the property under test:
    // an unbounded sweep would leave exactly 1, so `>= 51` is what fails if the LIMIT is
    // ever dropped. The upper bound is 151 rather than 51 on purpose — `SKIP LOCKED` may
    // delete FEWER than 100 if another connection holds some of those rows, so pinning an
    // exact residue would be asserting the absence of contention rather than the presence
    // of a bound.
    expect(left).toBeGreaterThanOrEqual(51);
    expect(left).toBeLessThanOrEqual(151);
  });

  it("L4 a sweep never touches another policy's rows", async () => {
    await admin.$executeRawUnsafe(`
      INSERT INTO auth_rate_limits (policy, bucket, window_started_at, attempts, expires_at)
      VALUES ('magic_link.identifier', repeat('a', 64), now() - interval '2 hours', 1,
              now() - interval '1 hour')
    `);
    await attemptSignIn(1);
    expect(await countRows("magic_link.identifier")).toBe(1);
  });

  async function countRows(policy: string): Promise<number> {
    const rows = await admin.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM auth_rate_limits WHERE policy = ${policy}
    `;
    return Number(rows[0]?.n ?? 0);
  }
});

/* ─────────────────────────── the database door ─────────────────────────── */

describe("M · withGlobalTable is narrow, and the database enforces it", () => {
  it("M1 reaches auth_rate_limits on the ordinary app_user connection", async () => {
    const { createDatabase } = await import("@autobureau/db");
    const db = createDatabase(process.env["DATABASE_URL"]);
    try {
      const rows = await db.withGlobalTable("auth_rate_limits", (tx) =>
        tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM auth_rate_limits`,
      );
      expect(Number(rows[0]?.n ?? 0)).toBe(0);
    } finally {
      await db.disconnect();
    }
  });

  it("M2 SECURITY: it sets no GUC, so household data is invisible through it", async () => {
    // The structural safety property ADR-013 D2 leans on. Seed a household on the admin
    // connection, then prove the anonymous door cannot see it: with no `request.household_id`
    // set, every policy predicate is NULL and RLS returns nothing.
    const householdId = "0192f5a1-0000-7000-8000-0000000000f2";
    const ownerId = "0192f5a1-0000-7000-8000-0000000000f3";
    await admin.user.create({ data: { id: ownerId, email: "globaldoor@example.test" } });
    await admin.household.create({
      data: { id: householdId, name: "Invisible", createdBy: ownerId },
    });

    const { createDatabase } = await import("@autobureau/db");
    const db = createDatabase(process.env["DATABASE_URL"]);
    try {
      const rows = await db.withGlobalTable("auth_rate_limits", (tx) =>
        tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM households`,
      );
      expect(Number(rows[0]?.n ?? 0)).toBe(0);

      const items = await db.withGlobalTable("auth_rate_limits", (tx) =>
        tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM idempotency_keys`,
      );
      expect(Number(items[0]?.n ?? 0)).toBe(0);
    } finally {
      await db.disconnect();
      await admin.household.delete({ where: { id: householdId } });
      await admin.user.delete({ where: { id: ownerId } });
    }
  });

  it("M3 SECURITY: a write to a household-scoped table through it is refused", async () => {
    const { createDatabase } = await import("@autobureau/db");
    const db = createDatabase(process.env["DATABASE_URL"]);
    try {
      await expect(
        db.withGlobalTable("auth_rate_limits", (tx) =>
          tx.$queryRaw`
            INSERT INTO households (id, name, created_by)
            VALUES (gen_random_uuid(), 'smuggled', gen_random_uuid())
          `,
        ),
      ).rejects.toThrow();
    } finally {
      await db.disconnect();
    }
  });

  it("M4 rejects a table outside the allow-list at runtime as well as at compile time", async () => {
    const { createDatabase, ScopeError } = await import("@autobureau/db");
    const db = createDatabase(process.env["DATABASE_URL"]);
    try {
      await expect(
        // The union already makes this a type error; the cast proves the runtime assertion
        // behind it is real rather than decorative.
        db.withGlobalTable("households" as never, async () => undefined),
      ).rejects.toBeInstanceOf(ScopeError);
    } finally {
      await db.disconnect();
    }
  });

  it("M5 the RLS policy on auth_rate_limits is permissive by decision, and forced", async () => {
    const [flags] = await admin.$queryRaw<Array<{ enabled: boolean; forced: boolean }>>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE relname = 'auth_rate_limits'
    `;
    expect(flags).toEqual({ enabled: true, forced: true });

    const policies = await admin.$queryRaw<Array<{ using_expr: string; check_expr: string }>>`
      SELECT pg_get_expr(polqual, polrelid) AS using_expr,
             pg_get_expr(polwithcheck, polrelid) AS check_expr
      FROM pg_policy WHERE polrelid = 'auth_rate_limits'::regclass
    `;
    expect(policies).toEqual([{ using_expr: "true", check_expr: "true" }]);
  });

  it("M6 the table carries no tenant column and no foreign key", async () => {
    const columns = await admin.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'auth_rate_limits'
        AND column_name IN ('household_id', 'user_id')
    `;
    expect(columns).toEqual([]);

    const fks = await admin.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'auth_rate_limits'::regclass AND contype = 'f'
    `;
    // A foreign key to `users` would turn "this address attempted a sign-in" into a
    // joinable fact about a real account (ADR-013 D3).
    expect(fks).toEqual([]);
  });

  it("M7 no other table's RLS posture was changed by this migration", async () => {
    const rows = await admin.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
      ORDER BY c.relname
    `;
    // The pre-existing exceptions, unchanged: users/user_profiles are deliberately outside
    // RLS (P1-09 decides that), and _prisma_migrations is Prisma's own bookkeeping.
    expect(rows.map((r) => r.relname)).toEqual([
      "_prisma_migrations",
      "user_profiles",
      "users",
    ]);
  });
});

/* ─────────────────────────── the guardrails ─────────────────────────── */

describe("N · the CI fences and the code agree", () => {
  it("N1 the pinned union line in ci.yml matches scoped.ts exactly", async () => {
    const scoped = await readFile("../../packages/db/src/scoped.ts", "utf8");
    const ci = await readFile("../../.github/workflows/ci.yml", "utf8");

    const pinned = /expected='(export type GlobalTable = [^']+)'/.exec(ci)?.[1];
    expect(pinned).toBeDefined();
    // If this fails, the fence is checking a string the source no longer contains, and
    // widening the anonymous capability would sail through CI.
    expect(scoped.split("\n")).toContain(pinned);
  });

  it("N2 withGlobalTable appears only in allow-listed modules", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync(
      `grep -rl "withGlobalTable" --include="*.ts" --exclude-dir=dist --exclude-dir=node_modules packages apps || true`,
      { cwd: "../..", encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line !== "" && !line.endsWith(".test.ts"));

    expect(hits.sort()).toEqual([
      "apps/web/src/server/http/rate-limit.ts",
      "packages/db/src/scoped.ts",
    ]);
  });

  it("N3 the limiter reads no runtime configuration (ADR-013 R1.3)", async () => {
    const source = await readFile("src/server/http/rate-limit.ts", "utf8");
    // Comments are stripped before matching, exactly as the CI fence does it: the module's
    // own docblock explains that it must not read `process.env`, and a check that fired on
    // its own documentation would be deleted the first time it blocked a merge.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");

    // Thresholds an operator could widen without a code review would be outside the
    // governance that owns them.
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/getenv/);
  });
});

/* ─────────────────────────── regression ─────────────────────────── */

describe("O · existing authentication behaviour is unchanged", () => {
  it("O1 a valid sign-in still issues cookies and answers 204", async () => {
    providerMode = "ok";
    const response = await signIn(signInRequest({ email: EMAIL, password: "right" }));

    expect(response.status).toBe(204);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${COOKIE}_refresh=`))).toBe(true);
  });

  it("O2 no token appears in a sign-in body", async () => {
    providerMode = "ok";
    const response = await signIn(signInRequest({ email: EMAIL, password: "right" }));
    expect(await response.text()).toBe("");
  });

  it("O3 wrong credentials still answer 401 with the neutral message", async () => {
    const response = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toBe("That email and password don't match an account.");
  });

  it("O4 magic-link still answers 204 and sets the pending verifier cookie", async () => {
    providerMode = "ok";
    const response = await magicLink(magicLinkRequest(EMAIL));

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("O5 magic-link still hides whether an address has an account", async () => {
    providerMode = "reject";
    // The provider refuses; the caller is told nothing about it.
    expect((await magicLink(magicLinkRequest("stranger@example.test"))).status).toBe(204);
  });

  it("O6 an unconfigured deployment still reports itself before the limiter runs", async () => {
    const saved = process.env["AUTH_ISSUER"];
    process.env["AUTH_ISSUER"] = "";
    try {
      const { resetBoundaryCache } = await import("@/server/http/route");
      resetBoundaryCache();
      const response = await signIn(signInRequest({ email: EMAIL, password: "wrong" }));
      expect(response.status).toBe(503);
      // Configuration is checked first: nothing was counted.
      expect(await counters()).toEqual([]);
    } finally {
      process.env["AUTH_ISSUER"] = saved;
    }
  });
});
