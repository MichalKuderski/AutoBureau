// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_DESTINATION, PUBLIC_PATHS, isPublicPath, safeDestination } from "./public-routes";

/**
 * ADR-009 A4, allowlist half. The list is pinned exactly: this test is what makes adding
 * a public path a deliberate act rather than a quiet one.
 */

describe("A4 · the public surface is exactly this and nothing more", () => {
  it("pins the allowlist", () => {
    // Changing this array without changing the reasoning in public-routes.ts means
    // widening the unauthenticated surface of the product. That should be hard.
    expect([...PUBLIC_PATHS].sort()).toEqual(
      [
        "/",
        "/auth/refresh",
        "/forgot-password",
        "/sign-in",
        "/sign-up",
        "/v1/auth/sign-in",
        "/v1/auth/sign-out",
      ].sort(),
    );
  });

  it.each([...PUBLIC_PATHS])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/obligations",
    "/obligations/o-1",
    "/onboarding",
    "/onboarding/census",
    "/settings/privacy",
    "/v1/households/current",
    "/v1/auth",
    "/some/route/invented/tomorrow",
  ])("%s is protected", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  it("does not admit paths beneath a public one", () => {
    // The reason the list holds no prefixes: `/auth/` would have made this public.
    expect(isPublicPath("/auth/refresh/../../dashboard")).toBe(false);
    expect(isPublicPath("/sign-in/secret")).toBe(false);
    expect(isPublicPath("/v1/auth/sign-in/extra")).toBe(false);
  });

  it("normalises a trailing slash rather than letting it bypass the match", () => {
    expect(isPublicPath("/sign-in/")).toBe(true);
    expect(isPublicPath("/dashboard/")).toBe(false);
  });
});

describe("safeDestination refuses open redirects", () => {
  it.each([
    ["absolute url", "https://evil.example/pwn"],
    ["protocol relative", "//evil.example"],
    ["backslash variant", "/\\evil.example"],
    ["embedded backslash", "/dashboard\\@evil.example"],
    ["scheme", "javascript:alert(1)"],
    ["no leading slash", "dashboard"],
    ["newline injection", "/dashboard\nSet-Cookie: x=1"],
    ["carriage return", "/dashboard\r\nLocation: https://evil.example"],
  ])("rejects %s", (_label, raw) => {
    expect(safeDestination(raw)).toBe(DEFAULT_DESTINATION);
  });

  it("refuses to send the refresh route back to itself", () => {
    // The other half of the loop guard: a successful refresh must not bounce here again.
    expect(safeDestination("/auth/refresh")).toBe(DEFAULT_DESTINATION);
    expect(safeDestination("/auth/refresh/")).toBe(DEFAULT_DESTINATION);
    expect(safeDestination("/auth/refresh?next=%2Fauth%2Frefresh")).toBe(DEFAULT_DESTINATION);
  });

  it("keeps a legitimate same-origin destination, query and all", () => {
    expect(safeDestination("/obligations/o-1")).toBe("/obligations/o-1");
    expect(safeDestination("/documents?status=needs_review")).toBe("/documents?status=needs_review");
  });

  it("falls back when absent", () => {
    expect(safeDestination(null)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination("")).toBe(DEFAULT_DESTINATION);
  });
});
