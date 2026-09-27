import {
  abandonStripeTestCheckout, beginStripeTestCheckout, completeStripeTestCheckout, readStripeTestCheckoutState,
  recordStripeTestCheckoutSession, StripeTestCheckoutRefused, type Database, type StripeTestCheckoutView, type StripeTestPlan,
} from "@autobureau/db";
import { householdRef, log } from "../observability";
import {
  BillingRuntimeRefused, callBillingRuntime, CheckoutResolveResponse, CheckoutSessionResponse, PortalResponse, ReconcileResponse,
  type BillingClientConfig,
} from "./runtime-client";

/**
 * The owner's hosted TEST checkout, orchestrated by the web runtime (ADR-020 hosted amendment).
 * Every database step runs as the owner under the existing owner guard; every provider step
 * runs in the billing runtime between those transactions. The browser's return from Stripe is
 * only a prompt to ask: the binding is created from a session the billing runtime re-read,
 * and Premium comes only from the reconciled state, never from this flow's outcome.
 */
export type CheckoutOutcome = { status: "none" | "pending" | "abandoned" | "bound"; reconciled: boolean };
/** A created intent younger than this may still be in flight in another request. */
export const CREATED_INTENT_GRACE_SECONDS = 120;

async function reconcileBound(db: Database, hh: string, client: BillingClientConfig, bindingId: string, checkoutId: string) {
  try {
    const r = await callBillingRuntime(client, "reconcile", { householdId: hh, bindingId, requestKey: checkoutId }, ReconcileResponse);
    return r.data.status === "settled";
  } catch { return false; }
}

/** Resolve the one unresolved checkout: bind it if the provider says it completed, expire it on request. */
async function resolveOpen(db: Database, hh: string, client: BillingClientConfig, open: StripeTestCheckoutView, expire: boolean, traceId: string): Promise<CheckoutOutcome> {
  if (open.state === "created") {
    // No session was recorded. Its URL never reached the owner, so nothing can have been paid.
    if (open.ageSeconds < CREATED_INTENT_GRACE_SECONDS) return { status: "pending", reconciled: false };
    await abandonStripeTestCheckout(db, hh, open.id);
    return { status: "abandoned", reconciled: false };
  }
  const { data: session } = await callBillingRuntime(client, "checkout-resolve", { householdId: hh, checkoutId: open.id, expire }, CheckoutResolveResponse);
  if (session.status !== "complete") {
    if (session.status === "open") return { status: "pending", reconciled: false };
    await abandonStripeTestCheckout(db, hh, open.id);
    return { status: "abandoned", reconciled: false };
  }
  let bindingId: string;
  try { ({ bindingId } = await completeStripeTestCheckout(db, hh, open.id, session.subscriptionId)); }
  catch (e) {
    if (e instanceof StripeTestCheckoutRefused && e.reason === "subscribed") {
      // A second completed session for a household that is already bound: never rebound.
      log({ event: "billing.duplicate_checkout", level: "error", traceId, household: householdRef(hh) });
      await abandonStripeTestCheckout(db, hh, open.id);
      return { status: "abandoned", reconciled: false };
    }
    throw e;
  }
  return { status: "bound", reconciled: await reconcileBound(db, hh, client, bindingId, open.id) };
}

/** Owner return (or "check status"): resolve the open checkout, or finish a bound one's first reconcile. */
export async function confirmCheckout(db: Database, hh: string, client: BillingClientConfig, cancel: boolean, traceId: string): Promise<CheckoutOutcome> {
  const s = await readStripeTestCheckoutState(db, hh);
  if (s.open) return resolveOpen(db, hh, client, s.open, cancel, traceId);
  if (s.bindingId && !s.reconciled && s.boundCheckoutId) return { status: "bound", reconciled: await reconcileBound(db, hh, client, s.bindingId, s.boundCheckoutId) };
  return { status: s.bindingId ? "bound" : "none", reconciled: s.reconciled };
}

/** Start: settle any earlier checkout first, so one household never holds two open sessions. */
export async function startCheckout(db: Database, hh: string, client: BillingClientConfig, plan: StripeTestPlan, requestKey: string, traceId: string):
  Promise<{ url: string } | CheckoutOutcome> {
  const s = await readStripeTestCheckoutState(db, hh);
  if (s.bindingId) throw new StripeTestCheckoutRefused("subscribed");
  if (s.open) {
    const earlier = await resolveOpen(db, hh, client, s.open, true, traceId);
    if (earlier.status !== "abandoned") return earlier;
  }
  const intent = await beginStripeTestCheckout(db, hh, { accountId: client.accountId, plan, requestKey });
  if (intent.state !== "created") throw new StripeTestCheckoutRefused("busy");
  const r = await callBillingRuntime(client, "checkout-session", { householdId: hh, checkoutId: intent.id, plan }, CheckoutSessionResponse);
  await recordStripeTestCheckoutSession(db, hh, intent.id, { customerId: r.data.customerId, sessionId: r.data.sessionId });
  return { url: r.data.url };
}

export async function openPortal(db: Database, hh: string, client: BillingClientConfig): Promise<{ url: string }> {
  const s = await readStripeTestCheckoutState(db, hh);
  if (!s.bindingId) throw new BillingRuntimeRefused();
  return (await callBillingRuntime(client, "portal", { householdId: hh }, PortalResponse)).data;
}
