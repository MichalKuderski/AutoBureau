"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { CollectionMore } from "@/components/patterns/collection-more";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useHousehold } from "@/providers/household-provider";
import { useNotifications, useMarkNotificationsRead } from "@/lib/domain/queries";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { dynamicHref } from "@/lib/routes";
import type { NotificationLens } from "@autobureau/contracts";

export function NotificationsScreen() {
  const { household } = useHousehold();
  const [lens, setLens] = useState<NotificationLens>("all");
  const query = useNotifications(household.id, lens);
  const mark = useMarkNotificationsRead(household.id);
  const rows = query.data;
  const unread = rows.filter((row) => row.read_at === null);
  if (query.isError) return <><PageHeader title="Notifications" /><ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} /></>;
  return <>
    <PageHeader title="Notifications" description="Saved notices for your account in this household."
      actions={unread.length ? <Button variant="secondary" size="sm" loading={mark.isPending} loadingLabel="Saving read state"
        onClick={() => mark.mutate(unread.slice(0, 100).map((row) => row.id))}>
        {unread.length > 100 ? "Mark next 100 read" : query.hasNextPage ? "Mark loaded read" : "Mark all read"}
      </Button> : undefined} />
    <div className="mb-5"><Alert tone="info" title="Reminder delivery is not active yet">Saved notices appear here when they are created. An entry here does not confirm email or push delivery.</Alert></div>
    {mark.isError && <div className="mb-5"><Alert tone="critical" title="Couldn’t save read state">{mark.error.message} Your unread notices are still available.</Alert></div>}
    <FilterBar label="Filter notifications" options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} value={lens} onChange={setLens} className="mb-5" />
    {query.isPending ? <SkeletonList count={5} /> : !rows.length ? <EmptyState tone="reassuring" icon={<Icon.Bell className="size-5" />}
      title={lens === "unread" ? "You're all caught up" : "Nothing yet"}
      description={lens === "unread" ? "No saved notices are unread." : "There are no saved notices for your account in this household."} /> : <ul className="flex flex-col gap-2">
      {rows.map((n) => {
        const read = n.read_at !== null;
        return <li key={n.id} className={cn("flex items-start gap-3 rounded-lg border bg-surface p-3.5", read ? "border-line" : "border-accent/30")}>
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", read ? "bg-surface-sunken text-ink-tertiary" : "bg-accent-soft text-accent")}>
            {n.kind === "security" ? <Icon.Shield className="size-4" /> : <Icon.Bell className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            {n.kind === "security" && <p className="mb-1 text-xs font-semibold text-accent">Security notice · always enabled</p>}
            {n.href ? <Link href={dynamicHref(n.href)} className="text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus">{n.title}</Link>
              : <p className="text-sm font-medium text-ink">{n.title}</p>}
            <p className="mt-0.5 text-sm text-ink-secondary text-pretty">{n.body}</p>
            <time dateTime={n.created_at} className="mt-1 block text-xs text-ink-tertiary">{formatDate(n.created_at, { timeZone: household.timezone, style: "medium" })}{" · "}{formatTime(n.created_at, { timeZone: household.timezone })}</time>
            {!read && <Button size="sm" variant="ghost" className="mt-2" disabled={mark.isPending} aria-label={`Mark ${n.title} read`} onClick={() => mark.mutate([n.id])}>Mark read</Button>}
          </div>
          {!read && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />}
        </li>;
      })}
    </ul>}
    <CollectionMore query={query} />
  </>;
}
