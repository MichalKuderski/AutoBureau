"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { apiFetch } from "@/lib/api-client";
import { useHousehold } from "@/providers/household-provider";

export interface BillingStatus {
  tier: "free" | "premium";
  state: "none" | "active" | "canceling" | "grace" | "past_due" | "canceled" | "blocked";
  cadence: "monthly" | "annual" | null; paidThrough: string | null; premiumUntil: string | null;
  testMode: boolean; paymentUpdateAvailable: false; checkoutAvailable: false;
}
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : "";

/** Owner-only; non-owners get 403 and see nothing. Display only — never authorization. */
export function useBillingStatus() {
  const { household } = useHousehold();
  return useQuery({
    queryKey: ["household", household.id, "billing"], retry: false, enabled: household.role === "owner",
    queryFn: () => apiFetch<BillingStatus>(`/households/${household.id}/billing`, { householdId: household.id }),
  });
}

/**
 * What the database says about Premium, in plain words. Premium is only ever described as
 * on when the effective plan is Premium; a payment problem is never softened into "active".
 * Payment updates are not available in this build, and the copy says so instead of
 * offering a control that cannot work.
 */
export function describeBilling(b: BillingStatus): { tone: "info" | "warning" | "critical"; title: string; body: string } | null {
  switch (b.state) {
    case "active": return b.tier === "premium"
      ? { tone: "info", title: "Premium is on", body: `Your ${b.cadence ?? ""} plan is paid through ${day(b.paidThrough)}.`.replace("  ", " ") } : null;
    case "canceling": return { tone: "info", title: "Premium is ending", body: `Premium stays on until ${day(b.premiumUntil)}. You won't be charged again.` };
    case "grace": return { tone: "warning", title: "Payment problem",
      body: `Your last payment didn't go through. Premium stays on until ${day(b.premiumUntil)} while the payment is retried. After that, your household moves to Free — nothing is deleted.` };
    case "past_due": return { tone: "critical", title: "Premium is paused",
      body: "A payment failed and the grace period has ended, so your household is on Free. Your records are kept; documents above the Free limit wait until Premium is back." };
    case "canceled": return { tone: "info", title: "Premium has ended", body: "Your household is on Free. Your records are kept." };
    case "blocked": return { tone: "critical", title: "Billing needs attention", body: "We couldn't confirm your billing status, so Premium features are off until it's resolved. Your records are kept." };
    default: return null;
  }
}

/** App-wide notice for the two states an owner must act on. */
export function BillingBanner() {
  const status = useBillingStatus();
  if (!status.data || (status.data.state !== "grace" && status.data.state !== "past_due")) return null;
  const d = describeBilling(status.data)!;
  return (
    <Alert tone={d.tone} title={d.title} className="mb-5"
      action={<Link href="/settings/billing" className="text-sm font-medium underline underline-offset-2">Billing details</Link>}>
      {d.body}
    </Alert>
  );
}
