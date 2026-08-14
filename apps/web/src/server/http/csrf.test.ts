// @vitest-environment node
//
// Not happy-dom: its `Request` strips `Origin`, because `Origin` is a forbidden header
// that page scripts may not set. That restriction is exactly *why* the origin check is
// worth making — but it also means a DOM `Request` cannot express the attack being
// tested here. The server sees whatever the network delivered, so the server runtime is
// the honest environment for these assertions.
import { describe, expect, it } from "vitest";
import { CSRF_HEADER, CSRF_HEADER_VALUE, CsrfError, assertSameSiteRequest, isSafeMethod } from "./csrf";

/**
 * ADR-009 A6 — "every unsafe method without the custom header → 403, DELETE included."
 *
 * The tests below are written as bypass attempts rather than as happy paths, because the
 * only interesting question about a CSRF check is what gets past it.
 */

const ORIGIN = "https://app.autobureau.com";
const options = { allowedOrigins: [ORIGIN] };

function request(
  method: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://app.autobureau.com/v1/obligations", { method, headers });
}

const UNSAFE = ["POST", "PUT", "PATCH", "DELETE"] as const;

describe("A6 · every unsafe method requires the header", () => {
  it.each(UNSAFE)("%s without the header is rejected", (method) => {
    expect(() => assertSameSiteRequest(request(method), options)).toThrowError(CsrfError);
    try {
      assertSameSiteRequest(request(method), options);
    } catch (e) {
      expect((e as CsrfError).reason).toBe("missing-header");
    }
  });

  it.each(UNSAFE)("%s with the header passes", (method) => {
    expect(() =>
      assertSameSiteRequest(request(method, { [CSRF_HEADER]: CSRF_HEADER_VALUE }), options),
    ).not.toThrow();
  });

  it("DELETE is not exempt — the case Idempotency-Key would have missed", () => {
    expect(() => assertSameSiteRequest(request("DELETE"), options)).toThrowError(CsrfError);
    expect(() =>
      assertSameSiteRequest(request("DELETE", { "idempotency-key": "abc" }), options),
    ).toThrowError(CsrfError);
  });
});

describe("safe methods carry no CSRF surface", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("%s passes without the header", (method) => {
    expect(() => assertSameSiteRequest(request(method), options)).not.toThrow();
  });

  it("classifies methods case-insensitively", () => {
    expect(isSafeMethod("get")).toBe(true);
    expect(isSafeMethod("Post")).toBe(false);
  });
});

describe("bypass attempts", () => {
  it("rejects an empty or whitespace-only header value", () => {
    for (const value of ["", "   ", "\t"]) {
      expect(() =>
        assertSameSiteRequest(request("POST", { [CSRF_HEADER]: value }), options),
      ).toThrowError(CsrfError);
    }
  });

  it("does not accept a semantic header in place of the CSRF one", () => {
    // The two headers D4 explicitly refused to overload.
    expect(() =>
      assertSameSiteRequest(
        request("POST", { "idempotency-key": "k", "x-household-id": "h" }),
        options,
      ),
    ).toThrowError(CsrfError);
  });

  it("rejects a cross-site origin even when the header is present", () => {
    try {
      assertSameSiteRequest(
        request("POST", { [CSRF_HEADER]: CSRF_HEADER_VALUE, origin: "https://evil.example" }),
        options,
      );
      throw new Error("should have rejected");
    } catch (e) {
      expect(e).toBeInstanceOf(CsrfError);
      expect((e as CsrfError).reason).toBe("foreign-origin");
    }
  });

  it("rejects a lookalike origin that merely starts with the real one", () => {
    expect(() =>
      assertSameSiteRequest(
        request("POST", {
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
          origin: "https://app.autobureau.com.evil.example",
        }),
        options,
      ),
    ).toThrowError(CsrfError);
  });

  it("accepts the deployment's own origin", () => {
    expect(() =>
      assertSameSiteRequest(
        request("POST", { [CSRF_HEADER]: CSRF_HEADER_VALUE, origin: ORIGIN }),
        options,
      ),
    ).not.toThrow();
  });

  it("still requires the header when Origin is absent or opaque", () => {
    // `Origin: null` is what a sandboxed iframe or some redirects produce; it must not
    // be treated as "same-site, nothing to check".
    expect(() => assertSameSiteRequest(request("POST", { origin: "null" }), options)).toThrowError(
      CsrfError,
    );
    expect(() => assertSameSiteRequest(request("POST"), options)).toThrowError(CsrfError);
  });
});
