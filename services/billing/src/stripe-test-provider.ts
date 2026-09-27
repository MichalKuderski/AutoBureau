import Stripe from "stripe";
import { z } from "zod";
import { stripeTestId, UUID_RE } from "@autobureau/contracts";
import { StripeTestPolicyError } from "./stripe-test-policy.js";

/**
 * The billing runtime's provider WRITE port (ADR-020 hosted amendment): TEST customers,
 * Checkout Sessions, portal sessions and the bounded subscription listing a scheduled
 * recheck walks. Same pins as the read port: TEST key only, fixed API version, no automatic
 * network retry, 10 s timeout, optional local HTTP-client seam and no environment fallback.
 * Every response is projected through an explicit schema; nothing else leaves this module.
 * Idempotency keys derive from the owner's intent UUID, so a retried request for the same
 * intent reuses the provider objects instead of creating a second customer or session.
 */
const objectId = (prefix: string) => z.union([stripeTestId(prefix), z.object({ id: stripeTestId(prefix) })]).transform(v => typeof v === "string" ? v : v.id);
const customer = z.object({ object: z.literal("customer"), id: stripeTestId("cus"), livemode: z.literal(false) });
const session = z.object({
  object: z.literal("checkout.session"), id: z.string().regex(/^cs_test_[A-Za-z0-9]{1,240}$/), livemode: z.literal(false),
  mode: z.literal("subscription"), customer: objectId("cus"), client_reference_id: z.string().regex(UUID_RE),
  status: z.enum(["open", "complete", "expired"]), payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  subscription: objectId("sub").nullable(), url: z.string().nullable(),
}).transform(v => ({ sessionId: v.id, customerId: v.customer, checkoutId: v.client_reference_id, status: v.status,
  paymentStatus: v.payment_status, subscriptionId: v.subscription, url: v.url }));
const portal = z.object({ object: z.literal("billing_portal.session"), livemode: z.literal(false), url: z.string() });
const subscriptions = z.object({ object: z.literal("list"), has_more: z.boolean(),
  data: z.array(z.object({ object: z.literal("subscription"), id: stripeTestId("sub"), livemode: z.literal(false) })).max(100) });
export type ProviderCheckoutSession = z.output<typeof session>;

const https = (raw: string | null, origin: string) => {
  if (!raw) throw new StripeTestPolicyError();
  const u = new URL(raw);
  if (u.origin !== origin || u.username || u.password) throw new StripeTestPolicyError();
  return u.toString();
};

export interface TestBillingWritePort {
  createCheckout(input: { checkoutId: string; priceId: string; successUrl: string; cancelUrl: string }): Promise<{ customerId: string; sessionId: string; url: string }>;
  retrieveSession(sessionId: string): Promise<ProviderCheckoutSession>;
  expireSession(sessionId: string): Promise<ProviderCheckoutSession>;
  createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  listSubscriptions(): Promise<{ subscriptionIds: string[]; truncated: boolean }>;
}

export function createStripeTestWritePort(key: string, httpClient?: Stripe.HttpClient): TestBillingWritePort {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new StripeTestPolicyError();
  const sdk = new Stripe(key, { apiVersion: "2026-02-25.clover" as Stripe.LatestApiVersion, maxNetworkRetries: 0, timeout: 10000, ...(httpClient ? { httpClient } : {}) });
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch { throw new StripeTestPolicyError(); } };
  return {
    createCheckout: input => guard(async () => {
      if (!UUID_RE.test(input.checkoutId) || !/^price_[A-Za-z0-9]{1,240}$/.test(input.priceId)) throw new StripeTestPolicyError();
      // No name, email, household or user identifier is sent: Checkout collects what it needs.
      const c = customer.parse(await sdk.customers.create({}, { idempotencyKey: `pellum-test-checkout-customer-${input.checkoutId}` }));
      const s = session.parse(await sdk.checkout.sessions.create({
        mode: "subscription", customer: c.id, client_reference_id: input.checkoutId,
        line_items: [{ price: input.priceId, quantity: 1 }], allow_promotion_codes: false,
        success_url: input.successUrl, cancel_url: input.cancelUrl, expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, { idempotencyKey: `pellum-test-checkout-session-${input.checkoutId}` }));
      if (s.customerId !== c.id || s.checkoutId !== input.checkoutId || s.status !== "open") throw new StripeTestPolicyError();
      return { customerId: c.id, sessionId: s.sessionId, url: https(s.url, "https://checkout.stripe.com") };
    }),
    retrieveSession: id => guard(async () => session.parse(await sdk.checkout.sessions.retrieve(id))),
    expireSession: id => guard(async () => session.parse(await sdk.checkout.sessions.expire(id))),
    createPortal: (customerId, returnUrl) => guard(async () => {
      const p = portal.parse(await sdk.billingPortal.sessions.create({ customer: stripeTestId("cus").parse(customerId), return_url: returnUrl }));
      return { url: https(p.url, "https://billing.stripe.com") };
    }),
    listSubscriptions: () => guard(async () => {
      const l = subscriptions.parse(await sdk.subscriptions.list({ status: "all", limit: 100 }));
      return { subscriptionIds: l.data.map(s => s.id), truncated: l.has_more };
    }),
  };
}
