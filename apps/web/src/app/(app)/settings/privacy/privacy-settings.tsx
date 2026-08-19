"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";

/**
 * Privacy & data — export and deletion as product surface, not compliance fine print.
 *
 * This screen is deliberately plain-spoken. It states what we can and cannot see, and
 * — because a vague promise from a company holding your passport is worth nothing, and
 * a false one is worse — it does not pretend export or deletion work before they do
 * (blueprint P0-04). Neither has a backend yet: both controls are shown disabled with a
 * truthful "not available yet" explanation rather than a simulated success state.
 * Honesty here is the differentiator against an ad-funded incumbent
 * (FOUNDING_PRINCIPLES §11, doc 13 §4).
 *
 * Blueprint P0-10. The identity-number bullet used to say passport and account numbers
 * "are encrypted" and that AutoBureau's own systems "cannot decrypt them" — present
 * tense, on a page whose entire premise is candor. ADR-007 is the real design (KMS
 * envelope encryption, decrypt capability confined to one audited module) but its own
 * status line reads "Accepted; not yet implemented" — nothing in this repository writes
 * to `item_secrets`, and no reveal/decrypt code path exists anywhere. The bullet now
 * states the commitment without claiming it is already load-bearing.
 */
export function PrivacySettings() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>What we can and can't see</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              {
                can: true,
                text: "Documents you send us, so we can find dates, amounts, and who they belong to.",
              },
              {
                can: true,
                text: "The registry we build from them — your policies, renewals, and deadlines.",
              },
              {
                can: false,
                text: "Full identity numbers. The plan is to encrypt passport and account numbers so even our own systems that read documents can't decrypt them — that protection isn't built yet.",
              },
              {
                can: false,
                text: "Your email inbox, unless you connect it — and then only to look for documents.",
              },
              {
                can: false,
                text: "Anything sold, shared, or used to train anyone else's models. Ever.",
              },
            ].map((row) => (
              <li key={row.text} className="flex items-start gap-2.5">
                {row.can ? (
                  <Icon.Check className="mt-0.5 size-4 shrink-0 text-ink-tertiary" />
                ) : (
                  <Icon.Shield className="mt-0.5 size-4 shrink-0 text-success" />
                )}
                <span className="text-ink-secondary text-pretty">{row.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export everything</CardTitle>
          <CardDescription>
            Your original documents plus every record we've built from them, in open formats.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div>
            {/*
             * Blueprint P0-04. This used to fire a toast claiming "Export started —
             * We'll email you a download link" on click, with no export job, no email,
             * and no file behind it. No export backend exists yet, so the control is
             * disabled rather than pretending otherwise.
             */}
            <Button variant="secondary" disabled>
              <Icon.Upload className="size-4 rotate-180" />
              Request export
            </Button>
          </div>
          <p className="text-xs text-ink-tertiary">Not available yet.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete your account</CardTitle>
          <CardDescription>
            Everything goes: documents, registry, reminders, and history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/*
           * Blueprint P0-04. The alert used to describe a 14-day grace period and a
           * 35-day backup expiry as though that policy were already enforced, and
           * confirming used to toast "Deletion scheduled — we've emailed you the
           * details." None of it was real: no deletion cascade, no scheduling, no
           * email. The button is disabled and the confirm dialog is gone — there is
           * nothing yet for a confirmation to gate.
           */}
          <Alert tone="warning" title="Not available yet">
            Account deletion isn't implemented yet. The button below does nothing — no
            request is sent, and nothing is scheduled.
          </Alert>
          <div>
            <Button variant="danger" disabled>
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
