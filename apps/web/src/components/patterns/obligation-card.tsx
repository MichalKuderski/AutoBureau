"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { Chip, OBLIGATION_LABEL, OBLIGATION_TONE } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { formatDueLabel, formatMoney } from "@/lib/format";
import { useHousehold } from "@/providers/household-provider";
import type { ObligationView } from "@/lib/domain/types";

/**
 * The product's core unit, rendered.
 *
 * Three decisions carry the design. Urgency is a left severity stripe plus a text
 * label, never color alone. Entitlements — money owed *to* the household — are framed
 * as value rather than a task, because "you're owed $1,800" is a different emotion
 * from "another thing to do". And provenance is always one tap away: every AI-derived
 * fact shows the document it came from (FOUNDING_PRINCIPLES §4.2).
 */

function severity(o: ObligationView): "critical" | "warning" | "neutral" {
  if (o.status === "missed") return "critical";
  if (o.status === "done" || o.status === "dismissed") return "neutral";
  if (o.days_until < 0) return "critical";
  if (o.priority === 1 && o.days_until <= 30) return "critical";
  if (o.days_until <= 7) return "warning";
  if (o.status === "action_needed") return "warning";
  return "neutral";
}

const STRIPE = {
  critical: "bg-critical",
  warning: "bg-warning",
  neutral: "bg-line-strong",
} as const;

export function ObligationCard({
  obligation,
  onComplete,
  compact,
}: {
  obligation: ObligationView;
  onComplete?: ((id: string) => void) | undefined;
  compact?: boolean | undefined;
}) {
  const { household, can } = useHousehold();
  const sev = severity(obligation);
  const isEntitlement = obligation.direction === "owed_to_household";
  const isClosed = obligation.status === "done" || obligation.status === "dismissed";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg border border-line bg-surface shadow-sm transition-shadow",
        "focus-within:shadow-md hover:shadow-md",
        isClosed && "opacity-70",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", STRIPE[sev])} />

      <div className={cn("pl-5 pr-4", compact ? "py-3.5" : "py-4")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={OBLIGATION_TONE[obligation.status] ?? "neutral"} dot size="sm">
                {OBLIGATION_LABEL[obligation.status] ?? obligation.status}
              </Chip>
              {isEntitlement ? (
                <Chip tone="success" size="sm" title="Money or value owed to your household">
                  You're owed
                </Chip>
              ) : null}
              {obligation.member_name ? (
                <span className="text-2xs text-ink-tertiary">{obligation.member_name}</span>
              ) : null}
            </div>

            <h3 className="text-base font-medium leading-snug text-ink">
              <Link
                href={`/obligations/${obligation.id}` as never}
                className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
              >
                {obligation.title}
              </Link>
            </h3>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5",
                  sev === "critical" && !isClosed && "font-medium text-critical",
                )}
              >
                <Icon.Clock className="size-3.5" />
                {formatDueLabel(obligation.due_at, household.timezone)}
              </span>
              {obligation.amount_cents != null && obligation.currency ? (
                <span className={cn(isEntitlement && "font-medium text-success")} data-tabular>
                  {isEntitlement ? "+" : ""}
                  {formatMoney(
                    { amountCents: obligation.amount_cents, currency: obligation.currency },
                    household.locale,
                  )}
                </span>
              ) : null}
              {obligation.item_name ? (
                <span className="truncate text-ink-tertiary">{obligation.item_name}</span>
              ) : null}
            </div>

            {obligation.provenance && !compact ? (
              <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-tertiary">
                <Icon.Documents className="size-3.5" />
                <span className="truncate">From {obligation.provenance.document_title}</span>
              </p>
            ) : null}
          </div>

          {onComplete && can("write") && !isClosed ? (
            <button
              type="button"
              onClick={() => onComplete(obligation.id)}
              aria-label={`Mark "${obligation.title}" as done`}
              className={cn(
                "relative z-10 shrink-0 rounded-md border border-line p-2 text-ink-tertiary transition-colors",
                "hover:border-success/40 hover:bg-success-soft hover:text-success",
              )}
            >
              <Icon.Check className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
