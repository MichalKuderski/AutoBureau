"use client";

import { useState } from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { CollectionMore } from "@/components/patterns/collection-more";
import { Timeline } from "@/components/patterns/timeline";
import { FilterBar, type FilterOption } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { useHousehold } from "@/providers/household-provider";
import { useTimeline } from "@/lib/domain/queries";
import type { TimelineLens } from "@/lib/domain/types";

const LENSES: Array<{ value: TimelineLens; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "obligations", label: "Deadlines" },
  { value: "documents", label: "Documents" },
  { value: "items", label: "Records" },
];

/**
 * The household's history.
 *
 * This screen is the ledger's memory made visible — the answer to "what happened
 * with Mom's insurance in March" without anyone having to remember. It matters more
 * over time than it does on day one, which is why the empty state promises the
 * future rather than apologising for the present.
 */
export function TimelineScreen() {
  const { household } = useHousehold();
  const [lens, setLens] = useState<TimelineLens>("all");
  const query = useTimeline(household.id, lens);
  const entries = query.data;

  const options: FilterOption[] = LENSES.map((l) => ({ value: l.value, label: l.label }));

  if (query.isError) {
    return (
      <>
        <PageHeader title="Timeline" />
        <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Saved documents, records, and deadline changes, newest first."
      />

      <FilterBar
        label="Filter timeline"
        options={options}
        value={lens}
        onChange={(value) => setLens(value as TimelineLens)}
        className="mb-6"
      />

      {query.isPending ? (
        <SkeletonList count={6} />
      ) : entries.length === 0 ? (
        <EmptyState
          tone="reassuring"
          icon={<Icon.Timeline className="size-5" />}
          title="Nothing here yet"
          description="Saved changes will appear here. Try another filter to see other activity."
        />
      ) : (
        <Timeline entries={entries} timeZone={household.timezone} />
      )}
      <CollectionMore query={query} />
    </>
  );
}
