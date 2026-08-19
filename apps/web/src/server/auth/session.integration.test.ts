import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import type { PrismaClient } from "@prisma/client";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "@/test/integration/database";

/**
 * ADR-009 A3 — "no token reaches the browser", proven at the HTTP boundary.
 *
 * The real route handlers are driven with real `Request` objects and the real `Response`
 * is inspected. The identity provider is a local server speaking the documented GoTrue
 * contract: there is no Supabase project, and fabricating one would prove nothing that
 * this does not. What is under test is our transport — where the tokens end up.
 *
 * The refresh flow and its loop guard are here too, because both are about what the
 * browser is handed.
 */

const ORIGIN = "https://app.autobureau.com";
const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const SUBJECT = "0192f5a1-0000-7000-8000-0000000000e1";
const EMAIL = "session@example.test";
const REFRESH = "refresh-token-value";
const NEW_REFRESH = "rotated-refresh-value";
const CSRF_HEADER = "x-autobureau-request";

/**
 * Real signed tokens, because sign-in now verifies what it is about to store and mirrors
 * the identity it finds inside. An opaque string would fail before the transport under
 * test was reached — the provider is still contract-shaped, but its tokens are genuine.
 */
let ACCESS = "";
let ROTATED = "";
let jwks: JSONWebKeySet;
let admin: PrismaClient;

let provider: Server;
let providerCalls: Array<{ path: string; apikey: string | undefined; auth: string | undefined }> = [];
/** Flipped by tests to make the provider refuse. */
let providerMode: "ok" | "reject" = "ok";
/**
 * Flipped by tests to make revocation fail specifically.
 *
 * Separate from `providerMode` because `/logout` is matched before it, and because the
 * property under test is the opposite one: a token grant that fails must not issue a
 * session, whereas a revocation that fails must still end the local one.
 */
let logoutMode: "ok" | "fail" = "ok";

beforeAll(async () => {
  await assertExpectedServer();
  await grantAppUserLogin();
  admin = adminClient();

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
  const mint = (): Promise<string> =>
    new SignJWT({ email: EMAIL })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(SUBJECT)
      .setExpirationTime("1h")
      .sign(privateKey);
  ACCESS = await mint();
  ROTATED = await mint();

  provider = createServer((req, res) => {
    providerCalls.push({
      path: req.url ?? "",
      apikey: req.headers["apikey"] as string | undefined,
      auth: req.headers["authorization"] as string | undefined,
    });
    const url = req.url ?? "";
    if (url.startsWith("/jwks.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    if (url.startsWith("/logout")) {
      res.writeHead(logoutMode === "fail" ? 500 : 204).end();
      return;
    }
    if (providerMode === "reject") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "Wrong password" }));
      return;
    }
    const rotating = url.includes("grant_type=refresh_token");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        access_token: rotating ? ROTATED : ACCESS,
        refresh_token: rotating ? NEW_REFRESH : REFRESH,
        expires_in: 3600,
        token_type: "bearer",
      }),
    );
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
  await admin?.user.deleteMany({ where: { id: SUBJECT } });
  await admin?.$disconnect();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

function signInRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/v1/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", [CSRF_HEADER]: "1", ...headers },
    body: JSON.stringify(body),
  });
}

const cookiesOf = (r: Response): string[] => r.headers.getSetCookie();
const cookieNamed = (r: Response, name: string): string | undefined =>
  cookiesOf(r).find((c) => c.startsWith(`${name}=`));

