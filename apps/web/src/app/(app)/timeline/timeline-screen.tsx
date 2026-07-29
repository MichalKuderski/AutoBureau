"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { Timeline } from "@/components/patterns/timeline";
import { FilterBar, type FilterOption } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { useHousehold } from "@/providers/household-provider";
import { useTimeline } from "@/lib/domain/queries";
import type { TimelineEntry } from "@/lib/domain/types";

const LENSES: Array<{ value: string; label: string; kinds: TimelineEntry["kind"][] | null }> = [
  { value: "all", label: "Everything", kinds: null },
  {
    value: "obligations",
    label: "Deadlines",
    kinds: ["obligation_created", "obligation_completed", "item_expiring", "reminder_sent"],
  },
  { value: "documents", label: "Documents", kinds: ["document_added", "item_added"] },
  { value: "value", label: "Money found", kinds: ["value_found"] },
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
  const [lens, setLens] = useState("all");
  const query = useTimeline(household.id);

  const entries = useMemo(() => {
    const all = query.data ?? [];
    const selected = LENSES.find((l) => l.value === lens);
    if (!selected?.kinds) return all;
    return all.filter((e) => selected.kinds!.includes(e.kind));
  }, [query.data, lens]);

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
        description="Every document, deadline, and result — in the order it happened."
      />

      <FilterBar
        label="Filter timeline"
        options={options}
        value={lens}
        onChange={setLens}
        className="mb-6"
      />

      {query.isPending ? (
        <SkeletonList count={6} />
      ) : entries.length === 0 ? (
        <EmptyState
          tone="reassuring"
          icon={<Icon.Timeline className="size-5" />}
          title="Nothing here yet"
          description="As documents arrive and deadlines pass, your household's history builds itself here — so you never have to reconstruct it from memory."
        />
      ) : (
        <Timeline entries={entries} timeZone={household.timezone} />
      )}
    </>
  );
}
