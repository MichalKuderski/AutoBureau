"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { Chip, ITEM_TONE } from "@/components/ui/chip";
import { FilterBar, SearchInput, type FilterOption } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Table, type Column } from "@/components/ui/table";
import { useHousehold } from "@/providers/household-provider";
import { useCurrentHousehold, useItems } from "@/lib/domain/queries";
import { formatDate, formatMasked, formatMoney, initialsOf } from "@/lib/format";
import type { ItemView } from "@/lib/domain/types";
import { cn } from "@/lib/cn";

/**
 * Household overview — the registry of standing.
 *
 * Organised by *member* first, kind second. A caregiver thinks "what does Mom have",
 * not "show me all insurance policies", and the wedge persona is who this screen is
 * designed around (PRD §2, §4).
 *
 * Identifier-grade values are never rendered in full here — only the masked `last4`
 * the API returns. A separate, audited reveal action is the ADR-007 design, not the
 * current one: no reveal endpoint or decrypt path exists anywhere in this repository
 * yet (blueprint P0-10). There is no "show" affordance in a list context regardless —
 * that was true before the audited path existed and stays true once it does.
 */
export function HouseholdScreen() {
  const { household } = useHousehold();
  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ItemView | null>(null);

  const query = useItems(household.id, { search, memberId });
  const items = useMemo(() => query.data ?? [], [query.data]);

  // ADR-009 Gate A: this one value comes from `/v1/households/current` rather than from
  // the provider, so the screen exercises the authenticated boundary itself. The context
  // value is the fallback while the request is in flight — same household either way.
  const current = useCurrentHousehold();
  const householdName = current.data?.name ?? household.name;

  const memberFilters: FilterOption[] = useMemo(
    () => [
      { value: "", label: "Everyone" },
      ...household.members.map((m) => ({ value: m.id, label: m.displayName })),
    ],
    [household.members],
  );

  const byMember = useMemo(() => {
    const groups = new Map<string, { name: string; items: ItemView[] }>();
    for (const item of items) {
      const key = item.member_id ?? "__household";
      const name = item.member_name ?? "Whole household";
      const existing = groups.get(key);
      if (existing) existing.items.push(item);
      else groups.set(key, { name, items: [item] });
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const columns: Column<ItemView>[] = [
    {
      id: "name",
      header: "Item",
      cell: (row) => (
        <div className="min-w-0">
          <span className="block truncate text-ink">{row.name}</span>
          {row.vendor_name ? (
            <span className="block truncate text-xs text-ink-tertiary">{row.vendor_name}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <Chip tone={ITEM_TONE[row.status]}>{row.status.replace("_", " ")}</Chip>,
    },
    {
      id: "expires",
      header: "Expires",
      hideOnMobile: true,
      cell: (row) =>
        row.expires_at ? (
          <time dateTime={row.expires_at} className="tabular-nums text-ink-secondary">
            {formatDate(row.expires_at, { timeZone: household.timezone, style: "medium" })}
          </time>
        ) : (
          <span className="text-ink-tertiary">—</span>
        ),
    },
    {
      id: "open",
      header: "Open",
      align: "end",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums text-ink-secondary">{row.open_obligation_count}</span>
      ),
    },
  ];

  if (query.isError) {
    return (
      <>
        <PageHeader title="Household" />
        <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={householdName}
        description="Everything we're tracking for the people you look after."
        actions={
          <Button variant="primary" size="sm">
            <Icon.Plus className="size-4" />
            Add item
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search policies, vehicles, subscriptions…"
          className="max-w-sm"
        />
        <FilterBar
          label="Filter by member"
          options={memberFilters}
          value={memberId ?? ""}
          onChange={(v) => setMemberId(v || null)}
        />
      </div>

      {query.isPending ? (
        <SkeletonList count={5} />
      ) : items.length === 0 ? (
        <EmptyState
          tone="reassuring"
          icon={<Icon.Household className="size-5" />}
          title={search ? "Nothing matches that" : "Your registry is empty"}
          description={
            search
              ? "Try a different word, or clear the search to see everything."
              : "Forward a policy, a registration, or a bill and we'll start the registry for you."
          }
          action={search ? { label: "Clear search", onClick: () => setSearch("") } : undefined}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {byMember.map((group) => (
            <section key={group.name} aria-labelledby={`m-${group.name}`}>
              <div className="mb-3 flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent"
                >
                  {initialsOf(group.name)}
                </span>
                <h2 id={`m-${group.name}`} className="text-sm font-medium text-ink">
                  {group.name}
                </h2>
                <span className="text-xs text-ink-tertiary">
                  {group.items.length} {group.items.length === 1 ? "item" : "items"}
                </span>
              </div>
              <Table
                caption={`Items tracked for ${group.name}`}
                columns={columns}
                rows={group.items}
                rowKey={(r) => r.id}
                onRowClick={setSelected}
              />
            </section>
          ))}
        </div>
      )}

      <Modal
        variant="drawer"
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        description={selected?.vendor_name ?? undefined}
      >
        {selected ? <ItemDetail item={selected} timeZone={household.timezone} /> : null}
      </Modal>
    </>
  );
}

function ItemDetail({ item, timeZone }: { item: ItemView; timeZone: string }) {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-4">
        <Detail label="Status">
          <Chip tone={ITEM_TONE[item.status]}>{item.status.replace("_", " ")}</Chip>
        </Detail>
        <Detail label="Member">{item.member_name ?? "Whole household"}</Detail>
        <Detail label="Expires">
          {item.expires_at
            ? formatDate(item.expires_at, { timeZone, style: "long" })
            : "No expiry"}
        </Detail>
        <Detail label="Cost">
          {item.amount_cents != null
            ? `${formatMoney({ amountCents: item.amount_cents, currency: item.currency ?? "USD" })}${item.billing_cycle ? ` / ${item.billing_cycle}` : ""}`
            : "—"}
        </Detail>
      </dl>

      {item.secrets.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-tertiary uppercase">
            Identifiers
          </h3>
          <ul className="flex flex-col gap-1.5">
            {item.secrets.map((s) => (
              <li
                key={s.field}
                className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2 text-sm"
              >
                <span className="text-ink-secondary">{s.field.replace(/_/g, " ")}</span>
                <span className="font-mono tabular-nums text-ink">{formatMasked(s.last4)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-tertiary">
            <Icon.Shield className="mt-0.5 size-3 shrink-0" />
            Only the last four digits are ever shown here. The plan is to encrypt full
            values and log every reveal — neither is built yet.
          </p>
        </section>
      ) : null}

      <div className="flex gap-4 text-sm">
        <span className="text-ink-secondary">
          <strong className="tabular-nums text-ink">{item.open_obligation_count}</strong> open
        </span>
        <span className="text-ink-secondary">
          <strong className="tabular-nums text-ink">{item.document_count}</strong> documents
        </span>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0")}>
      <dt className="text-xs font-medium tracking-wide text-ink-tertiary uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}
