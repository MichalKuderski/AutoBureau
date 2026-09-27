import Stripe from "stripe";
import { createHostedTestBillingDatabase } from "@autobureau/db";
import { billingRuntimeConfigFromEnv } from "./config.js";
import { createBillingRuntime, type BillingRuntime } from "./runtime.js";
import { createStripeTestNoticeVerifier } from "./stripe-test-notice.js";
import { createStripeTestReadPort } from "./stripe-test-refetch.js";
import { createStripeTestWritePort } from "./stripe-test-provider.js";

/** The pinned API version every TEST event and request must carry. */
export const STRIPE_TEST_API_VERSION = "2026-02-25.clover";

/**
 * Hosted composition: every dependency comes from the gated environment, once per runtime
 * instance. The official SDK verifies webhook signatures over the exact raw bytes. Throws
 * `BillingRuntimeUnavailable` (naming nothing) when the environment does not qualify.
 */
export function createHostedBillingRuntime(env: Readonly<Record<string, string | undefined>> = process.env): BillingRuntime {
  const c = billingRuntimeConfigFromEnv(env);
  const db = createHostedTestBillingDatabase(c.databaseUrl, env);
  const verify = createStripeTestNoticeVerifier(
    (bytes, signature, secret, tolerance) => Stripe.webhooks.constructEvent(Buffer.from(bytes), signature, secret, tolerance),
    { signingSecret: c.webhookSecret, apiVersion: STRIPE_TEST_API_VERSION, mode: "test" },
  );
  return createBillingRuntime({
    db, verify, read: createStripeTestReadPort(c.stripeKey), write: createStripeTestWritePort(c.stripeKey),
    config: { accountId: c.accountId, appOrigin: c.appOrigin, internalSecret: c.internalSecret, cronSecret: c.cronSecret, catalog: c.catalog },
  });
}
