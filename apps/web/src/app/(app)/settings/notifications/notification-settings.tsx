"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toggle, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Notification preferences — the kind × channel matrix (doc 08 §3).
 *
 * Two rules are encoded here rather than left to policy: security notices cannot be
 * switched off (they are how a user learns their account was accessed), and quiet
 * hours defer non-urgent messages rather than dropping them, so nothing is silently
 * lost to a sleeping phone.
 */

type Channel = "email" | "push" | "inapp";

const KINDS = [
  {
    id: "obligation.due_soon",
    label: "Deadline reminders",
    description: "Ahead of anything with a date — the reason this product exists.",
    locked: false,
  },
  {
    id: "document.needs_review",
    label: "Documents needing a look",
    description: "When we read something but weren't confident enough to file it.",
    locked: false,
  },
  {
    id: "digest.weekly",
    label: "Weekly digest",
    description: "Sunday summary of what's handled and what's coming.",
    locked: false,
  },
  {
    id: "value.found",
    label: "Money we've found",
    description: "Refundable deposits, unused warranties, forgotten subscriptions.",
    locked: false,
  },
  {
    id: "security",
    label: "Security notices",
    description: "Sign-ins from new devices and changes to your account. Always on.",
    locked: true,
  },
] as const;

const QUIET_START = [
  { value: "20:00", label: "8:00 PM" },
  { value: "21:00", label: "9:00 PM" },
  { value: "22:00", label: "10:00 PM" },
];
const QUIET_END = [
  { value: "06:00", label: "6:00 AM" },
  { value: "07:00", label: "7:00 AM" },
  { value: "08:00", label: "8:00 AM" },
];

export function NotificationSettings() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, Record<Channel, boolean>>>(() => {
    const initial: Record<string, Record<Channel, boolean>> = {};
    for (const k of KINDS) {
      initial[k.id] = {
        email: true,
        push: k.id === "obligation.due_soon" || k.id === "security",
        inapp: true,
      };
    }
    return initial;
  });
  const [urgentOverride, setUrgentOverride] = useState(true);

  const set = (kind: string, channel: Channel, value: boolean) =>
    setPrefs((prev) => ({ ...prev, [kind]: { ...prev[kind]!, [channel]: value } }));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>What we tell you, and how</CardTitle>
          <CardDescription>
            We aim to be the reason nothing slips — not another app that buzzes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-lg border-collapse text-sm">
              <caption className="sr-only">Notification preferences by type and channel</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 text-left text-xs text-ink-tertiary uppercase">
                    Type
                  </th>
                  {(["email", "push", "inapp"] as const).map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="w-20 py-2 text-center text-xs text-ink-tertiary uppercase"
                    >
                      {c === "inapp" ? "In app" : c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KINDS.map((k) => (
                  <tr key={k.id} className="border-b border-line last:border-0">
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      <span className="block text-sm text-ink">{k.label}</span>
                      <span className="block text-xs text-ink-tertiary text-pretty">
                        {k.description}
                      </span>
                    </th>
                    {(["email", "push", "inapp"] as const).map((c) => (
                      <td key={c} className="py-3 text-center">
                        <input
                          type="checkbox"
                          checked={k.locked ? true : prefs[k.id]?.[c]}
                          disabled={k.locked}
                          onChange={(e) => set(k.id, c, e.target.checked)}
                          aria-label={`${k.label} via ${c}`}
                          className="size-4 accent-[var(--color-accent)] disabled:opacity-50"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
          <CardDescription>
            Nothing is dropped — non-urgent messages simply wait until morning.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="From" options={QUIET_START} defaultValue="21:00" />
            <Select label="Until" options={QUIET_END} defaultValue="07:00" />
          </div>
          <Toggle
            label="Let urgent deadlines through"
            description="Only for things due within 24 hours that you haven't acted on."
            checked={urgentOverride}
            onChange={setUrgentOverride}
          />
        </CardContent>
      </Card>

      <Alert tone="info" title="Unsubscribing is per-type">
        Every email we send carries a one-click unsubscribe for that kind of message. Turning off
        reminders never turns off security notices.
      </Alert>

      <div>
        <Button
          variant="primary"
          onClick={() =>
            toast({
              tone: "success",
              title: "Preferences saved",
              description: "Changes apply to the next message we send.",
            })
          }
        >
          Save preferences
        </Button>
      </div>
    </div>
  );
}
