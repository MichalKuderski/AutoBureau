// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearedPendingCookie,
  createCodeVerifier,
  decodePending,
  deriveCodeChallenge,
  encodePending,
  pendingCookie,
  verifierCookieName,
} from "./pkce";
import type { AuthConfig } from "./config";

const config = { cookieName: "ab_session" } as AuthConfig;
const attributesOf = (cookie: string): string[] => cookie.split(";").slice(1).map((p) => p.trim());

describe("code verifier", () => {
  it("meets RFC 7636 §4.1 length and alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const verifier = createCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("is not predictable across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => createCodeVerifier()));
    expect(seen.size).toBe(200);
  });
});

describe("code challenge", () => {
  it("is the S256 digest, base64url, unpadded", async () => {
    // RFC 7636 appendix B's published vector.
    const challenge = await deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("does not echo the verifier", async () => {
    const verifier = createCodeVerifier();
    const challenge = await deriveCodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
    expect(challenge).not.toContain(verifier.slice(0, 16));
  });

  it("is deterministic for the same verifier and different otherwise", async () => {
    const v = createCodeVerifier();
    expect(await deriveCodeChallenge(v)).toBe(await deriveCodeChallenge(v));
    expect(await deriveCodeChallenge(v)).not.toBe(await deriveCodeChallenge(createCodeVerifier()));
  });
});

describe("the pending-authorization cookie", () => {
  const verifier = createCodeVerifier();
  const cookie = pendingCookie(config, { verifier, next: "/dashboard" });

  it("is HttpOnly, Secure and SameSite=Lax", () => {
    const attributes = attributesOf(cookie);
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("Secure");
    expect(attributes).toContain("SameSite=Lax");
  });

  it("is scoped to the one path that redeems it", () => {
    // Not Path=/. The browser attaches it to a single endpoint and never to a page load.
    expect(attributesOf(cookie)).toContain("Path=/auth/callback");
  });

  it("carries an explicit short expiry that covers the link's lifetime", () => {
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBe(900);
  });

  it("has its own name, distinct from the session cookies", () => {
    expect(verifierCookieName(config)).toBe("ab_session_pkce");
    expect(verifierCookieName(config)).not.toBe(config.cookieName);
  });

  it("is cleared with matching attributes and a zero lifetime", () => {
    const cleared = clearedPendingCookie(config);
    expect(cleared).toContain("Max-Age=0");
    expect(attributesOf(cleared)).toEqual(
      expect.arrayContaining(["HttpOnly", "Secure", "SameSite=Lax", "Path=/auth/callback"]),
    );
  });
});

describe("pending state encoding", () => {
  it("round-trips", () => {
    const state = { verifier: createCodeVerifier(), next: "/obligations/o-1" };
    expect(decodePending(encodePending(state))).toEqual(state);
  });

  it("rejects anything malformed rather than half-decoding it", () => {
    for (const raw of ["", "not-base64!!", btoa("null"), btoa("[]"), btoa('{"verifier":1}')]) {
      expect(decodePending(raw)).toBeNull();
    }
  });

  it("rejects a verifier outside the RFC length bounds", () => {
    expect(decodePending(encodePending({ verifier: "short", next: "/" }))).toBeNull();
    expect(decodePending(encodePending({ verifier: "x".repeat(129), next: "/" }))).toBeNull();
  });

  it("rejects a missing destination rather than defaulting silently here", () => {
    expect(decodePending(btoa(JSON.stringify({ verifier: createCodeVerifier() })))).toBeNull();
  });
});
