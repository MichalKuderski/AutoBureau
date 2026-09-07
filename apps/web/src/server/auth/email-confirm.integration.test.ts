import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import type { PrismaClient } from "@prisma/client";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "@/test/integration/database";

/**
 * Email confirmation, end to end over HTTP — the regression test for the production defect
 * of 2026-09-07.
 *
 * WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
 * ------------------------------------------
 * With Supabase "Confirm email" ON, `/v1/auth/sign-up` correctly answers 202 with no session
 * and leaves the account inert. Nothing then completed it: the emailed link could not satisfy
 * `/auth/callback`, which demands a PKCE code plus the verifier cookie that sign-up never
 * sets. GoTrue confirmed the address; the application never learned of it. Staging could not
 * have caught this — it runs with confirmation OFF, so all 57 of its acceptance checks take
 * the other branch.
 *
 * That is the gap this file exists to close, and it closes it in the environment-independent
 * way: the provider below is a *contract-shaped* GoTrue whose `/verify` behaves as the
 * documented one does — the hash is single-use, an unknown hash is refused, and only a
 * genuine redemption returns tokens. So "already used" and "never issued" are tests of the
 * real rule rather than of a stub's politeness.
 *
 * EVIDENCE BOUNDARY — read this before trusting it.
 * Like `pkce.integration.test.ts`, nothing here is proved against a real Supabase project.
 * What is proved is that given a provider that speaks the documented `/verify` dialect, this
 * route establishes exactly the session, identity and household that password sign-in does.
 * Whether the real provider speaks that dialect is a staging question, and it needs
 * "Confirm email" ON to be answered.
 */

const ORIGIN = "https://app.autobureau.com";
const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const SUBJECT = "0192f5a1-0000-7000-8000-0000000000e7";
const EMAIL = "confirm@example.test";
const REFRESH = "refresh-value";

let ACCESS = "";
let jwks: JSONWebKeySet;
let admin: PrismaClient;
let provider: Server;

/** Hashes the provider has issued, and whether each has been spent. */
const issued = new Map<string, { redeemed: boolean }>();
/** Requests that actually reached `/verify` — proof a refusal never left this process. */
let verifyCalls = 0;
let verifyMode: "ok" | "malformed" | "unavailable" = "ok";

function mint(hash: string): string {
  issued.set(hash, { redeemed: false });
  return hash;
}

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();
  admin = adminClient();

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
  ACCESS = await new SignJWT({ email: EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setExpirationTime("1h")
    .sign(privateKey);

  provider = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (): Record<string, string> => {
        try {
          return JSON.parse(body) as Record<string, string>;
        } catch {
          return {};
        }
      };

      if (url.pathname === "/jwks.json") {
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(jwks));
      }

      if (url.pathname === "/verify") {
        verifyCalls += 1;
        if (verifyMode === "unavailable") return void res.writeHead(503).end("{}");

        const { token_hash: hash, type } = json();
        const pending = hash ? issued.get(hash) : undefined;

        // The two ways redemption legitimately fails, enforced rather than assumed — plus
        // a type this application never sends.
        if (!pending || pending.redeemed || (type !== "email" && type !== "signup")) {
          return void res
            .writeHead(401, { "content-type": "application/json" })
            .end('{"error":"invalid_token","error_description":"Token has expired or is invalid"}');
        }
        pending.redeemed = true;

        if (verifyMode === "malformed") {
          return void res
            .writeHead(200, { "content-type": "application/json" })
            .end('{"unexpected":"shape"}');
        }
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 }));
      }

      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const port = (provider.address() as AddressInfo).port;

  process.env["AUTH_ISSUER"] = ISSUER;
  process.env["AUTH_AUDIENCE"] = AUDIENCE;
  process.env["AUTH_JWKS_URL"] = `http://127.0.0.1:${port}/jwks.json`;
  process.env["AUTH_API_URL"] = `http://127.0.0.1:${port}`;
  process.env["AUTH_ANON_KEY"] = "publishable-anon-key";
  process.env["AUTH_COOKIE_NAME"] = "ab_session";
  process.env["APP_ORIGIN"] = ORIGIN;
});

