import { describe, expect, it } from "vitest";
import { billingRuntimeConfigFromEnv, BillingRuntimeUnavailable } from "./config.js";
import { createHostedTestBillingDatabase } from "@autobureau/db";

// Synthetic shapes only; none of these is a credential. Key shapes are assembled at run time so the
// source never carries a key-shaped literal (secret scanning).
const keyShape = (prefix: string, mode: string) => [prefix, mode, "SyntheticShapeOnly0001"].join("_");
const hosted = {
  VERCEL: "1", NODE_ENV: "production", BILLING_RUNTIME: "stripe-test",
  STRIPE_TEST_SECRET_KEY: keyShape("rk", "test"), STRIPE_TEST_WEBHOOK_SECRET: "whsec_SyntheticShapeOnly0001",
  STRIPE_TEST_ACCOUNT_ID: "acct_Synthetic", STRIPE_TEST_PRODUCT_ID: "prod_Pellum", STRIPE_TEST_PRICE_MONTHLY: "price_Monthly", STRIPE_TEST_PRICE_ANNUAL: "price_Annual",
  APP_ORIGIN: "https://autobureau-staging.vercel.app", BILLING_INTERNAL_SECRET: "s".repeat(43), CRON_SECRET: "c".repeat(40),
  BILLING_TEST_DATABASE_URL: "postgresql://app_billing_test.abcdefghijklmnopqrst:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true",
};

describe("hosted billing runtime gate", () => {
  it("accepts only a complete hosted TEST configuration and derives the two-price catalog", () => {
    const c = billingRuntimeConfigFromEnv(hosted);
    expect(c).toMatchObject({ accountId: "acct_Synthetic", appOrigin: "https://autobureau-staging.vercel.app", cronSecret: "c".repeat(40) });
    expect(c.catalog).toEqual([{ plan: "monthly", priceId: "price_Monthly", productId: "prod_Pellum" }, { plan: "annual", priceId: "price_Annual", productId: "prod_Pellum" }]);
    expect(billingRuntimeConfigFromEnv({ ...hosted, CRON_SECRET: undefined }).cronSecret).toBeNull();
  });
  it.each([
    ["kill switch", { BILLING_TEST_DISABLED: "1" }], ["not marked billing", { BILLING_RUNTIME: undefined }], ["not Vercel", { VERCEL: undefined }],
    ["not a production build", { NODE_ENV: "test" }], ["a LIVE secret key", { STRIPE_TEST_SECRET_KEY: keyShape("sk", "live") }],
    ["a publishable key", { STRIPE_TEST_SECRET_KEY: keyShape("pk", "test") }], ["no webhook secret", { STRIPE_TEST_WEBHOOK_SECRET: "" }],
    ["one price for both plans", { STRIPE_TEST_PRICE_ANNUAL: "price_Monthly" }], ["an http origin", { APP_ORIGIN: "http://autobureau-staging.vercel.app" }],
    ["an origin with a path", { APP_ORIGIN: "https://autobureau-staging.vercel.app/x" }], ["a weak internal secret", { BILLING_INTERNAL_SECRET: "short" }],
    ["a weak cron secret", { CRON_SECRET: "short" }], ["no billing database", { BILLING_TEST_DATABASE_URL: undefined }],
    ["the web app_user database beside it", { DATABASE_URL: "postgresql://app_user:x@db.example/postgres" }],
    ["web auth configuration beside it", { AUTH_API_URL: "https://x.supabase.co/auth/v1" }], ["web JWKS beside it", { AUTH_JWKS_URL: "https://x/jwks" }],
  ])("refuses %s, naming nothing", (_, change) => {
    const env = { ...hosted, ...change } as Record<string, string | undefined>;
    expect(() => billingRuntimeConfigFromEnv(env)).toThrow(BillingRuntimeUnavailable);
    try { billingRuntimeConfigFromEnv(env); } catch (e) { expect(String((e as Error).message)).toBe("TEST billing runtime unavailable"); }
  });
});

describe("hosted billing database connection", () => {
  it("accepts the dedicated role (pooler-suffixed or not) on a hosted billing build only", () => {
    expect(() => createHostedTestBillingDatabase(hosted.BILLING_TEST_DATABASE_URL, hosted)).not.toThrow();
    expect(() => createHostedTestBillingDatabase("postgresql://app_billing_test:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", hosted)).not.toThrow();
  });
  it.each([
    ["app_user", "postgresql://app_user:pw@db.example.test:5432/postgres"], ["postgres", "postgresql://postgres:pw@db.example.test:5432/postgres"],
    ["no password", "postgresql://app_billing_test@db.example.test:5432/postgres"], ["loopback", "postgresql://app_billing_test:pw@127.0.0.1:5432/postgres"],
    ["another database", "postgresql://app_billing_test:pw@db.example.test:5432/other"], ["a lookalike role", "postgresql://app_billing_test_x:pw@db.example.test:5432/postgres"],
    ["not a URL", "app_billing_test"],
  ])("refuses %s", (_, url) => expect(() => createHostedTestBillingDatabase(url, hosted)).toThrow("Hosted TEST billing unavailable"));
  it("refuses outside the hosted billing runtime", () => {
    for (const change of [{ VERCEL: undefined }, { NODE_ENV: "test" }, { BILLING_RUNTIME: undefined }])
      expect(() => createHostedTestBillingDatabase(hosted.BILLING_TEST_DATABASE_URL, { ...hosted, ...change })).toThrow();
  });
});
