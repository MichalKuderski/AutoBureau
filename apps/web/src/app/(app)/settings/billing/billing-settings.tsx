"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * Plan and billing.
 *
 * Two product commitments are enforced in this file rather than merely stated:
 * cancellation is one click and does not route through a retention maze
 * (FOUNDING_PRINCIPLES §11), and usage against the free tier is shown honestly
 * *before* a cap is hit, because a silent stop is indistinguishable from a broken
 * product (PRD F14).
 */

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "",
    features: ["10 documents a month", "One person you care for", "Deadline reminders by email"],
  },
  {
    id: "premium",
    name: "Premium",
    price: "$12",
    cadence: "/month",
    features: [
      "Unlimited documents",
      "Everyone in your household",
      "Email, push, and calendar reminders",
      "Warranty and deposit tracking",
      "Priority document review",
    ],
  },
] as const;

export function BillingSettings() {
  const { toast } = useToast();
  const [plan, setPlan] = useState<"free" | "premium">("free");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const docsUsed = 7;
  const docsCap = 10;
  const pct = Math.round((docsUsed / docsCap) * 100);

  return (
    <div className="flex flex-col gap-6">
      {plan === "free" ? (
        <Card>
          <CardHeader>
            <CardTitle>This month's usage</CardTitle>
            <CardDescription>
              Your free plan covers {docsCap} documents a month.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-secondary">Documents processed</span>
              <span className="tabular-nums text-sm text-ink">
                {docsUsed} of {docsCap}
              </span>
            </div>
            <div
              role="meter"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${docsUsed} of ${docsCap} documents used`}
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  pct >= 80 ? "bg-warning" : "bg-accent",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            {pct >= 80 ? (
              <Alert tone="warning" title="You're close to this month's limit" className="mt-4">
                We'll keep watching every deadline you already have. New documents resume on the
                1st, or upgrade to keep going now.
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
                  <CardTitle>{p.name}</CardTitle>
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
                  <Button
                    variant={p.id === "premium" ? "primary" : "secondary"}
                    onClick={() => {
                      if (p.id === "premium") {
                        setPlan("premium");
                        toast({
                          tone: "success",
                          title: "You're on Premium",
                          description: "Unlimited documents, starting now.",
                        });
                      } else {
                        setConfirmCancel(true);
                      }
                    }}
                  >
                    {p.id === "premium" ? "Upgrade" : "Switch to Free"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {plan === "premium" ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancel</CardTitle>
            <CardDescription>
              One click. You keep Premium until the end of the period you've paid for, and your
              data stays exactly as it is.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              Cancel Premium
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel Premium?"
        description="You'll keep Premium until the end of your billing period. Nothing is deleted, and we'll keep tracking the deadlines you already have."
        confirmLabel="Cancel Premium"
        onConfirm={() => {
          setPlan("free");
          setConfirmCancel(false);
          toast({
            tone: "info",
            title: "Premium cancelled",
            description: "You'll keep access until the period ends.",
          });
        }}
      />
    </div>
  );
}
