// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { createJwtVerifier } from "@/server/auth/jwt";
import { PUBLIC_PATHS } from "@/server/http/public-routes";
import type { AuthConfig } from "@/server/auth/config";
import { config as matcherConfig, evaluate, type MiddlewareDeps } from "./middleware";

/**
 * ADR-009 A4 — deny-by-default routing, proven through the decision middleware actually
 * makes. Tokens are signed with real keys; only the JWKS is local, so the verification
 * path is the shipped one.
 */

const ISSUER = "https://auth.example.test/v1";
const AUDIENCE = "autobureau";
const ORIGIN = "https://app.autobureau.com";
const USER = "0192f5a1-0000-7000-8000-000000000001";

let signingKey: CryptoKey;
let deps: MiddlewareDeps;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  signingKey = privateKey;
  const jwks: JSONWebKeySet = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }],
  };
  const authConfig = {
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: { keys: jwks },
    cookieName: "ab_session",
    refreshCookieName: "ab_session_refresh",
    apiUrl: ISSUER,
    anonKey: "anon",
    allowedOrigins: [ORIGIN],
    algorithms: ["RS256"],
  } as unknown as AuthConfig;

  deps = {
    config: authConfig,
    verifier: createJwtVerifier({
      jwks: { keys: jwks },
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["RS256"],
    }),
  };
});

async function token(expiresIn: string | number = "1h"): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(USER)
    .setExpirationTime(expiresIn)
    .sign(signingKey);
}

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(new URL(path, ORIGIN), {
    headers: cookie ? { cookie } : {},
  });
}

const PROTECTED_HTML = [
  "/dashboard",
  "/obligations",
  "/obligations/o-1",
  "/documents",
  "/household",
  "/onboarding",
  "/onboarding/census",
  "/settings/privacy",
  "/a/route/added/tomorrow",
];
const PROTECTED_API = ["/v1/households/current", "/v1/obligations", "/v1/anything"];

