// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, resetMiddlewareCache } from "./middleware";
import { DASHBOARD_RENDER_HEADER } from "./server/http/dashboard-render-marker";
vi.mock("@/server/auth/config", () => ({ authConfigFromEnv: () => ({ cookieName: "session", allowedOrigins: ["https://example.test"] }) }));
vi.mock("@/server/auth/jwt", async original => ({ ...await original<typeof import("./server/auth/jwt")>(), createJwtVerifier: () => ({ verify: async () => ({}) }) }));
afterEach(resetMiddlewareCache);
it.each([["/dashboard?secret=PRIVATE", "GET", "1"], ["/settings", "GET", null], ["/dashboard", "POST", null], ["/v1/dashboard", "GET", null]])("sets only a fixed dashboard GET marker and replaces forged input: %s %s", async (path, method, marker) => {
  const response = await middleware(new NextRequest(new URL(path!, "https://example.test"), { method: method!, headers: { cookie: "session=PRIVATE", [DASHBOARD_RENDER_HEADER]: "forged" } }));
  expect(response.headers.get(`x-middleware-request-${DASHBOARD_RENDER_HEADER}`)).toBe(marker);
});
