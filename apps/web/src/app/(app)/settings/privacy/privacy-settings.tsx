"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { DeletionCard } from "./deletion-card";
import { ExportCard } from "./export-card";

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
 * "are encrypted" and that Pellum's own systems "cannot decrypt them" — present
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
          <CardTitle as="h2">What we can and can't see</CardTitle>
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

      <ExportCard />

      <DeletionCard />
    </div>
  );
}