describe("A3 · sign-in puts tokens in cookies and nowhere else", () => {
  it("sets both session cookies with every required attribute", async () => {
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    const response = await POST(signInRequest({ email: "a@example.test", password: "pw" }));

    expect(response.status).toBe(204);
    const access = cookieNamed(response, "ab_session");
    const refresh = cookieNamed(response, "ab_session_refresh");
    for (const cookie of [access, refresh]) {
      expect(cookie).toBeDefined();
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
    }
    expect(access).toContain(ACCESS);
    expect(refresh).toContain(REFRESH);
  });

  it("returns no body at all, so no token can be in one", async () => {
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    const response = await POST(signInRequest({ email: "a@example.test", password: "pw" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("puts no token in any header other than Set-Cookie", async () => {
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    const response = await POST(signInRequest({ email: "a@example.test", password: "pw" }));
    for (const [name, value] of response.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") continue;
      expect(value).not.toContain(ACCESS);
      expect(value).not.toContain(REFRESH);
    }
  });

  it("sends the publishable key to the provider and never the token back", async () => {
    providerCalls = [];
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    await POST(signInRequest({ email: "a@example.test", password: "pw" }));
    expect(providerCalls[0]?.apikey).toBe("publishable-anon-key");
    expect(providerCalls[0]?.path).toContain("grant_type=password");
  });

  it("mirrors the verified identity before the session exists", async () => {
    await admin.user.deleteMany({ where: { id: SUBJECT } });
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    const response = await POST(signInRequest({ email: "a@example.test", password: "pw" }));

    expect(response.status).toBe(204);
    const user = await admin.user.findUniqueOrThrow({ where: { id: SUBJECT } });
    expect(user.email).toBe(EMAIL);
    expect(await admin.userProfile.count({ where: { userId: SUBJECT } })).toBe(1);
  });

  it("issues nothing when the provider's own token does not verify", async () => {
    // The provider is reachable and answers 200, but with a token this deployment does
    // not accept. Storing it would hand out a session that fails on the next request.
    const foreign = await generateKeyPair("RS256", { extractable: true });
    const unusable = await new SignJWT({ email: EMAIL })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(SUBJECT)
      .setExpirationTime("1h")
      .sign(foreign.privateKey);

    const good = ACCESS;
    ACCESS = unusable;
    try {
      const { POST } = await import("@/app/v1/auth/sign-in/route");
      const response = await POST(signInRequest({ email: "a@example.test", password: "pw" }));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(cookiesOf(response)).toHaveLength(0);
    } finally {
      ACCESS = good;
    }
  });

  it("refuses without the CSRF header", async () => {
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    const response = await POST(
      new Request(`${ORIGIN}/v1/auth/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.test", password: "pw" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(cookiesOf(response)).toHaveLength(0);
  });

  it("gives one answer for wrong password and unknown account alike", async () => {
    providerMode = "reject";
    try {
      const { POST } = await import("@/app/v1/auth/sign-in/route");
      const response = await POST(signInRequest({ email: "a@example.test", password: "nope" }));
      expect(response.status).toBe(401);
      const text = await response.text();
      // The provider said "Wrong password"; that must not travel.
      expect(text).not.toMatch(/wrong password|invalid_grant/i);
      expect(text).toContain("https://autobureau.com/problems/");
      expect(cookiesOf(response)).toHaveLength(0);
    } finally {
      providerMode = "ok";
    }
  });

  it("rejects a malformed body without contacting the provider", async () => {
    providerCalls = [];
    const { POST } = await import("@/app/v1/auth/sign-in/route");
    const response = await POST(signInRequest({ email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(providerCalls).toHaveLength(0);
  });
});

describe("A3 · sign-out clears both cookies", () => {
  it("expires access and refresh together", async () => {
    const { POST } = await import("@/app/v1/auth/sign-out/route");
    const response = await POST(
      new Request(`${ORIGIN}/v1/auth/sign-out`, {
        method: "POST",
        headers: { [CSRF_HEADER]: "1", cookie: `ab_session=${ACCESS}` },
      }),
    );
    expect(response.status).toBe(204);
    const cookies = cookiesOf(response);
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
  });

  it("revokes at the provider with the access token", async () => {
    providerCalls = [];
    const { POST } = await import("@/app/v1/auth/sign-out/route");
    await POST(
      new Request(`${ORIGIN}/v1/auth/sign-out`, {
        method: "POST",
        headers: { [CSRF_HEADER]: "1", cookie: `ab_session=${ACCESS}` },
      }),
    );
    expect(providerCalls.at(-1)?.path).toContain("/logout");
    expect(providerCalls.at(-1)?.auth).toBe(`Bearer ${ACCESS}`);
  });

  it("still requires CSRF", async () => {
    const { POST } = await import("@/app/v1/auth/sign-out/route");
    const response = await POST(
      new Request(`${ORIGIN}/v1/auth/sign-out`, { method: "POST" }),
    );
    expect(response.status).toBe(403);
  });

  /**
   * P0-02 Case C. The endpoint's documented promise is that "a user who pressed sign-out
   * must end up signed out of this origin even when the provider is unreachable", and the
   * client now depends on it: a 204 is what the UI treats as proof the local session is
   * gone. If revocation failure ever started propagating, the button would begin claiming
   * a success it had not been given, which is the defect this whole task removes.
   */
  it("clears the local session even when the provider refuses to revoke", async () => {
    logoutMode = "fail";
    try {
      const { POST } = await import("@/app/v1/auth/sign-out/route");
      const response = await POST(
        new Request(`${ORIGIN}/v1/auth/sign-out`, {
          method: "POST",
          headers: { [CSRF_HEADER]: "1", cookie: `ab_session=${ACCESS}` },
        }),
      );

      expect(response.status).toBe(204);
      const cookies = cookiesOf(response);
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
      // The attempt is still made — best-effort is not no-effort.
      expect(providerCalls.at(-1)?.path).toContain("/logout");
    } finally {
      logoutMode = "ok";
    }
  });
});

describe("the refresh route rotates and redirects", () => {
  async function refresh(query: string, cookie: string | null): Promise<Response> {
    const { GET } = await import("@/app/auth/refresh/route");
    return GET(
      new Request(`${ORIGIN}/auth/refresh${query}`, {
        headers: cookie === null ? {} : { cookie },
      }),
    );
  }

  it("rotates the pair and returns to the requested destination", async () => {
    const response = await refresh(
      `?next=${encodeURIComponent("/obligations/o-1")}`,
      `ab_session_refresh=${REFRESH}`,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/obligations/o-1`);
    expect(cookieNamed(response, "ab_session")).toContain(ROTATED);
    expect(cookieNamed(response, "ab_session_refresh")).toContain(NEW_REFRESH);
  });

  it("puts no token in the redirect URL", async () => {
    const response = await refresh(`?next=${encodeURIComponent("/dashboard")}`, `ab_session_refresh=${REFRESH}`);
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain(ROTATED);
    expect(location).not.toContain(NEW_REFRESH);
    expect(location).not.toContain("token");
  });

  it("refuses an off-origin destination", async () => {
    const response = await refresh("?next=https://evil.example/pwn", `ab_session_refresh=${REFRESH}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("refuses to send itself back to itself", async () => {
    const response = await refresh(
      `?next=${encodeURIComponent("/auth/refresh")}`,
      `ab_session_refresh=${REFRESH}`,
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("clears BOTH cookies when the provider refuses — this is the loop guard", async () => {
    providerMode = "reject";
    try {
      const response = await refresh("?next=%2Fdashboard", `ab_session_refresh=${REFRESH}`);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
      const cookies = cookiesOf(response);
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
      // With the refresh cookie gone, middleware's redirect condition is gone too.
    } finally {
      providerMode = "ok";
    }
  });

  it("abandons when there is no refresh cookie at all", async () => {
    const response = await refresh("?next=%2Fdashboard", null);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
    expect(cookiesOf(response)).toHaveLength(2);
  });
});

describe("A3 · no auth token in the client bundle", () => {
  it("ships no cookie name, token, or provider key to the browser", async () => {
    const staticDir = join(process.cwd(), ".next", "static");
    const files: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith(".js")) files.push(path);
      }
    }
    await walk(staticDir).catch(() => {
      throw new Error("no .next/static — run `next build` before the integration suite");
    });
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, `${file} contains a session token`).not.toContain(ACCESS);
      expect(source, `${file} contains a refresh token`).not.toContain(REFRESH);
      expect(source, `${file} contains the provider key`).not.toContain("publishable-anon-key");
      // The client has no reason to know the cookie's name; if it did, something is
      // reading it.
      expect(source, `${file} references the session cookie`).not.toContain("ab_session");
    }
  });

  it("no client module reads document.cookie for the session", async () => {
    const staticDir = join(process.cwd(), ".next", "static");
    const files: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith(".js")) files.push(path);
      }
    }
    await walk(staticDir);
    const offenders = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/localStorage\.(get|set)Item\(["'`][^"'`]*(token|session|auth)/i.test(source)) {
        offenders.push(file);
      }
      if (/sessionStorage\.(get|set)Item\(["'`][^"'`]*(token|session|auth)/i.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
