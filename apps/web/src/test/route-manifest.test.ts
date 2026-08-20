import { describe, expect, it } from "vitest";
import { appPageRoutes, matchesKnownRoute } from "./route-manifest";

/**
 * Blueprint P0-14, Test D.
 *
 * Proves the manifest reader itself is trustworthy before anything else relies on
 * it: it must find every route this repository actually ships, and it must not
 * invent one that isn't there. Everything else in P0-14's test suite calls
 * `matchesKnownRoute` against this same list rather than a second, hand-written one.
 */

describe("the route manifest reflects the real src/app tree", () => {
  const routes = appPageRoutes();

  it("includes every top-level page this repository currently ships", () => {
    for (const route of [
      "/",
      "/dashboard",
      "/obligations",
      "/obligations/[id]",
      "/documents",
      "/documents/upload",
      "/household",
      "/calendar",
      "/timeline",
      "/notifications",
      "/settings",
      "/settings/billing",
      "/settings/notifications",
      "/settings/privacy",
      "/settings/profile",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
    ]) {
      expect(routes).toContain(route);
    }
  });

  it("collapses route groups to no path segment, matching Next's own rule", () => {
    // `(app)/dashboard` and `(auth)/sign-in` must appear as `/dashboard` and
    // `/sign-in` — never carrying the parenthesised segment literally.
    expect(routes.some((r) => r.includes("("))).toBe(false);
  });

  it("does not contain the two routes P0-14 exists because of", () => {
    expect(routes).not.toContain("/documents/[id]");
    expect(routes).not.toContain("/household/[id]");
  });

  it("excludes API route handlers — a bare route.ts is not a page", () => {
    expect(routes.some((r) => r.startsWith("/v1"))).toBe(false);
    expect(routes.some((r) => r.startsWith("/auth/"))).toBe(false);
  });
});

describe("matchesKnownRoute matches a dynamic segment against the real manifest", () => {
  it("matches a live obligation id against /obligations/[id]", () => {
    expect(matchesKnownRoute("/obligations/o-4")).toBe(true);
    expect(matchesKnownRoute("/obligations/anything-at-all")).toBe(true);
  });

  it("matches a static route exactly", () => {
    expect(matchesKnownRoute("/documents/upload")).toBe(true);
    expect(matchesKnownRoute("/dashboard")).toBe(true);
  });

  it("ignores a query string when matching", () => {
    expect(matchesKnownRoute("/obligations/o-4?highlight=true")).toBe(true);
  });

  it("does not match a document or household detail path — the exact P0-14 defect", () => {
    expect(matchesKnownRoute("/documents/d-7")).toBe(false);
    expect(matchesKnownRoute("/household/i-2")).toBe(false);
  });

  it("does not match a path with the right prefix but the wrong shape", () => {
    expect(matchesKnownRoute("/obligations/o-4/extra")).toBe(false);
    expect(matchesKnownRoute("/obligation")).toBe(false);
  });
});
