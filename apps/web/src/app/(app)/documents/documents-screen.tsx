"use client";

import { useMemo, useState } from "react";
import { CollectionMore } from "@/components/patterns/collection-more";
import { PageHeader } from "@/components/patterns/page-header";
import { Chip, DOC_STATUS_TONE, DOC_STATUS_LABEL } from "@/components/ui/chip";
import { FilterBar, SearchInput, type FilterOption } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Table, type Column } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { ReviewPanel } from "@/components/patterns/review-panel";
import { UploadDropzone } from "@/components/ui/upload";
import { useHousehold } from "@/providers/household-provider";
import { useDocuments, useSummary } from "@/lib/domain/queries";
import { formatBytes, formatDate } from "@/lib/format";
import type { DocumentView } from "@/lib/domain/types";

type Lens = "all" | "needs_review" | "processed" | "processing";

/**
 * Documents — evidence, not the product.
 *
 * The ordering principle is deliberate: documents needing a human decision surface
 * first, everything else is archive. A document that has been processed has already
 * done its job (it produced items and obligations); the pile itself is not the value,
 * which is why this screen leads with the review queue rather than a file browser.
 */
export function DocumentsScreen({ initialStatus = "all" }: { initialStatus?: Lens } = {}) {
  const { household } = useHousehold();
  const [lens, setLens] = useState<Lens>(initialStatus);
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState<DocumentView | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const query = useDocuments(household.id, { search, status: lens === "all" ? null : lens === "processing" ? ["processing", "scanning"] : lens });
  const summary = useSummary(household.id);
  const reviewCount = summary.data?.needs_review ?? 0;
  const all = useMemo(() => query.data ?? [], [query.data]);

  const rows = all;
  const options: FilterOption<Lens>[] = [
    { value: "all", label: "All" }, { value: "needs_review", label: "Needs review" },
    { value: "processing", label: "Working" }, { value: "processed", label: "Filed" },
  ];

  const columns: Column<DocumentView>[] = [
    {
      id: "title",
      header: "Document",
      cell: (row) => (
        <div className="min-w-0">
          <span className="block truncate text-ink">{row.title ?? "Untitled document"}</span>
          <span className="block truncate text-xs text-ink-tertiary">
            {row.member_name ?? "Whole household"} · {formatBytes(row.size_bytes)}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Chip tone={DOC_STATUS_TONE[row.status]}>{DOC_STATUS_LABEL[row.status] ?? row.status}</Chip>
      ),
    },
    {
      id: "type",
      header: "Type",
      hideOnMobile: true,
      cell: (row) =>
        row.doc_type ? (
          <span className="text-ink-secondary">{row.doc_type.replace(/_/g, " ")}</span>
        ) : (
          <span className="text-ink-tertiary">—</span>
        ),
    },
    {
      id: "added",
      header: "Added",
      hideOnMobile: true,
      align: "end",
      cell: (row) => (
        <time dateTime={row.created_at} className="tabular-nums text-ink-secondary">
          {formatDate(row.created_at, { timeZone: household.timezone, style: "medium" })}
        </time>
      ),
    },
  ];

  if (query.isError) {
    return (
      <>
        <PageHeader title="Documents" />
        <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Your household’s documents and their processing status."
        actions={
          <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
            <Icon.Upload className="size-4" />
            Add documents
          </Button>
        }
      />

      {reviewCount > 0 ? (
        <Alert
          tone="warning"
          title={`${reviewCount} ${reviewCount === 1 ? "document needs" : "documents need"} a quick check`}
          className="mb-5"
          action={
            <Button size="sm" variant="secondary" onClick={() => { setSearch(""); setLens("needs_review"); }}>
              Review
            </Button>
          }
        >
          We read them but weren't confident enough to file them on our own.
        </Alert>
      ) : null}

      <div className="mb-5 flex flex-col gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search documents…"
          className="max-w-sm"
        />
        <FilterBar label="Filter documents" options={options} value={lens} onChange={setLens} />
      </div>

      {query.isPending ? (
        <SkeletonList count={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          tone="reassuring"
          icon={<Icon.Documents className="size-5" />}
          title={
            search ? "Nothing matches that" : lens === "needs_review" ? "Nothing needs your attention" : lens === "all" ? "No documents yet" : "No documents in this view"
          }
          description={
            search ? "Try a different word or clear the search."
              : lens === "needs_review" ? "No saved documents currently need your review."
              : "No saved documents match this view. Uploading and forwarding are not available in this preview yet."
          }
          action={
            lens === "needs_review"
              ? { label: "See all documents", onClick: () => setLens("all") }
              : { label: "Add documents", onClick: () => setUploadOpen(true) }
          }
        />
      ) : (
        <Table
          caption="Documents received from your household"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={setReviewing}
        />
      )}

      <CollectionMore query={query} />
      <Modal
        variant="drawer"
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={reviewing?.title ?? "Document"}
        description={
          reviewing
            ? `${reviewing.member_name ?? "Whole household"} · added ${formatDate(reviewing.created_at, { timeZone: household.timezone, style: "medium" })}`
            : undefined
        }
      >
        {reviewing ? (
          <ReviewPanel document={reviewing} onDone={() => setReviewing(null)} />
        ) : null}
      </Modal>

      <Modal
        variant="drawer"
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Add documents"
        description="Not available yet."
      >
        {/*
         * Blueprint P0-07. This drawer used to ignore the selected files entirely —
         * `onFiles={() => setUploadOpen(false)}` discarded its own argument — and the
         * only feedback was the drawer closing, which read as success. `disabled`
         * makes the unavailability the thing the user actually sees.
         */}
        <UploadDropzone disabled />
      </Modal>
    </>
  );
}
