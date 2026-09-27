import { stripeTestId } from "@autobureau/contracts";
import { internalSecretOk } from "./internal-signature.js";
import type { BillingRuntimeConfig } from "./runtime.js";

type Env = Readonly<Record<string, string | undefined>>;
export class BillingRuntimeUnavailable extends Error {
  override name = "BillingRuntimeUnavailable";
  constructor() { super("TEST billing runtime unavailable"); }
}

/**
 * The hosted billing runtime's gate (ADR-020 hosted amendment). Only a hosted production
 * build explicitly marked `BILLING_RUNTIME=stripe-test`, with every TEST value in its exact
 * shape, qualifies. `BILLING_TEST_DISABLED=1` is the operator kill switch. The runtime also
 * refuses to start beside web-runtime authority (the app_user `DATABASE_URL` or auth
 * configuration), so the two credential sets cannot be co-located by a configuration slip.
 * Values are never logged or echoed; a refusal names nothing.
 */
export function billingRuntimeConfigFromEnv(env: Env): BillingRuntimeConfig & { stripeKey: string; webhookSecret: string; databaseUrl: string } {
  const refuse = (): never => { throw new BillingRuntimeUnavailable(); };
  if (env.BILLING_TEST_DISABLED === "1" || env.BILLING_RUNTIME !== "stripe-test" || env.VERCEL !== "1" || env.NODE_ENV !== "production") refuse();
  if (env.DATABASE_URL !== undefined || env.AUTH_API_URL !== undefined || env.AUTH_JWKS_URL !== undefined) refuse();
  const key = env.STRIPE_TEST_SECRET_KEY ?? "", hook = env.STRIPE_TEST_WEBHOOK_SECRET ?? "";
  if (!/^(sk|rk)_test_[A-Za-z0-9]{10,240}$/.test(key) || !/^whsec_[A-Za-z0-9_+/=-]{16,256}$/.test(hook)) refuse();
  const accountId = env.STRIPE_TEST_ACCOUNT_ID, productId = env.STRIPE_TEST_PRODUCT_ID;
  const monthly = env.STRIPE_TEST_PRICE_MONTHLY, annual = env.STRIPE_TEST_PRICE_ANNUAL;
  if (!stripeTestId("acct").safeParse(accountId).success || !stripeTestId("prod").safeParse(productId).success
    || ![monthly, annual].every(p => stripeTestId("price").safeParse(p).success) || monthly === annual) refuse();
  let appOrigin: string;
  try {
    const u = new URL(env.APP_ORIGIN ?? "");
    if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password) refuse();
    appOrigin = u.origin;
  } catch { return refuse(); }
  if (!internalSecretOk(env.BILLING_INTERNAL_SECRET)) refuse();
  const cron = env.CRON_SECRET;
  if (cron !== undefined && !/^[A-Za-z0-9_-]{32,256}$/.test(cron)) refuse();
  if (!env.BILLING_TEST_DATABASE_URL) refuse();
  return {
    accountId: accountId!, appOrigin, internalSecret: env.BILLING_INTERNAL_SECRET!, cronSecret: cron ?? null,
    catalog: Object.freeze([{ plan: "monthly" as const, priceId: monthly!, productId: productId! }, { plan: "annual" as const, priceId: annual!, productId: productId! }]),
    stripeKey: key, webhookSecret: hook, databaseUrl: env.BILLING_TEST_DATABASE_URL!,
  };
}
