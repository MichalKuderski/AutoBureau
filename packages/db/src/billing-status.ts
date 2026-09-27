import type { Database } from "./scoped.js";

export type BillingState = "none" | "active" | "canceling" | "grace" | "past_due" | "canceled" | "blocked";
export interface BillingStatus {
  tier: "free" | "premium"; state: BillingState; cadence: "monthly" | "annual" | null;
  paidThrough: string | null; premiumUntil: string | null;
  testMode: boolean;
  /** A TEST subscription is bound to this household (the owner completed a verified checkout). */
  subscribed: boolean;
  /** An owner checkout was started and is not yet resolved (confirmed, expired or abandoned). */
  checkoutOpen: boolean;
  /** Set by the web route from whether the billing runtime is mounted; never by the database. */
  paymentUpdateAvailable: boolean; checkoutAvailable: boolean;
}
const iso = (epoch: bigint | null) => epoch === null ? null : new Date(Number(epoch) * 1000).toISOString();
/**
 * One household-scoped read of what the database actually grants (effective_plan) plus the
 * latest reconciled TEST billing state. Display only: it never authorizes a mutation, and
 * the UI must not show Premium unless `tier` says so. Availability of checkout and payment
 * updates is decided by the web route (billing runtime mounted), never inferred here.
 */
export async function readBillingStatus(db: Database, hh: string): Promise<BillingStatus> {
  return db.withHousehold(hh, async tx => {
    const [r] = await tx.$queryRaw<Array<{ tier: string | null; test_enabled: boolean | null; state: string | null; plan: string | null; paid_through: bigint | null; premium_until: bigint | null; subscribed: boolean; checkout_open: boolean }>>`
      SELECT p.tier, (SELECT a.test_enabled FROM local_plan_activation a LIMIT 1) AS test_enabled, s.state, s.plan, s.paid_through, s.premium_until,
        EXISTS(SELECT 1 FROM stripe_test_bindings b WHERE b.household_id=${hh}::uuid) AS subscribed,
        EXISTS(SELECT 1 FROM stripe_test_checkouts c WHERE c.household_id=${hh}::uuid AND c.state IN ('created','opened')) AS checkout_open
      FROM (SELECT 1) one LEFT JOIN effective_plan p ON p.household_id=${hh}::uuid
      LEFT JOIN LATERAL (SELECT state, plan, paid_through, premium_until FROM stripe_test_states WHERE household_id=${hh}::uuid ORDER BY revision DESC LIMIT 1) s ON true`;
    const state = (r?.state ?? "none") as BillingState;
    return {
      tier: r?.tier === "premium" ? "premium" : "free", state,
      cadence: r?.plan === "monthly" || r?.plan === "annual" ? r.plan : null,
      paidThrough: iso(r?.paid_through ?? null), premiumUntil: iso(r?.premium_until ?? null),
      testMode: Boolean(r?.test_enabled), subscribed: Boolean(r?.subscribed), checkoutOpen: Boolean(r?.checkout_open),
      paymentUpdateAvailable: false, checkoutAvailable: false,
    };
  });
}
