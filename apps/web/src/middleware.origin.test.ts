// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Redirects resolve against the deployment's CONFIGURED origin, never the request's Host.
 * A fresh module instance per file: the middleware caches its auth configuration.
 */
const CONFIGURED = "https://app.example.test";
const saved = { ...process.env };
let middleware: typeof import("./middleware").middleware;
beforeAll(async () => {
  Object.assign(process.env, { APP_ORIGIN: CONFIGURED, AUTH_ISSUER: "https://auth.example.test/v1", AUTH_AUDIENCE: "authenticated",
    AUTH_JWKS_URL: "https://auth.example.test/v1/jwks", AUTH_API_URL: "https://auth.example.test/v1", AUTH_ANON_KEY: "unused-test-key", AUTH_COOKIE_NAME: "ab_session" });
  vi.resetModules();
  ({ middleware } = await import("./middleware"));
});
afterAll(() => { process.env = saved; });

describe("signed-out redirects use the configured origin", () => {
  it.each(["http://evil.example.test", "http://localhost:4318", "http://127.0.0.1:4318"])("a request arriving as %s is sent to the configured origin", async (arrived) => {
    const response = await middleware(new NextRequest(new URL("/dashboard", arrived), { headers: { host: new URL(arrived).host } }));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(CONFIGURED);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });
});
