// @vitest-environment node
import { it, expect } from "vitest";
import { accountMountMode, accountSecurityAvailable, assertHostedAccountMount } from "./account-mount";

const hosted = { NODE_ENV: "production", VERCEL: "1", AUTH_ISSUER: "https://project.supabase.co/auth/v1", AUTH_AUDIENCE: "authenticated",
  AUTH_JWKS_URL: "https://project.supabase.co/auth/v1/.well-known/jwks.json", AUTH_API_URL: "https://project.supabase.co/auth/v1",
  AUTH_ANON_KEY: "publishable-synthetic", AUTH_COOKIE_NAME: "ab_session", APP_ORIGIN: "https://autobureau-staging.vercel.app" };
const local = { NODE_ENV: "development", LOCAL_ACCOUNT_ROUTES: "synthetic-only", AUTH_API_URL: "http://127.0.0.1:4555",
  AUTH_JWKS_URL: "http://127.0.0.1:4555/jwks", APP_ORIGIN: "https://127.0.0.1:4317", DATABASE_URL: "postgresql://app_user:synthetic@127.0.0.1:55540/pellum_fixture" };

it("selects the hosted provider-backed mount only on a complete HTTPS hosted runtime", () => {
  expect(() => assertHostedAccountMount(hosted)).not.toThrow();
  expect(accountMountMode(hosted)).toBe("hosted");
  expect(accountSecurityAvailable(hosted)).toBe(true);
});
it("keeps the synthetic loopback mount as its own, separately gated test seam", () => {
  expect(accountMountMode(local)).toBe("local-synthetic");
});
it.each([
  ["kill switch", { ACCOUNT_SECURITY_DISABLED: "1" }],
  ["not a hosted runtime", { VERCEL: undefined }],
  ["development build", { NODE_ENV: "development" }],
  ["test build", { NODE_ENV: "test" }],
  ["local synthetic switch present", { LOCAL_ACCOUNT_ROUTES: "synthetic-only" }],
  ["plain-http provider", { AUTH_API_URL: "http://project.supabase.co/auth/v1" }],
  ["plain-http issuer", { AUTH_ISSUER: "http://project.supabase.co/auth/v1" }],
  ["plain-http origin", { APP_ORIGIN: "http://autobureau-staging.vercel.app" }],
  ["query-bearing provider URL", { AUTH_API_URL: "https://project.supabase.co/auth/v1?x=1" }],
  ["missing publishable key", { AUTH_ANON_KEY: undefined }],
  ["missing origin", { APP_ORIGIN: undefined }],
])("refuses the hosted mount: %s", (_label, patch) => {
  const env = { ...hosted, ...patch };
  expect(() => assertHostedAccountMount(env)).toThrow();
  expect(accountMountMode(env)).toBe("unavailable");
  expect(accountSecurityAvailable(env)).toBe(false);
});
it("the kill switch also closes the local mount", () => {
  expect(accountMountMode({ ...local, ACCOUNT_SECURITY_DISABLED: "1" })).toBe("unavailable");
});