afterAll(async () => {
  // Households first: `households.created_by` has no cascade, so the user cannot be deleted
  // while one exists. The same order production cleanup had to use.
  await admin?.household.deleteMany({ where: { createdBy: SUBJECT } });
  await admin?.user.deleteMany({ where: { id: SUBJECT } });
  await admin?.$disconnect();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

beforeEach(async () => {
  issued.clear();
  verifyCalls = 0;
  verifyMode = "ok";
  await admin.household.deleteMany({ where: { createdBy: SUBJECT } });
  await admin.user.deleteMany({ where: { id: SUBJECT } });
});

async function confirm(query: string): Promise<Response> {
  const { GET } = await import("@/app/auth/confirm/route");
  return GET(new Request(`${ORIGIN}/auth/confirm${query}`));
}

const cookiesOf = (r: Response): string[] => r.headers.getSetCookie();
const named = (r: Response, name: string): string | undefined =>
  cookiesOf(r).find((c) => c.startsWith(`${name}=`));

describe("following a valid confirmation link", () => {
  it("establishes the session the defect withheld", async () => {
    mint("hash-valid");
    const response = await confirm("?token_hash=hash-valid&type=email");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
    expect(named(response, "ab_session")).toBeDefined();
    expect(named(response, "ab_session_refresh")).toBeDefined();
  });

  it("issues cookies a script cannot read and a cross-site form cannot ride", async () => {
    mint("hash-attrs");
    const response = await confirm("?token_hash=hash-attrs&type=email");

    for (const name of ["ab_session", "ab_session_refresh"]) {
      const cookie = named(response, name)!;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
    }
  });

  it("mirrors the identity and bootstraps exactly one household", async () => {
    mint("hash-bootstrap");
    await confirm("?token_hash=hash-bootstrap&type=email");

    const user = await admin.user.findUnique({ where: { id: SUBJECT } });
    expect(user?.email).toBe(EMAIL);
    expect(await admin.userProfile.count({ where: { userId: SUBJECT } })).toBe(1);

    const households = await admin.household.findMany({ where: { createdBy: SUBJECT } });
    expect(households).toHaveLength(1);
    expect(
      await admin.householdUser.count({ where: { userId: SUBJECT, role: "owner" } }),
    ).toBe(1);
    expect(
      await admin.entitlement.count({ where: { householdId: households[0]!.id } }),
    ).toBe(1);
  });

  it("never lets a second link create a second household", async () => {
    mint("hash-first");
    mint("hash-second");
    await confirm("?token_hash=hash-first&type=email");
    await confirm("?token_hash=hash-second&type=email");

    expect(await admin.household.count({ where: { createdBy: SUBJECT } })).toBe(1);
    expect(await admin.householdUser.count({ where: { userId: SUBJECT } })).toBe(1);
  });

  it("honours a same-origin destination", async () => {
    mint("hash-next");
    const response = await confirm("?token_hash=hash-next&type=email&next=%2Fobligations");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/obligations`);
  });

  it("refuses a hostile destination rather than following it", async () => {
    mint("hash-evil");
    const response = await confirm(
      "?token_hash=hash-evil&type=email&next=https%3A%2F%2Fevil.example%2Fpwn",
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("carries no token onward in the redirect", async () => {
    mint("hash-secret");
    const response = await confirm("?token_hash=hash-secret&type=email");
    const location = response.headers.get("location")!;
    expect(location).not.toContain("hash-secret");
    expect(location).not.toContain(ACCESS);
    expect(location).not.toContain(REFRESH);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("accepts the signup type as well as email", async () => {
    mint("hash-signup");
    const response = await confirm("?token_hash=hash-signup&type=signup");
    expect(response.status).toBe(303);
  });
});

describe("a link that cannot be honoured fails safely and identically", () => {
  it("refuses a replayed link", async () => {
    mint("hash-replay");
    expect((await confirm("?token_hash=hash-replay&type=email")).status).toBe(303);

    const second = await confirm("?token_hash=hash-replay&type=email");
    expect(second.status).toBe(400);
    expect(await second.text()).toContain("This link didn&#x27;t work");
  });

  it("refuses a hash the provider never issued", async () => {
    const response = await confirm("?token_hash=hash-never-issued&type=email");
    expect(response.status).toBe(400);
  });

  it("refuses an unusable provider response without issuing a session", async () => {
    mint("hash-malformed");
    verifyMode = "malformed";
    const response = await confirm("?token_hash=hash-malformed&type=email");
    expect(response.status).toBe(400);
    expect(named(response, "ab_session")).toBeUndefined();
  });

  it("refuses when the provider is unreachable", async () => {
    mint("hash-unavailable");
    verifyMode = "unavailable";
    expect((await confirm("?token_hash=hash-unavailable&type=email")).status).toBe(400);
  });

  it("clears session cookies on every failure so a half-signed-in browser cannot linger", async () => {
    const response = await confirm("?token_hash=hash-nope&type=email");
    expect(named(response, "ab_session")).toContain("Max-Age=0");
    expect(named(response, "ab_session_refresh")).toContain("Max-Age=0");
  });

  it("creates nothing when it fails", async () => {
    await confirm("?token_hash=hash-nothing&type=email");
    expect(await admin.user.count({ where: { id: SUBJECT } })).toBe(0);
    expect(await admin.household.count({ where: { createdBy: SUBJECT } })).toBe(0);
  });

  it("rejects a missing, empty, oversized or unknown-type parameter before calling out", async () => {
    verifyCalls = 0;
    for (const query of [
      "",
      "?type=email",
      "?token_hash=&type=email",
      `?token_hash=${"a".repeat(513)}&type=email`,
      "?token_hash=hash-x",
      "?token_hash=hash-x&type=recovery",
      "?token_hash=hash-x&type=magiclink",
    ]) {
      expect((await confirm(query)).status).toBe(400);
    }
    // The point of the assertion: a malformed request is refused here, so a stranger cannot
    // use this endpoint to make the application hammer the provider on their behalf.
    expect(verifyCalls).toBe(0);
  });

  it("says the same thing however it failed", async () => {
    mint("hash-used");
    await confirm("?token_hash=hash-used&type=email");

    const [replayed, unknown, badType] = await Promise.all([
      confirm("?token_hash=hash-used&type=email"),
      confirm("?token_hash=hash-absent&type=email"),
      confirm("?token_hash=hash-used&type=recovery"),
    ]);

    const bodies = await Promise.all([replayed.text(), unknown.text(), badType.text()]);
    expect(new Set(bodies).size).toBe(1);
    expect(new Set([replayed.status, unknown.status, badType.status]).size).toBe(1);
  });
});