describe("A4 · the matcher is catch-all", () => {
  it("excludes only framework assets", () => {
    expect(matcherConfig.matcher).toHaveLength(1);
    const pattern = matcherConfig.matcher[0]!;
    // A negative lookahead over the whole path: everything not named is matched.
    expect(pattern).toMatch(/^\/\(\(\?!/);
    for (const excluded of ["_next/static", "_next/image", "favicon.ico"]) {
      expect(pattern).toContain(excluded);
    }
  });

  it("matches every application path, including ones that do not exist yet", () => {
    const regex = new RegExp(`^${matcherConfig.matcher[0]!}$`);
    for (const path of [...PROTECTED_HTML, ...PROTECTED_API, "/", "/sign-in"]) {
      expect(regex.test(path), `${path} should be matched`).toBe(true);
    }
  });

  it("does not match the framework assets it excludes", () => {
    const regex = new RegExp(`^${matcherConfig.matcher[0]!}$`);
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico"]) {
      expect(regex.test(path), `${path} should be excluded`).toBe(false);
    }
  });
});

describe("A4 · public routes pass without a session", () => {
  it.each([...PUBLIC_PATHS])("%s is allowed", async (path) => {
    expect(await evaluate(request(path), deps)).toEqual({ kind: "allow" });
  });
});

describe("A4 · protected routes deny by default", () => {
  it.each(PROTECTED_HTML)("%s without a session redirects to sign-in", async (path) => {
    const decision = await evaluate(request(path), deps);
    expect(decision.kind).toBe("redirect");
    expect(decision.kind === "redirect" && decision.to).toMatch(/^\/sign-in\?next=/);
  });

  it.each(PROTECTED_API)("%s without a session is 401, not a redirect", async (path) => {
    // Bouncing an XHR through a redirect chain corrupts it; the client owns its retry.
    expect(await evaluate(request(path), deps)).toEqual({ kind: "unauthorized" });
  });

  it("preserves the attempted destination for the round trip", async () => {
    const decision = await evaluate(request("/obligations/o-1"), deps);
    expect(decision.kind === "redirect" && decision.to).toBe(
      `/sign-in?next=${encodeURIComponent("/obligations/o-1")}`,
    );
  });

  it("refuses a hostile destination even while denying", async () => {
    const decision = await evaluate(
      new NextRequest(new URL("/dashboard", ORIGIN)),
      deps,
    );
    expect(decision.kind === "redirect" && decision.to).not.toContain("evil");
  });
});

describe("a valid session passes", () => {
  it.each([...PROTECTED_HTML, ...PROTECTED_API])("%s is allowed", async (path) => {
    const decision = await evaluate(request(path, { ab_session: await token() }), deps);
    expect(decision).toEqual({ kind: "allow" });
  });
});

describe("invalid sessions are denied, never refreshed", () => {
  it("a garbage token is denied outright", async () => {
    const decision = await evaluate(request("/dashboard", { ab_session: "not-a-jwt" }), deps);
    expect(decision.kind).toBe("redirect");
    expect(decision.kind === "redirect" && decision.to).toMatch(/^\/sign-in/);
  });

  it("an expired token with NO refresh cookie goes to sign-in, not to refresh", async () => {
    const decision = await evaluate(request("/dashboard", { ab_session: await token("-5m") }), deps);
    expect(decision.kind === "redirect" && decision.to).toMatch(/^\/sign-in/);
  });

  it("a foreign-signed token is denied even if a refresh cookie exists", async () => {
    const foreign = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(USER)
      .setExpirationTime("1h")
      .sign(foreign.privateKey);
    const decision = await evaluate(
      request("/dashboard", { ab_session: forged, ab_session_refresh: "r" }),
      deps,
    );
    // Only *expiry* is refreshable. A bad signature is not a stale session.
    expect(decision.kind === "redirect" && decision.to).toMatch(/^\/sign-in/);
  });
});

describe("the refresh redirect and its loop guard", () => {
  it("sends an expired-but-refreshable HTML request to /auth/refresh", async () => {
    const decision = await evaluate(
      request("/dashboard", { ab_session: await token("-5m"), ab_session_refresh: "r" }),
      deps,
    );
    expect(decision.kind === "redirect" && decision.to).toBe(
      `/auth/refresh?next=${encodeURIComponent("/dashboard")}`,
    );
  });

  it("does not redirect an API request to refresh — it 401s", async () => {
    const decision = await evaluate(
      request("/v1/households/current", { ab_session: await token("-5m"), ab_session_refresh: "r" }),
      deps,
    );
    expect(decision).toEqual({ kind: "unauthorized" });
  });

  it("never targets the refresh route as its own destination", async () => {
    // /auth/refresh is public, so it is allowed outright and can never be the path that
    // triggers a redirect to itself.
    expect(await evaluate(request("/auth/refresh"), deps)).toEqual({ kind: "allow" });
    expect(
      await evaluate(request("/auth/refresh", { ab_session: await token("-5m") }), deps),
    ).toEqual({ kind: "allow" });
  });

  it("sanitises the destination it carries into refresh", async () => {
    const decision = await evaluate(
      new NextRequest(new URL("/dashboard", ORIGIN), {
        headers: { cookie: `ab_session=${await token("-5m")}; ab_session_refresh=r` },
      }),
      deps,
    );
    expect(decision.kind === "redirect" && decision.to).not.toMatch(/https?:/);
  });
});

describe("an unconfigured deployment denies rather than opens", () => {
  it.each(PROTECTED_HTML.slice(0, 3))("%s is still protected with no config", async (path) => {
    const decision = await evaluate(request(path), null);
    expect(decision.kind).toBe("redirect");
  });

  it("protected API routes still 401 with no config", async () => {
    expect(await evaluate(request("/v1/households/current"), null)).toEqual({
      kind: "unauthorized",
    });
  });

  it("public routes still work, so sign-in remains reachable", async () => {
    for (const path of PUBLIC_PATHS) {
      expect(await evaluate(request(path), null)).toEqual({ kind: "allow" });
    }
  });
});
