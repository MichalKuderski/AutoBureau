"use client";

import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/**
 * Data table.
 *
 * Semantic `<table>` rather than a grid of divs: screen readers announce row and
 * column position for free, and users who navigate by table land where they expect.
 * The wrapper owns horizontal overflow so a wide table never makes the page scroll
 * sideways — a rule the whole product follows.
 *
 * Sorting is presentational only; the caller owns the data and the comparator, so a
 * server-sorted table and a client-sorted one use the identical component.
 */

export type SortDirection = "asc" | "desc";

export interface Column<T> {
  id: string;
  header: string;
  /** Cell renderer. Returning a node (not a string) keeps formatting at the call site. */
  cell: (row: T) => React.ReactNode;
  sortable?: boolean | undefined;
  align?: "start" | "end" | undefined;
  /** Hide below `sm`. Use for detail columns that would crush a phone layout. */
  hideOnMobile?: boolean | undefined;
  width?: string | undefined;
}

export interface TableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** Required. Describes the table for assistive tech; visually hidden by default. */
  caption: string;
  captionVisible?: boolean | undefined;
  sort?: { columnId: string; direction: SortDirection } | undefined;
  onSortChange?: ((columnId: string, direction: SortDirection) => void) | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  empty?: React.ReactNode | undefined;
  className?: string | undefined;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionVisible = false,
  sort,
  onSortChange,
  onRowClick,
  empty,
  className,
}: TableProps<T>) {
  if (rows.length === 0 && empty) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-line bg-surface", className)}>
      <table className="w-full border-collapse text-sm">
        <caption
          className={cn(
            captionVisible
              ? "px-4 pt-3 pb-2 text-left text-sm text-ink-secondary"
              : "sr-only",
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => {
              const active = sort?.columnId === col.id;
              const next: SortDirection = active && sort?.direction === "asc" ? "desc" : "asc";
              return (
                <th
                  key={col.id}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn(
                    "px-4 py-2.5 text-xs font-medium tracking-wide text-ink-tertiary uppercase",
                    col.align === "end" ? "text-right" : "text-left",
                    col.hideOnMobile && "hidden sm:table-cell",
                  )}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.id, next)}
                      className="inline-flex items-center gap-1 rounded-xs hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {col.header}
                      <Icon.ChevronDown
                        className={cn(
                          "size-3 transition-transform",
                          active ? "opacity-100" : "opacity-30",
                          active && sort?.direction === "asc" && "rotate-180",
                        )}
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              // No `role` override: a `<tr>` announced as "button" would lose its row/cell
              // relationship to assistive tech (the very thing a real `<table>` was chosen
              // for), and WCAG 2.1.1 asks only that the action be reachable and operable by
              // keyboard, not that the element's role change. `tabIndex` plus a same-callback
              // key handler is the smallest change that satisfies that without pretending
              // this is a button.
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      // Guards a future cell that nests its own interactive element (a
                      // button/link inside a `<td>`): its own Enter/Space must not also
                      // fire the row action. No current consumer nests one, but the guard
                      // costs nothing and keeps that combination from silently double-firing.
                      if (event.target !== event.currentTarget) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      // Space's default is scrolling the page — the one browser behavior a
                      // key press must not trigger here.
                      event.preventDefault();
                      onRowClick(row);
                    }
                  : undefined
              }
              className={cn(
                "border-b border-line last:border-0",
                onRowClick &&
                  "cursor-pointer hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.id}
                  className={cn(
                    "px-4 py-3 align-top text-ink",
                    col.align === "end" ? "text-right" : "text-left",
                    col.hideOnMobile && "hidden sm:table-cell",
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
