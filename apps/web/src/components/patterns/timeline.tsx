"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { dynamicHref } from "@/lib/routes";
import { Icon } from "@/components/ui/icon";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import type { TimelineEntry } from "@/lib/domain/types";

/**
 * Household timeline — the ledger's history made legible.
 *
 * Rendered as an ordered list, because it *is* one: assistive tech announces
 * position and count, which is exactly the orientation a chronological view needs.
 * The connecting rail is decorative and hidden from the accessibility tree.
 *
 * Entries are grouped by day rather than shown as a flat stream; "what happened
 * Tuesday" is how people actually recall administrative events.
 */

const KIND: Record<
  TimelineEntry["kind"],
  { Glyph: typeof Icon.Check; ring: string; tint: string }
> = {
  document_added: { Glyph: Icon.Documents, ring: "border-line", tint: "text-ink-tertiary" },
  obligation_created: { Glyph: Icon.Obligations, ring: "border-info/40", tint: "text-info" },
  obligation_completed: { Glyph: Icon.Check, ring: "border-success/40", tint: "text-success" },
  item_added: { Glyph: Icon.Household, ring: "border-line", tint: "text-ink-tertiary" },
  item_expiring: { Glyph: Icon.Clock, ring: "border-warning/40", tint: "text-warning" },
  reminder_sent: { Glyph: Icon.Bell, ring: "border-line", tint: "text-ink-tertiary" },
  value_found: { Glyph: Icon.Sparkle, ring: "border-success/40", tint: "text-success" },
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export interface TimelineProps {
  entries: TimelineEntry[];
  timeZone?: string | undefined;
  className?: string | undefined;
}

export function Timeline({ entries, timeZone = "UTC", className }: TimelineProps) {
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const k = dayKey(e.at);
    const bucket = groups.get(k);
    if (bucket) bucket.push(e);
    else groups.set(k, [e]);
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {[...groups.entries()].map(([day, group]) => (
        <section key={day} aria-labelledby={`tl-${day}`}>
          <h3
            id={`tl-${day}`}
            className="mb-3 text-xs font-medium tracking-wide text-ink-tertiary uppercase"
          >
            {formatDate(day, { timeZone, style: "medium" })}
          </h3>
          <ol className="relative flex flex-col gap-3">
            <span
              aria-hidden="true"
              className="absolute top-2 bottom-2 left-[15px] w-px bg-line"
            />
            {group.map((entry) => {
              const { Glyph, ring, tint } = KIND[entry.kind];
              const inner = (
                <>
                  <span
                    className={cn(
                      "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-surface",
                      ring,
                    )}
                  >
                    <Glyph className={cn("size-3.5", tint)} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{entry.title}</span>
                    {entry.detail ? (
                      <span className="mt-0.5 block text-xs text-ink-secondary text-pretty">
                        {entry.detail}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-tertiary">
                      <time dateTime={entry.at}>
                        {formatTime(entry.at, { timeZone })}
                      </time>
                      {entry.member_name ? <span>· {entry.member_name}</span> : null}
                      {entry.amount_cents != null ? (
                        <span className="text-success">· {formatMoney({ amountCents: entry.amount_cents, currency: "USD" })}</span>
                      ) : null}
                    </span>
                  </span>
                </>
              );

              return (
                <li key={entry.id}>
                  {entry.href ? (
                    <Link
                      href={dynamicHref(entry.href)}
                      className="flex gap-3 rounded-md p-1 -m-1 transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex gap-3">{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
