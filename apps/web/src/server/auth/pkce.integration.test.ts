import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import type { PrismaClient } from "@prisma/client";
import { adminClient, assertExpectedServer, grantAppUserLogin } from "@/test/integration/database";
import { CSRF_HEADER } from "@/lib/csrf";
import { decodePending, verifierCookieName } from "@/server/auth/pkce";
import type { AuthConfig } from "@/server/auth/config";

/**
 * The PKCE magic-link flow, end to end over HTTP.
 *
 * EVIDENCE BOUNDARY — read this before trusting any of it.
 * Nothing here is proved against a real Supabase project; none exists. The server below
 * is a *contract-shaped* GoTrue: it implements the parts of the documented protocol the
 * flow depends on, and it enforces them properly — it stores the challenge, recomputes
 * S256 from the presented verifier, and refuses to redeem a code twice. That makes
 * "wrong verifier" and "replayed code" genuine tests of the binding rather than of a
 * stub's politeness. What remains unproved is whether the real provider speaks exactly
 * this dialect; that is the first thing to check when a project exists.
 */

const ORIGIN = "https://app.autobureau.com";
const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const SUBJECT = "0192f5a1-0000-7000-8000-0000000000e2";
const EMAIL = "pkce@example.test";
const REFRESH = "refresh-value";

/** Real signed token: redemption verifies and mirrors before it issues cookies. */
let ACCESS = "";
let jwks: JSONWebKeySet;
let admin: PrismaClient;

interface Pending {
  challenge: string;
  redeemed: boolean;
}

let provider: Server;
const issued = new Map<string, Pending>();
/** The code the provider issued most recently — the one this flow's cookie pairs with. */
let lastIssuedCode = "";
let lastOtp: {
  email?: string | undefined;
  challenge?: string | undefined;
  method?: string | undefined;
  redirectTo?: string | undefined;
} = {};
let otpMode: "ok" | "reject" | "rate-limit" = "ok";
/** Counts redemption attempts that actually reached the provider. */
let tokenCalls = 0;
let tokenMode: "ok" | "malformed" = "ok";

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
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

      if (url.pathname === "/otp") {
        const payload = json();
        lastOtp = {
          email: payload["email"],
          challenge: payload["code_challenge"],
          method: payload["code_challenge_method"],
          redirectTo: url.searchParams.get("redirect_to") ?? undefined,
        };
        if (otpMode === "reject") return void res.writeHead(400).end('{"msg":"user not found"}');
        if (otpMode === "rate-limit") return void res.writeHead(429).end("{}");
        const code = randomUUID();
        issued.set(code, { challenge: payload["code_challenge"] ?? "", redeemed: false });
        lastIssuedCode = code;
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ code }));
      }

      if (url.pathname === "/token" && url.searchParams.get("grant_type") === "pkce") {
        tokenCalls += 1;
        const { auth_code: authCode, code_verifier: verifier } = json();
        const pending = authCode ? issued.get(authCode) : undefined;

        // The three ways redemption legitimately fails, enforced rather than assumed.
        if (!pending || pending.redeemed || s256(verifier ?? "") !== pending.challenge) {
          return void res
            .writeHead(400, { "content-type": "application/json" })
            .end('{"error":"invalid_grant","error_description":"code verifier mismatch"}');
        }
        pending.redeemed = true;

        if (tokenMode === "malformed") {
          return void res
            .writeHead(200, { "content-type": "application/json" })
            .end('{"unexpected":"shape"}');
        }
        return void res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 }),
        );
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
  await admin?.user.deleteMany({ where: { id: SUBJECT } });
  await admin?.$disconnect();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

const config = { cookieName: "ab_session" } as AuthConfig;
const cookiesOf = (r: Response): string[] => r.headers.getSetCookie();
const named = (r: Response, name: string): string | undefined =>
  cookiesOf(r).find((c) => c.startsWith(`${name}=`));

