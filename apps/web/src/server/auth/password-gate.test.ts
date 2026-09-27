// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { BREACH_RANGE_ORIGIN, breachRangeOrigin, passwordPolicyFor } from "./password-gate";

afterEach(() => vi.unstubAllGlobals());
it.each([
  ["hosted runtime", { NODE_ENV: "production", VERCEL: "1" }, "https://project.supabase.co/auth/v1"],
  ["hosted runtime even with a loopback provider", { NODE_ENV: "production", VERCEL: "1" }, "http://127.0.0.1:4555"],
  ["production build on loopback", { NODE_ENV: "production", LOCAL_ACCOUNT_ROUTES: "synthetic-only" }, "http://127.0.0.1:4555"],
  ["development without the synthetic switch", { NODE_ENV: "development" }, "http://127.0.0.1:4555"],
  ["test run against a non-loopback provider", { NODE_ENV: "test" }, "http://localhost:4555"],
  ["AWS runtime", { NODE_ENV: "test", AWS_EXECUTION_ENV: "AWS_Lambda" }, "http://127.0.0.1:4555"],
  ["unparseable provider URL", { NODE_ENV: "test" }, "not a url"],
])("uses the public k-anonymity service: %s", (_l, env, api) => expect(breachRangeOrigin(env, api)).toBe(BREACH_RANGE_ORIGIN));
it.each([
  ["test run on a loopback fake provider", { NODE_ENV: "test" }],
  ["explicit synthetic local mount", { NODE_ENV: "development", LOCAL_ACCOUNT_ROUTES: "synthetic-only" }],
])("uses the loopback provider's range fixture: %s", (_l, env) => expect(breachRangeOrigin(env, "http://127.0.0.1:4555/auth/v1")).toBe("http://127.0.0.1:4555"));

it("sends only the 5-character prefix to the fixture and refuses on an unavailable fixture", async () => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => { seen.push(String(input)); return new Response("boom", { status: 500 }); });
  const verdict = await passwordPolicyFor({ NODE_ENV: "test" }, "http://127.0.0.1:4555")("Violet-Harbor-Lantern-5521");
  expect(verdict).toBe("unavailable");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatch(/^http:\/\/127\.0\.0\.1:4555\/range\/[A-F0-9]{5}$/);
});
it("refuses a password whose suffix is in the returned range (breached)", async () => {
  const { createHash } = await import("node:crypto");
  const pw = "Violet-Harbor-Lantern-5521", sha = createHash("sha1").update(pw).digest("hex").toUpperCase();
  vi.stubGlobal("fetch", async () => new Response(`${sha.slice(5)}:42\r\n${"0".repeat(35)}:0\r\n`, { status: 200 }));
  expect(await passwordPolicyFor({ NODE_ENV: "test" }, "http://127.0.0.1:4555")(pw)).toBe("breached");
});
it("refuses weak passwords before any lookup", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  for (const pw of ["short7", "password123", "aaaaaaaaaaaa", "x".repeat(129)]) expect(await passwordPolicyFor({ NODE_ENV: "test" }, "http://127.0.0.1:4555")(pw)).toBe("weak");
  expect(fetchSpy).not.toHaveBeenCalled();
});
