"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TextInput, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { useHousehold } from "@/providers/household-provider";
import { initialsOf } from "@/lib/format";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
];

/**
 * Household settings — members and the ingestion alias.
 *
 * The alias is the retention feature (H1/H7): it is presented prominently and with a
 * plain explanation of what happens to mail sent there, because the just-in-time
 * notice at the moment of enabling ingestion is a privacy commitment (doc 13 §3),
 * not fine print.
 */
export function HouseholdSettings() {
  const { household } = useHousehold();
  const { toast } = useToast();
  const [name, setName] = useState(household.name);
  const [timezone, setTimezone] = useState(household.timezone);
  const alias = `h-${household.id.slice(0, 6)}@in.autobureau.com`;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
          <CardDescription>
            Reminders are scheduled in this timezone, so a deadline never arrives a day late.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TextInput
            label="Household name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            label="Timezone"
            options={TIMEZONES}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <div>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                toast({ tone: "success", title: "Saved", description: "Household updated." })
              }
            >
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forwarding address</CardTitle>
          <CardDescription>
            Forward any bill, notice, or renewal here and we'll read it, file it, and watch the
            dates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5">
            <Icon.Documents className="size-4 shrink-0 text-ink-tertiary" />
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{alias}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(alias);
                toast({ tone: "success", title: "Copied", description: "Address copied." });
              }}
            >
              Copy
            </Button>
          </div>
          <Alert tone="info" title="What happens to mail sent here">
            Attachments are processed automatically. Mail from senders we don't recognise is held
            for you to accept first, so nobody can add things to your household but you.
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            Everyone whose paperwork you manage. They don't need their own account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-line">
            {household.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent"
                >
                  {initialsOf(m.displayName)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{m.displayName}</span>
                  <span className="block text-xs text-ink-tertiary capitalize">{m.kind}</span>
                </div>
              </li>
            ))}
          </ul>
          {/*
           * Blueprint P0-11. No onClick, no request, nothing. Onboarding's `addMember`
           * only edits a local draft before a household exists — there is no
           * add-member flow for a household that's already been created. Disabled
           * rather than removed.
           */}
          <Button variant="secondary" size="sm" className="mt-4" disabled>
            <Icon.Plus className="size-4" />
            Add someone
          </Button>
          <p className="mt-2 text-xs text-ink-tertiary">Not available yet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