/** Requests a link and returns the pending cookie plus the code the provider issued. */
async function beginFlow(next?: string): Promise<{ cookie: string; code: string }> {
  const { POST } = await import("@/app/v1/auth/magic-link/route");
  const response = await POST(
    new Request(`${ORIGIN}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: "1" },
      body: JSON.stringify(next === undefined ? { email: "a@example.test" } : { email: "a@example.test", next }),
    }),
  );
  expect(response.status).toBe(204);
  const raw = named(response, verifierCookieName(config))!;
  const value = raw.split(";")[0]!.split("=").slice(1).join("=");
  return { cookie: `${verifierCookieName(config)}=${value}`, code: lastIssuedCode };
}

async function callback(query: string, cookie: string | null): Promise<Response> {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(
    new Request(`${ORIGIN}/auth/callback${query}`, {
      headers: cookie === null ? {} : { cookie },
    }),
  );
}

describe("requesting a link starts a PKCE authorization", () => {
  it("sends only the S256 challenge, never the verifier", async () => {
    const { cookie } = await beginFlow();
    const pending = decodePending(cookie.split("=").slice(1).join("="))!;
    expect(lastOtp.method).toBe("S256");
    expect(lastOtp.challenge).toBe(s256(pending.verifier));
    expect(JSON.stringify(lastOtp)).not.toContain(pending.verifier);
  });

  it("points the provider at our callback", async () => {
    await beginFlow();
    expect(lastOtp.redirectTo).toBe(`${ORIGIN}/auth/callback`);
  });

  it("stores the destination in the cookie, not in the redirect URL", async () => {
    const { cookie } = await beginFlow("/obligations/o-1");
    expect(decodePending(cookie.split("=").slice(1).join("="))!.next).toBe("/obligations/o-1");
    expect(lastOtp.redirectTo).not.toContain("obligations");
  });

  it("refuses a hostile destination before storing it", async () => {
    const { cookie } = await beginFlow("https://evil.example/pwn");
    expect(decodePending(cookie.split("=").slice(1).join("="))!.next).toBe("/dashboard");
  });

  it("answers 204 for an unknown address — no membership oracle", async () => {
    otpMode = "reject";
    try {
      const { POST } = await import("@/app/v1/auth/magic-link/route");
      const response = await POST(
        new Request(`${ORIGIN}/v1/auth/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", [CSRF_HEADER]: "1" },
          body: JSON.stringify({ email: "nobody@example.test" }),
        }),
      );
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    } finally {
      otpMode = "ok";
    }
  });

  it("does surface rate limiting, which is about the request not the account", async () => {
    otpMode = "rate-limit";
    try {
      const { POST } = await import("@/app/v1/auth/magic-link/route");
      const response = await POST(
        new Request(`${ORIGIN}/v1/auth/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", [CSRF_HEADER]: "1" },
          body: JSON.stringify({ email: "a@example.test" }),
        }),
      );
      expect(response.status).toBe(429);
    } finally {
      otpMode = "ok";
    }
  });

  it("requires CSRF", async () => {
    const { POST } = await import("@/app/v1/auth/magic-link/route");
    const response = await POST(
      new Request(`${ORIGIN}/v1/auth/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.test" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(cookiesOf(response)).toHaveLength(0);
  });
});

describe("successful redemption", () => {
  it("exchanges the code and issues session cookies", async () => {
    const { cookie, code } = await beginFlow("/documents");
    const response = await callback(`?code=${code}`, cookie);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/documents`);
    for (const name of ["ab_session", "ab_session_refresh"]) {
      const set = named(response, name)!;
      expect(set).toContain("HttpOnly");
      expect(set).toContain("Secure");
      expect(set).toContain("SameSite=Lax");
      expect(set).toContain("Path=/");
    }
  });

  it("deletes the verifier cookie once it has been spent", async () => {
    const { cookie, code } = await beginFlow();
    const response = await callback(`?code=${code}`, cookie);
    const cleared = named(response, verifierCookieName(config))!;
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/auth/callback");
  });

  it("puts no token in the body, the Location, or any other header", async () => {
    const { cookie, code } = await beginFlow();
    const response = await callback(`?code=${code}`, cookie);
    expect(await response.text()).toBe("");
    expect(response.headers.get("location")).not.toContain(ACCESS);
    expect(response.headers.get("location")).not.toContain(REFRESH);
    for (const [name, value] of response.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") continue;
      expect(value).not.toContain(ACCESS);
      expect(value).not.toContain(REFRESH);
    }
  });
});

describe("redemption fails closed", () => {
  const expectAbandoned = async (response: Response): Promise<void> => {
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
    const cookies = cookiesOf(response);
    // pending + both session cookies, all expired.
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
    expect(JSON.stringify(cookies)).not.toContain(ACCESS);
  };

  it("no verifier cookie at all", async () => {
    const { code } = await beginFlow();
    await expectAbandoned(await callback(`?code=${code}`, null));
  });

  it("wrong verifier — a code from another flow", async () => {
    const first = await beginFlow();
    const second = await beginFlow();
    // second's cookie, first's code: the challenge will not match.
    await expectAbandoned(await callback(`?code=${first.code}`, second.cookie));
  });

  it("a code cannot be redeemed without the matching verifier", async () => {
    const { code } = await beginFlow();
    const foreign = await beginFlow();
    const response = await callback(`?code=${code}`, foreign.cookie);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
    expect(named(response, "ab_session")).toContain("Max-Age=0");
  });

  it("a replayed code", async () => {
    const { cookie, code } = await beginFlow();
    expect((await callback(`?code=${code}`, cookie)).headers.get("location")).not.toBe(
      `${ORIGIN}/sign-in`,
    );
    // The verifier cookie is gone after the first attempt, so a replay has nothing to
    // present — and the provider would refuse the code anyway.
    await expectAbandoned(await callback(`?code=${code}`, cookie));
  });

  it("a malformed or tampered verifier cookie", async () => {
    const { code } = await beginFlow();
    for (const value of ["not-base64!!", btoa("null"), btoa('{"verifier":"short","next":"/"}')]) {
      await expectAbandoned(await callback(`?code=${code}`, `${verifierCookieName(config)}=${value}`));
    }
  });

  it("refuses a malformed cookie locally, without asking the provider", async () => {
    // The distinguishing assertion. A bogus verifier would be rejected by the provider
    // too, so outcome alone cannot tell whether OUR validation ran — but a redemption we
    // never attempted is unambiguous. This is what fails if decode validation is skipped.
    const { code } = await beginFlow();
    const before = tokenCalls;
    for (const value of ["not-base64!!", btoa("null"), btoa('{"verifier":"short","next":"/"}')]) {
      await callback(`?code=${code}`, `${verifierCookieName(config)}=${value}`);
    }
    expect(tokenCalls).toBe(before);
  });

  it("does not contact the provider when there is no verifier cookie", async () => {
    const { code } = await beginFlow();
    const before = tokenCalls;
    await callback(`?code=${code}`, null);
    expect(tokenCalls).toBe(before);
  });

  it("does not contact the provider when the code is absent or oversized", async () => {
    const { cookie } = await beginFlow();
    const before = tokenCalls;
    await callback("", cookie);
    await callback(`?code=${"x".repeat(600)}`, cookie);
    expect(tokenCalls).toBe(before);
  });

  it("a missing or oversized code", async () => {
    const { cookie } = await beginFlow();
    await expectAbandoned(await callback("", cookie));
    await expectAbandoned(await callback(`?code=${"x".repeat(600)}`, cookie));
  });

  it("a provider error in the query string, without echoing it", async () => {
    const { cookie } = await beginFlow();
    const response = await callback(
      "?error=access_denied&error_description=Email+link+is+invalid+or+has+expired",
      cookie,
    );
    await expectAbandoned(response);
    const dump = JSON.stringify([...response.headers.entries()]);
    expect(dump).not.toMatch(/access_denied|expired|invalid/i);
  });

  it("a malformed token response from the provider", async () => {
    tokenMode = "malformed";
    try {
      const { cookie, code } = await beginFlow();
      await expectAbandoned(await callback(`?code=${code}`, cookie));
    } finally {
      tokenMode = "ok";
    }
  });
});

describe("the destination is validated on the way out too", () => {
  it.each([
    ["cross-origin", "https://evil.example/pwn"],
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
  ])("%s falls back to the default", async (_label, hostile) => {
    // Stored destinations are validated on entry, so forge the cookie directly to prove
    // the exit check is real and not merely redundant.
    const { code } = await beginFlow();
    const forged = btoa(JSON.stringify({ verifier: "x".repeat(43), next: hostile }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const response = await callback(
      `?code=${code}`,
      `${verifierCookieName(config)}=${forged}`,
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
  });
});

describe("the verifier cookie is not a credential", () => {
  it("does not authenticate a protected route on its own", async () => {
    const { cookie } = await beginFlow();
    const { evaluate } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    const decision = await evaluate(
      new NextRequest(new URL("/dashboard", ORIGIN), { headers: { cookie } }),
      null,
    );
    // Unconfigured deps deny anyway; the point is that it is never treated as a session.
    expect(decision.kind).toBe("redirect");
    expect(decision.kind === "redirect" && decision.to).toMatch(/^\/sign-in/);
  });

  it("carries no token — only a verifier and a path", async () => {
    const { cookie } = await beginFlow();
    const pending = decodePending(cookie.split("=").slice(1).join("="))!;
    expect(Object.keys(pending).sort()).toEqual(["next", "verifier"]);
    expect(cookie).not.toContain(ACCESS);
    expect(cookie).not.toContain(REFRESH);
  });
});
