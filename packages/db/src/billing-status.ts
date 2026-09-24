import type { Database } from "./scoped.js";

export type BillingState = "none" | "active" | "canceling" | "grace" | "past_due" | "canceled" | "blocked";
export interface BillingStatus {
  tier: "free" | "premium"; state: BillingState; cadence: "monthly" | "annual" | null;
  paidThrough: string | null; premiumUntil: string | null;
  testMode: boolean; paymentUpdateAvailable: false; checkoutAvailable: false;
}
const iso = (epoch: bigint | null) => epoch === null ? null : new Date(Number(epoch) * 1000).toISOString();
/**
 * One household-scoped read of what the database actually grants (effective_plan) plus the
 * latest reconciled TEST billing state. Display only: it never authorizes a mutation, and
 * the UI must not show Premium unless `tier` says so. Checkout and payment updates are not
 * mounted, and this says so rather than implying a working payment path.
 */
export async function readBillingStatus(db: Database, hh: string): Promise<BillingStatus> {
  return db.withHousehold(hh, async tx => {
    const [r] = await tx.$queryRaw<Array<{ tier: string | null; test_enabled: boolean | null; state: string | null; plan: string | null; paid_through: bigint | null; premium_until: bigint | null }>>`
      SELECT p.tier, (SELECT a.test_enabled FROM local_plan_activation a LIMIT 1) AS test_enabled, s.state, s.plan, s.paid_through, s.premium_until
      FROM (SELECT 1) one LEFT JOIN effective_plan p ON p.household_id=${hh}::uuid
      LEFT JOIN LATERAL (SELECT state, plan, paid_through, premium_until FROM stripe_test_states WHERE household_id=${hh}::uuid ORDER BY revision DESC LIMIT 1) s ON true`;
    const state = (r?.state ?? "none") as BillingState;
    return {
      tier: r?.tier === "premium" ? "premium" : "free", state,
      cadence: r?.plan === "monthly" || r?.plan === "annual" ? r.plan : null,
      paidThrough: iso(r?.paid_through ?? null), premiumUntil: iso(r?.premium_until ?? null),
      testMode: Boolean(r?.test_enabled), paymentUpdateAvailable: false, checkoutAvailable: false,
    };
  });
}
