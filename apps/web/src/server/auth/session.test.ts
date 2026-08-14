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

  it("scopes the access cookie to the provider's stated lifetime", () => {
    expect(cookies[0]).toContain("Max-Age=3600");
  });

  it("outlives the access token with the refresh cookie", () => {
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookies[1]!)?.[1]);
    expect(maxAge).toBeGreaterThan(tokens.expiresIn);
  });

  it("keeps the refresh cookie readable on every path", () => {
    // Narrower scoping would hide from middleware that a session is refreshable.
    expect(attributesOf(cookies[1]!)).toContain("Path=/");
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
