// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendCookies, clearedSessionCookies, sessionCookies } from "./session";
import type { AuthConfig } from "./config";

/**
 * ADR-009 A3, cookie half — "session cookies are HttpOnly; Secure; SameSite=Lax".
 * The token-never-escapes half is asserted over HTTP in the integration suite.
 */

const config = {
  issuer: "https://auth.example.test/v1",
  audience: "autobureau",
  jwks: { keys: { keys: [] } },
  cookieName: "ab_session",
  refreshCookieName: "ab_session_refresh",
  apiUrl: "https://auth.example.test/v1",
  anonKey: "anon",
  allowedOrigins: ["https://app.autobureau.com"],
  algorithms: ["RS256"],
} as unknown as AuthConfig;

const tokens = { accessToken: "ACCESS.TOKEN.VALUE", refreshToken: "REFRESH.VALUE", expiresIn: 3600 };

const attributesOf = (cookie: string): string[] =>
  cookie.split(";").slice(1).map((p) => p.trim());

const maxAgeOf = (cookie: string): number => Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);

describe("A3 · session cookies carry every required attribute", () => {
  const cookies = sessionCookies(config, tokens);

  it("issues exactly one access and one refresh cookie", () => {
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^ab_session=/);
    expect(cookies[1]).toMatch(/^ab_session_refresh=/);
  });

  it.each([0, 1])("cookie %i is HttpOnly, Secure, SameSite=Lax and Path=/", (index) => {
    const attributes = attributesOf(cookies[index]!);
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("Secure");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Path=/");
  });

  it("outlives the access token with the refresh cookie", () => {
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookies[1]!)?.[1]);
    expect(maxAge).toBeGreaterThan(tokens.expiresIn);
  });

  it("gives both cookies the same session window", () => {
    expect(maxAgeOf(cookies[0]!)).toBe(maxAgeOf(cookies[1]!));
  });

  it("keeps the refresh cookie readable on every path", () => {
    // Narrower scoping would hide from middleware that a session is refreshable.
    expect(attributesOf(cookies[1]!)).toContain("Path=/");
  });
});

/**
 * The regression this block exists to prevent, stated as the invariant rather than as a
 * number: **the access cookie must outlive the token it carries.**
 *
 * Scoping it to `expires_in` made D3's refresh redirect unreachable. A browser deletes a
 * cookie the instant its `Max-Age` lapses, so middleware never saw the expired token it
 * needed in order to route through `/auth/refresh`; it saw nothing, denied, and sent the
 * user to `/sign-in` about an hour after every sign-in — breaking PRD §19 F1's "session
 * refresh invisible". `middleware.test.ts` covered the expired-token branch and still
 * passed throughout, because a unit test can hand middleware a cookie state that a real
 * browser will never produce. These assertions close that gap from the issuing end.
 */
describe("the access cookie outlives its token — the refresh path depends on it", () => {
  it("does not tie the access cookie to expires_in, whatever the provider reports", () => {
    for (const expiresIn of [60, 900, 3600, 7200]) {
      const [access] = sessionCookies(config, { ...tokens, expiresIn });
      expect(maxAgeOf(access!)).toBeGreaterThan(expiresIn);
    }
  });

  it("keeps the container alive long enough for a refresh to be attempted", () => {
    // The refresh cookie is what makes a session recoverable; an access cookie that
    // disappears first strands it, which is the half-session `clearedSessionCookies`
    // already refuses to create.
    const [access, refresh] = sessionCookies(config, tokens);
    expect(maxAgeOf(access!)).toBeGreaterThanOrEqual(maxAgeOf(refresh!));
  });
});

describe("clearing a session removes both cookies", () => {
  const cleared = clearedSessionCookies(config);

  it("expires both, not just the access cookie", () => {
    expect(cleared).toHaveLength(2);
    for (const cookie of cleared) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toMatch(/=;/);
    }
  });

  it("keeps the security attributes while clearing", () => {
    // A cleared cookie without matching attributes may not replace the original.
    for (const cookie of cleared) {
      expect(attributesOf(cookie)).toEqual(
        expect.arrayContaining(["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]),
      );
    }
  });

  it("leaves no half-session — the loop guard depends on this", () => {
    const names = cleared.map((c) => c.split("=")[0]);
    expect(names).toEqual([config.cookieName, config.refreshCookieName]);
  });
});

describe("appendCookies", () => {
  it("appends rather than replaces, so both survive", async () => {
    const response = appendCookies(new Response(null, { status: 204 }), sessionCookies(config, tokens));
    const header = response.headers.getSetCookie();
    expect(header).toHaveLength(2);
  });
});
