"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { useHousehold } from "@/providers/household-provider";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/alert";
import { ApiError, apiFetch } from "@/lib/api-client";
import { describeBilling, useBillingStatus, type BillingStatus } from "@/components/patterns/billing-status";

/** PRD §21.2 provisional catalog copy. Checkout runs only in Stripe TEST mode through the
 * separate billing runtime; returning from checkout grants nothing by itself. Premium is
 * shown only when the effective plan (durable, reconciled state) says so. No usage meter
 * until successful-processing metering and pending-object retention are verified. */

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "",
    features: ["10 documents a month", "You plus one person you manage", "Deadline reminders by email"],
  },
  {
    id: "premium",
    name: "Premium",
    price: "$12",
    cadence: "/month",
    features: [
      "50 documents/month",
      "Everyone in your household",
      "Email, push, and calendar reminders",
      "Warranty and deposit tracking",
      "Priority document review",
    ],
  },
] as const;

type CheckoutOutcome = { status: "none" | "pending" | "abandoned" | "bound"; reconciled: boolean };
const DESTINATION = { checkout: "https://checkout.stripe.com", portal: "https://billing.stripe.com" } as const;

/** Leave only for the provider page the server named, and only on its exact origin. */
function leaveFor(url: string, origin: string) {
  const u = new URL(url);
  if (u.origin !== origin) throw new Error("Unexpected billing destination");
  window.location.assign(u.toString());
}
function outcomeText(o: CheckoutOutcome, cancel: boolean): string {
  switch (o.status) {
    case "bound": return o.reconciled
      ? "Your TEST subscription is confirmed. The status below comes from Stripe's records."
      : "Your TEST subscription is recorded. We're still confirming the payment with Stripe; check again in a minute.";
    case "pending": return cancel ? "The checkout is still open at Stripe. Try cancelling again in a moment."
      : "Stripe hasn't confirmed this checkout yet. If you finished paying, check again in a minute.";
    case "abandoned": return "The checkout was cancelled. Nothing was charged.";
    default: return "There's no checkout in progress.";
  }
}
function failure(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return "For your security, sign in again (and confirm your authenticator code if you use one), then try again.";
  if (e instanceof ApiError && (e.status === 409 || e.status === 503)) return e.problem.detail ?? "That didn't work. Nothing was charged — please try again.";
  return "That didn't work. Nothing was charged — please try again.";
}

function useBillingActions() {
  const { household } = useHousehold();
  const client = useQueryClient(), key = ["household", household.id, "billing"];
  const [message, setMessage] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const confirm = useMutation({
    mutationFn: (cancel: boolean) => apiFetch<CheckoutOutcome>(`/households/${household.id}/billing/confirm`, { method: "POST", householdId: household.id, body: { cancel } }),
    onSuccess: async (o, cancel) => { setMessage(outcomeText(o, cancel)); await refresh(); },
  });
  const checkout = useMutation({
    mutationFn: (plan: "monthly" | "annual") => apiFetch<{ url: string } | CheckoutOutcome>(`/households/${household.id}/billing/checkout`,
      { method: "POST", householdId: household.id, body: { plan, requestId: crypto.randomUUID() } }),
    onSuccess: async (r) => {
      if ("url" in r) { setMessage("Opening Stripe checkout (TEST mode)…"); leaveFor(r.url, DESTINATION.checkout); return; }
      setMessage(outcomeText(r, false)); await refresh();
    },
  });
  const portal = useMutation({
    mutationFn: () => apiFetch<{ url: string }>(`/households/${household.id}/billing/portal`, { method: "POST", householdId: household.id, body: {} }),
    onSuccess: (r) => { setMessage("Opening the Stripe billing portal (TEST mode)…"); leaveFor(r.url, DESTINATION.portal); },
  });
  // Returning from Stripe is a prompt to ask the server, never evidence of payment.
  const asked = useRef(false), ask = confirm.mutate;
  useEffect(() => {
    if (asked.current) return;
    const returned = new URLSearchParams(window.location.search).get("checkout");
    if (returned !== "return" && returned !== "cancelled") return;
    asked.current = true;
    window.history.replaceState(null, "", "/settings/billing");
    ask(returned === "cancelled");
  }, [ask]);
  const error = checkout.error ?? confirm.error ?? portal.error;
  const busy = checkout.isPending || confirm.isPending || portal.isPending;
  // While the server is being asked, say so; afterwards, say what it answered.
  const live = confirm.isPending ? (confirm.variables ? "Cancelling the checkout…" : "Confirming your checkout with Stripe (TEST mode)…") : message;
  return { checkout, confirm, portal, message: live, error, busy };
}
type Actions = ReturnType<typeof useBillingActions>;

