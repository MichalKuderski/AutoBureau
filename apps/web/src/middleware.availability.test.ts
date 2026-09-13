// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, resetMiddlewareCache } from "./middleware";

vi.mock("@/server/auth/config", () => ({ authConfigFromEnv: () => ({ cookieName: "ab_session", refreshCookieName: "ab_session_refresh" }) }));
vi.mock("@/server/auth/jwt", async (original) => {
  const actual = await original<typeof import("@/server/auth/jwt")>();
  return { ...actual, createJwtVerifier: () => ({ verify: async () => { throw new actual.VerificationUnavailableError(); } }) };
});
afterEach(() => { resetMiddlewareCache(); vi.restoreAllMocks(); });

describe("key-service outage responses", () => {
  it.each(["/dashboard", "/v1/households/current"])("returns a private 503 for %s, preserving both cookies", async (path) => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await middleware(new NextRequest(`https://staging.example.test${path}?private=query`, {
      headers: { cookie: "ab_session=private-access; ab_session_refresh=private-refresh" },
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = await response.text();
    const logs = JSON.stringify(logger.mock.calls);
    for (const secret of ["private-access", "private-refresh", "private=query"]) {
      expect(body).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
    if (path.startsWith("/v1")) expect(JSON.parse(body).status).toBe(503);
    else expect(body).toContain("You haven't been signed out");
  });
});
