// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const signUp = vi.fn(), verdict = vi.fn();
vi.mock("@/server/auth/config", () => ({ authConfigFromEnv: () => ({ issuer: "https://p.supabase.co/auth/v1", audience: "authenticated",
  jwks: { uri: "https://p.supabase.co/jwks" }, cookieName: "ab_session", refreshCookieName: "ab_session_refresh",
  apiUrl: "https://p.supabase.co/auth/v1", anonKey: "publishable", allowedOrigins: ["https://app.example.test"], algorithms: ["RS256"] }) }));
vi.mock("@/server/auth/provider", async (orig) => ({ ...(await orig<object>()), createGoTrueProvider: () => ({ signUp }) }));
vi.mock("@/server/db", () => ({ getDatabase: () => ({}) }));
vi.mock("@/server/http/rate-limit", async (orig) => ({ ...(await orig<object>()), enforceRateLimit: async () => null }));
vi.mock("@/server/auth/password-gate", async (orig) => ({ ...(await orig<object>()), passwordPolicyFor: () => verdict }));
const { POST } = await import("./route");

const request = (password: string) => new Request("https://app.example.test/v1/auth/sign-up", { method: "POST",
  headers: { "content-type": "application/json", origin: "https://app.example.test", "x-autobureau-request": "1" },
  body: JSON.stringify({ name: "Synthetic Owner", email: "acc-unit@example.com", password }) });
beforeEach(() => { signUp.mockReset(); verdict.mockReset(); signUp.mockResolvedValue({ kind: "confirmation-required" }); });

it.each([
  ["weak", 400, /longer, less predictable/],
  ["breached", 400, /known data breaches/],
  ["unavailable", 503, /couldn't check that password/],
] as const)("refuses a %s password before any provider call", async (v, status, detail) => {
  verdict.mockResolvedValue(v);
  const res = await POST(request("Violet-Harbor-Lantern-5521"));
  expect(res.status).toBe(status);
  expect(JSON.stringify(await res.json())).toMatch(detail);
  expect(signUp).not.toHaveBeenCalled();
  expect(verdict).toHaveBeenCalledWith("Violet-Harbor-Lantern-5521");
});
it("reaches the provider only with an allowed password", async () => {
  verdict.mockResolvedValue("allowed");
  const res = await POST(request("Violet-Harbor-Lantern-5521"));
  expect(res.status).toBe(202);
  expect(signUp).toHaveBeenCalledTimes(1);
});
