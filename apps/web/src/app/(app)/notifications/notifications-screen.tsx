"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { FilterBar, type FilterOption } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/providers/household-provider";
import { useNotifications } from "@/lib/domain/queries";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { dynamicHref } from "@/lib/routes";
import type { NotificationView } from "@/lib/domain/types";

const GLYPH: Record<string, typeof Icon.Bell> = {
  "obligation.due_soon": Icon.Clock,
  "document.needs_review": Icon.Documents,
  "digest.weekly": Icon.Sparkle,
  "value.found": Icon.Wallet,
};

/**
 * Notification feed.
 *
 * The in-app mirror of what we sent by email and push. It exists so a user can
 * always reconstruct "what did AutoBureau tell me, and when" — which matters both
 * for trust and for the moment someone says "I never got a warning about that".
 */
export function NotificationsScreen() {
  const { household } = useHousehold();
  const [lens, setLens] = useState<"all" | "unread">("all");
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const query = useNotifications(household.id);

  const all = useMemo(() => query.data ?? [], [query.data]);
  const isRead = useCallback(
    (n: NotificationView) => n.read_at !== null || readIds.has(n.id),
    [readIds],
  );

  const rows = useMemo(
    () => (lens === "unread" ? all.filter((n) => !isRead(n)) : all),
    [all, lens, isRead],
  );

  const unreadCount = all.filter((n) => !isRead(n)).length;

  const options: FilterOption<"all" | "unread">[] = [
    { value: "all", label: "All", count: all.length },
    { value: "unread", label: "Unread", count: unreadCount },
  ];

  if (query.isError) {
    return (
      <>
        <PageHeader title="Notifications" />
        <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything we've told you, in one place."
        actions={
          unreadCount > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReadIds(new Set(all.map((n) => n.id)))}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        label="Filter notifications"
        options={options}
        value={lens}
        onChange={setLens}
        className="mb-5"
      />

      {query.isPending ? (
        <SkeletonList count={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          tone="reassuring"
          icon={<Icon.Bell className="size-5" />}
          title={lens === "unread" ? "You're all caught up" : "Nothing yet"}
          description={
            lens === "unread"
              ? "No unread notifications. We'll be in touch before anything is due."
              : "When a deadline approaches or a document needs a look, it'll appear here — and in your inbox."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((n) => {
            const Glyph = GLYPH[n.kind] ?? Icon.Bell;
            const read = isRead(n);
            const body = (
              <>
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    read ? "bg-surface-sunken text-ink-tertiary" : "bg-accent-soft text-accent",
                  )}
                >
                  <Glyph className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn("block text-sm", read ? "text-ink-secondary" : "text-ink")}
                  >
                    {n.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-secondary text-pretty">
                    {n.body}
                  </span>
                  <time
                    dateTime={n.created_at}
                    className="mt-1 block text-xs text-ink-tertiary"
                  >
                    {formatDate(n.created_at, { timeZone: household.timezone, style: "medium" })}
                    {" · "}
                    {formatTime(n.created_at, { timeZone: household.timezone })}
                  </time>
                </span>
                {!read ? (
                  <span
                    aria-label="Unread"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                  />
                ) : null}
              </>
            );

            return (
              <li key={n.id}>
                {n.href ? (
                  <Link
                    href={dynamicHref(n.href)}
                    onClick={() => setReadIds((prev) => new Set(prev).add(n.id))}
                    className={cn(
                      "flex gap-3 rounded-lg border p-3.5 transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                      read
                        ? "border-line bg-surface hover:bg-surface-sunken"
                        : "border-accent/25 bg-surface hover:border-accent/40",
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    className={cn(
                      "flex gap-3 rounded-lg border p-3.5",
                      read ? "border-line bg-surface" : "border-accent/25 bg-surface",
                    )}
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
