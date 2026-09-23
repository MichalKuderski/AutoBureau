"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { useHousehold } from "@/providers/household-provider";
import { cn } from "@/lib/cn";

/** PRD §21.2 provisional catalog copy. Billing changes remain disabled; no
 * checkout success page grants access. No usage meter until successful-processing
 * metering and pending-object retention are implemented and verified. */

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

export function BillingSettings() {
  const { household } = useHousehold();
  const plan = household.plan;

  return (
    <div className="flex flex-col gap-6">
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
                {!current ? (
                  <div>
                    {/*
                     * Blueprint P0-09. This button used to call `setPlan` and toast a
                     * success message for a change nothing recorded — no billing
                     * system exists to upgrade or downgrade into. Disabled rather than
                     * removed, so the plan comparison stays legible; the label keeps
                     * naming the action it would perform, matching the disabled-control
                     * treatment used elsewhere in settings (P0-03, P0-04).
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

      {plan === "premium" ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Cancel</CardTitle>
            {/*
             * Blueprint P0-09. This used to promise "you keep Premium until the end
             * of the period you've paid for" as though a billing period were being
             * tracked — nothing is. The confirm dialog behind it is gone along with
             * the state that only existed to open it, matching P0-04's treatment of
             * the same shape of problem: there is nothing yet for a confirmation to
             * gate.
             */}
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
