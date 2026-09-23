import { StripeTestPolicyError } from "./stripe-test-policy";

/** Adapter for Stripe's official SDK, not a replacement signature algorithm.
 * Bind stripe.webhooks.constructEvent with a separately pinned SDK/version.
 * Passing a JSON parser instead is NOT a verifier. No route imports this module yet.
 */
export type StripeConstructEvent = (payload: Uint8Array, signature: string, secret: string, tolerance: number) => unknown;
const RECONCILE = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed"]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Authenticated TEST events are reconciliation triggers, never Premium grants.
 * A durable inbox, server-owned customer/household binding, authenticated refetch,
 * idempotent state transition and outbox are required before this becomes a route.
 * Arrival order or a checkout success URL cannot establish paid entitlement.
 */
export function createStripeTestNoticeVerifier(constructEvent: StripeConstructEvent,
  config: { signingSecret: string; apiVersion: string; mode: "test" }) {
  if (config.mode !== "test" || !/^whsec_[A-Za-z0-9_+/=-]{16,256}$/.test(config.signingSecret)
    || !/^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(config.apiVersion)) throw new StripeTestPolicyError();
  const { signingSecret, apiVersion } = config;
  return (rawBody: Uint8Array, signature: string | null) => {
    try {
      if (!(rawBody instanceof Uint8Array) || rawBody.byteLength === 0 || rawBody.byteLength > 131_072
        || !signature || signature.length > 8192) throw new StripeTestPolicyError();
      // Snapshot the caller's mutable bytes before the SDK verifies them. Signature
      // verification sees exactly those bytes, before any parsing in this boundary.
      // Buffer.slice() is a shared view, so construct a Uint8Array copy explicitly.
      const event = constructEvent(new Uint8Array(rawBody), signature, signingSecret, 300);
      if (!record(event) || event.object !== "event" || event.livemode !== false
        || event.api_version !== apiVersion || typeof event.id !== "string" || !/^evt_[A-Za-z0-9]{1,240}$/.test(event.id)
        || typeof event.created !== "number" || !Number.isSafeInteger(event.created) || event.created < 0
        || typeof event.type !== "string" || !/^[a-z_.]{1,120}$/.test(event.type)
        || Object.prototype.hasOwnProperty.call(event, "account") || Object.prototype.hasOwnProperty.call(event, "context")) throw new StripeTestPolicyError();
      // No cardholder, customer, billing-address or arbitrary metadata is returned.
      if (!RECONCILE.has(event.type)) return Object.freeze({ kind: "ignored" as const, eventId: event.id });
      if (!record(event.data) || !record(event.data.object) || typeof event.data.object.id !== "string"
        || !/^[A-Za-z0-9_]{1,256}$/.test(event.data.object.id)) throw new StripeTestPolicyError();
      return Object.freeze({ kind: "reconcile" as const, eventId: event.id, eventType: event.type,
        objectId: event.data.object.id, created: event.created });
    } catch { throw new StripeTestPolicyError(); }
  };
}