/** Pending is aria-disabled, not disabled: a disabled control drops keyboard focus. */
function ActionButton({ busy, onAct, children, variant = "secondary" }: { busy: boolean; onAct: () => void; children: ReactNode; variant?: "primary" | "secondary" }) {
  return <Button variant={variant} aria-disabled={busy || undefined} className="aria-disabled:opacity-55 aria-disabled:cursor-progress"
    onClick={() => { if (!busy) onAct(); }}>{children}</Button>;
}

/** The owner's current billing state and the actions the server says are available. */
function BillingStatusCard({ b, actions }: { b: BillingStatus; actions: Actions }) {
  const d = describeBilling(b);
  const needsPayment = b.state === "grace" || b.state === "past_due" || b.state === "blocked";
  return (
    <section aria-label="Billing status" className="flex flex-col gap-3">
      {d ? <Alert tone={d.tone} title={d.title}>{d.body}</Alert> : <p className="text-sm text-ink-secondary">Your household is on Free.</p>}
      <p role="status" aria-live="polite" className="text-sm text-ink-secondary empty:hidden">{actions.message}</p>
      {actions.error ? <Alert tone="critical" title="That didn't work">{failure(actions.error)}</Alert> : null}
      {b.checkoutAvailable && b.checkoutOpen ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-secondary">A checkout was started and hasn&apos;t been confirmed yet.</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton busy={actions.busy} onAct={() => actions.confirm.mutate(false)}>Check checkout status</ActionButton>
            <ActionButton busy={actions.busy} onAct={() => actions.confirm.mutate(true)}>Cancel checkout</ActionButton>
          </div>
        </div>
      ) : null}
      {b.paymentUpdateAvailable ? (
        <div className="flex flex-col gap-1">
          <div><ActionButton busy={actions.busy} onAct={() => actions.portal.mutate()}>{needsPayment ? "Update payment method" : "Manage subscription"}</ActionButton></div>
          <p className="text-xs text-ink-tertiary">Change your plan, update payment or cancel in Stripe&apos;s billing portal. Changes show here once Stripe confirms them.</p>
        </div>
      ) : needsPayment ? (
        <div className="flex flex-col gap-1">
          <div><Button variant="secondary" size="sm" disabled aria-describedby="payment-update-unavailable">Update payment method</Button></div>
          <p id="payment-update-unavailable" className="text-xs text-ink-tertiary">Payment updates aren&apos;t available on this deployment. Nothing is charged here.</p>
        </div>
      ) : null}
      {b.checkoutAvailable || b.paymentUpdateAvailable || b.testMode
        ? <p className="text-xs text-ink-tertiary">Billing runs in Stripe TEST mode: no real payments are taken.</p> : null}
    </section>
  );
}

export function BillingSettings() {
  const { household } = useHousehold();
  const plan = household.plan;
  const status = useBillingStatus(), actions = useBillingActions();
  const b = household.role === "owner" && status.data ? status.data : null;
  const canCheckout = Boolean(b?.checkoutAvailable && !b.checkoutOpen), managed = Boolean(b?.paymentUpdateAvailable);

  return (
    <div className="flex flex-col gap-6">
      {b ? <BillingStatusCard b={b} actions={actions} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {PLANS.map((p) => {
          const current = plan === p.id;
          return (
            <Card
              key={p.id}
              className={cn(current && "border-accent ring-1 ring-accent/20")}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle as="h2">{p.name}</CardTitle>
                  {current ? <Chip tone="accent">Current</Chip> : null}
                </div>
                <p className="mt-1">
                  <span className="text-2xl text-ink">{p.price}</span>
                  <span className="text-sm text-ink-tertiary">{p.cadence}</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ul className="flex flex-col gap-2 text-sm text-ink-secondary">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Icon.Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                      {f}
                    </li>
                  ))}
                </ul>
                {!current && p.id === "premium" && canCheckout ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <ActionButton variant="primary" busy={actions.busy} onAct={() => actions.checkout.mutate("monthly")}>Upgrade — $12/month</ActionButton>
                      <ActionButton busy={actions.busy} onAct={() => actions.checkout.mutate("annual")}>Upgrade — $99/year</ActionButton>
                    </div>
                    <p className="text-xs text-ink-tertiary">You&apos;ll pay on Stripe&apos;s page (TEST mode). Premium starts once Stripe confirms the payment.</p>
                  </div>
                ) : !current && !managed ? (
                  <div>
                    {/*
                     * Blueprint P0-09. Without a mounted billing runtime there is nothing to
                     * upgrade or downgrade into; disabled rather than removed, so the plan
                     * comparison stays legible and the label names the action it would perform.
                     */}
                    <Button variant="secondary" disabled>
                      {p.id === "premium" ? "Upgrade" : "Switch to Free"}
                    </Button>
                    <p className="mt-2 text-xs text-ink-tertiary">Not available yet.</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {plan === "premium" && !managed ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Cancel</CardTitle>
            {/* Blueprint P0-09: nothing to cancel through here without the billing portal. */}
            <CardDescription>Not available yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" disabled>
              Cancel Premium
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
