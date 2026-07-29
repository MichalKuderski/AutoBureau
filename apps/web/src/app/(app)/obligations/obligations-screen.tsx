"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { ObligationCard } from "@/components/patterns/obligation-card";
import { FilterBar, SearchInput, type FilterOption } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { useHousehold } from "@/providers/household-provider";
import { useObligations, useUpdateObligationStatus } from "@/lib/domain/queries";
import { useToast } from "@/components/ui/toast";
import type { ObligationView } from "@/lib/domain/types";

type StatusFilter = "open" | "action_needed" | "owed_to_us" | "done" | "all";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "action_needed", label: "Needs action" },
  { value: "owed_to_us", label: "You're owed" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

/**
 * The obligations inbox.
 *
 * Grouped by time horizon rather than paginated: a caregiver's question is "what's
 * about to bite me", not "show me rows 20–40". Overdue and this-week are separated
 * because they demand different responses, and each group heading carries its own
 * count so the shape of the workload is readable without counting cards.
 */
export function ObligationsScreen() {
  const { household } = useHousehold();
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState<string | null>(null);

  const query = useObligations(household.id, { search });
  const updateStatus = useUpdateObligationStatus(household.id);
  const { toast } = useToast();

  const all = useMemo(() => query.data ?? [], [query.data]);

  const counts = useMemo(
    () => ({
      open: all.filter((o) => o.status !== "done" && o.status !== "dismissed").length,
      action_needed: all.filter((o) => o.status === "action_needed").length,
      owed_to_us: all.filter(
        (o) => o.direction === "owed_to_household" && o.status !== "done",
      ).length,
      done: all.filter((o) => o.status === "done").length,
      all: all.length,
    }),
    [all],
  );

  const filtered = useMemo(() => {
    let list = all;
    if (memberId) list = list.filter((o) => o.member_id === memberId);
    switch (filter) {
      case "open":
        return list.filter((o) => o.status !== "done" && o.status !== "dismissed");
      case "action_needed":
        return list.filter((o) => o.status === "action_needed");
      case "owed_to_us":
        return list.filter((o) => o.direction === "owed_to_household" && o.status !== "done");
      case "done":
        return list.filter((o) => o.status === "done");
      case "all":
        return list;
    }
  }, [all, filter, memberId]);

  const groups = useMemo(() => groupByHorizon(filtered), [filtered]);

  const complete = (o: ObligationView) => {
    updateStatus.mutate(
      { id: o.id, status: "done" },
      {
        onSuccess: () =>
          toast({
            title: "Marked as done",
            description: o.title,
            tone: "success",
            action: {
              label: "Undo",
              onClick: () => updateStatus.mutate({ id: o.id, status: "action_needed" }),
            },
          }),
      },
    );
  };

  const filterOptions: FilterOption<StatusFilter>[] = FILTERS.map((f) => ({
    ...f,
    count: counts[f.value],
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Obligations"
        description="Everything your household owes, and everything it's owed."
      />

      <div className="mb-5 flex flex-col gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by title, item, or person…"
        />
        <FilterBar
          label="Filter obligations"
          options={filterOptions}
          value={filter}
          onChange={setFilter}
        />
        {household.members.length > 1 ? (
          <FilterBar
            label="Filter by person"
            options={[
              { value: "", label: "Everyone" },
              ...household.members.map((m) => ({ value: m.id, label: m.displayName })),
            ]}
            value={memberId ?? ""}
            onChange={(v) => setMemberId(v || null)}
          />
        ) : null}
      </div>

      {query.isPending ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState {...describeError(query.error)} onRetry={() => query.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          tone={filter === "open" || filter === "action_needed" ? "reassuring" : "neutral"}
          icon={<Icon.Check className="size-5" />}
          title={emptyTitle(filter, search)}
          description={emptyDescription(filter, search)}
          {...(search ? { action: { label: "Clear search", onClick: () => setSearch("") } } : {})}
        />
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((group) => (
            <section key={group.label} aria-labelledby={`group-${group.key}`}>
              <div className="mb-2.5 flex items-baseline gap-2">
                <h2 id={`group-${group.key}`} className="text-lg">
                  {group.label}
                </h2>
                <span className="text-sm text-ink-tertiary" data-tabular>
                  {group.items.length}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {group.items.map((o) => (
                  <ObligationCard key={o.id} obligation={o} onComplete={() => complete(o)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface Group {
  key: string;
  label: string;
  items: ObligationView[];
}

/** Horizon buckets chosen to match how people actually plan: now, this week, this month, later. */
function groupByHorizon(items: ObligationView[]): Group[] {
  const buckets: Group[] = [
    { key: "overdue", label: "Overdue", items: [] },
    { key: "week", label: "This week", items: [] },
    { key: "month", label: "This month", items: [] },
    { key: "later", label: "Later", items: [] },
    { key: "closed", label: "Closed", items: [] },
  ];
  for (const o of items) {
    if (o.status === "done" || o.status === "dismissed") buckets[4]!.items.push(o);
    else if (o.days_until < 0) buckets[0]!.items.push(o);
    else if (o.days_until <= 7) buckets[1]!.items.push(o);
    else if (o.days_until <= 31) buckets[2]!.items.push(o);
    else buckets[3]!.items.push(o);
  }
  return buckets.filter((b) => b.items.length > 0);
}

function emptyTitle(filter: StatusFilter, search: string): string {
  if (search) return "Nothing matched that search";
  if (filter === "action_needed") return "Nothing needs action";
  if (filter === "owed_to_us") return "Nothing outstanding";
  if (filter === "done") return "Nothing completed yet";
  return "Your ledger is clear";
}

function emptyDescription(filter: StatusFilter, search: string): string {
  if (search) return "Try a person's name, a vendor, or part of the title.";
  if (filter === "owed_to_us")
    return "We flag warranties, deposits, and refunds as we find them in your documents.";
  if (filter === "done") return "Completed obligations will collect here.";
  return "We're watching every deadline we know about. Add a document to widen the net.";
}
