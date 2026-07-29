"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ObligationCard } from "@/components/patterns/obligation-card";
import { useHousehold } from "@/providers/household-provider";
import { useObligations } from "@/lib/domain/queries";
import { cn } from "@/lib/cn";
import type { ObligationView } from "@/lib/domain/types";

/**
 * Calendar.
 *
 * A month grid, not a scheduling app: the question it answers is "how loaded is
 * February", which a list cannot show and a chart over-abstracts. Density is encoded
 * by count *and* by the highest priority present, so a single critical deadline never
 * hides behind five routine ones.
 *
 * Built from local date arithmetic rather than a calendar library — the grid is
 * thirty lines of well-understood code, and pulling a dependency for it would trade
 * clarity for nothing (doc 01: dependencies earn their place).
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Monday-first offset for the 1st of the month. */
function leadingBlanks(monthStart: Date): number {
  return (monthStart.getDay() + 6) % 7;
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function isoDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function CalendarScreen() {
  const { household } = useHousehold();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const query = useObligations(household.id, {});
  const obligations = useMemo(() => query.data ?? [], [query.data]);

  const byDay = useMemo(() => {
    const map = new Map<string, ObligationView[]>();
    for (const o of obligations) {
      if (o.status === "done" || o.status === "dismissed") continue;
      const key = o.due_at.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [obligations]);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const blanks = leadingBlanks(cursor);
  const total = daysInMonth(cursor);
  const todayKey = isoDay(new Date());
  const selected = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  if (query.isError) {
    return (
      <>
        <PageHeader title="Calendar" />
        <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Every deadline your household is tracking, by month."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous month"
              onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            >
              <Icon.ChevronRight className="size-4 rotate-180" />
            </Button>
            <span className="min-w-40 text-center text-sm font-medium text-ink">{monthLabel}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next month"
              onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            >
              <Icon.ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {query.isPending ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div
            role="row"
            className="grid grid-cols-7 border-b border-line bg-surface-sunken"
          >
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                role="columnheader"
                className="px-2 py-2 text-center text-2xs font-medium tracking-wide text-ink-tertiary uppercase"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: blanks }).map((_, i) => (
              <div
                key={`blank-${i}`}
                aria-hidden="true"
                className="min-h-24 border-r border-b border-line bg-surface-sunken/40 last:border-r-0"
              />
            ))}

            {Array.from({ length: total }).map((_, i) => {
              const dayNum = i + 1;
              const date = new Date(cursor.getFullYear(), cursor.getMonth(), dayNum);
              const key = isoDay(date);
              const due = byDay.get(key) ?? [];
              const critical = due.some((o) => o.priority === 1);
              const isToday = key === todayKey;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => due.length > 0 && setSelectedDay(key)}
                  aria-label={`${dayNum} ${monthLabel}${
                    due.length ? `, ${due.length} due` : ", nothing due"
                  }`}
                  disabled={due.length === 0}
                  className={cn(
                    "min-h-24 border-r border-b border-line p-1.5 text-left transition-colors last:border-r-0",
                    due.length > 0
                      ? "cursor-pointer hover:bg-surface-sunken"
                      : "cursor-default",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      isToday ? "bg-accent font-medium text-accent-ink" : "text-ink-secondary",
                    )}
                  >
                    {dayNum}
                  </span>
                  {due.length > 0 ? (
                    <span className="mt-1 flex flex-col gap-1">
                      {due.slice(0, 2).map((o) => (
                        <span
                          key={o.id}
                          className={cn(
                            "truncate rounded px-1 py-0.5 text-2xs",
                            o.priority === 1
                              ? "bg-critical-soft text-critical"
                              : "bg-surface-sunken text-ink-secondary",
                          )}
                        >
                          {o.title}
                        </span>
                      ))}
                      {due.length > 2 ? (
                        <span className="px-1 text-2xs text-ink-tertiary">
                          +{due.length - 2} more
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {critical ? <span className="sr-only">Includes a critical deadline</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!query.isPending && byDay.size === 0 ? (
        <EmptyState
          className="mt-6"
          tone="reassuring"
          icon={<Icon.Calendar className="size-5" />}
          title="Nothing on the calendar"
          description="When we find a deadline in your documents, it lands here automatically."
        />
      ) : null}

      <Modal
        variant="drawer"
        open={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        title={
          selectedDay
            ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : ""
        }
        description={`${selected.length} ${selected.length === 1 ? "deadline" : "deadlines"}`}
      >
        <div className="flex flex-col gap-3">
          {selected.map((o) => (
            <ObligationCard key={o.id} obligation={o} />
          ))}
        </div>
      </Modal>
    </>
  );
}
