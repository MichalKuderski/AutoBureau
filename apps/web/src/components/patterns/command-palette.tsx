"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useHousehold } from "@/providers/household-provider";
import { useDocuments, useItems, useObligations } from "@/lib/domain/queries";
import { formatDueLabel } from "@/lib/format";

/**
 * Command palette — the product's search surface (PRD F12).
 *
 * Deliberately *not* a chat box: v1 ships search, and the difference must be legible
 * in the interface itself so the absence reads as a decision rather than a gap.
 *
 * Implements the full combobox pattern (WAI-ARIA 1.2): the input keeps focus while
 * arrow keys move a virtual cursor via `aria-activedescendant`, so screen readers
 * announce the highlighted option without focus ever leaving the text field.
 */

interface Result {
  id: string;
  group: "Obligations" | "Documents" | "Items" | "Go to";
  title: string;
  /** Explicitly nullable: under exactOptionalPropertyTypes an absent subtitle and an
   *  undefined one are different types, and the builders below produce the latter. */
  subtitle?: string | undefined;
  href: string;
  icon: (p: { className?: string }) => React.ReactElement;
}

const DESTINATIONS: Result[] = [
  { id: "nav-dash", group: "Go to", title: "Today", href: "/dashboard", icon: Icon.Dashboard },
  { id: "nav-obl", group: "Go to", title: "Obligations", href: "/obligations", icon: Icon.Obligations },
  { id: "nav-doc", group: "Go to", title: "Documents", href: "/documents", icon: Icon.Documents },
  { id: "nav-house", group: "Go to", title: "Household", href: "/household", icon: Icon.Household },
  { id: "nav-cal", group: "Go to", title: "Calendar", href: "/calendar", icon: Icon.Calendar },
  { id: "nav-time", group: "Go to", title: "Timeline", href: "/timeline", icon: Icon.Timeline },
  { id: "nav-set", group: "Go to", title: "Settings", href: "/settings", icon: Icon.Settings },
  { id: "nav-up", group: "Go to", title: "Add a document", href: "/documents/upload", icon: Icon.Upload },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();
  const { household } = useHousehold();

  useFocusTrap(panelRef, open, () => setOpen(false));

  const { data: obligations = [] } = useObligations(household.id, { search: query });
  const { data: documents = [] } = useDocuments(household.id, { search: query });
  const { data: items = [] } = useItems(household.id, { search: query });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("autobureau:open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("autobureau:open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Result[] = [];

    if (q) {
      for (const o of obligations.slice(0, 5)) {
        out.push({
          id: o.id,
          group: "Obligations",
          title: o.title,
          subtitle: formatDueLabel(o.due_at, household.timezone),
          href: `/obligations/${o.id}`,
          icon: Icon.Obligations,
        });
      }
      for (const d of documents.slice(0, 4)) {
        out.push({
          id: d.id,
          group: "Documents",
          title: d.title ?? "Untitled document",
          subtitle: d.member_name ?? d.doc_type ?? undefined,
          href: `/documents/${d.id}`,
          icon: Icon.Documents,
        });
      }
      for (const i of items.slice(0, 4)) {
        out.push({
          id: i.id,
          group: "Items",
          title: i.name,
          subtitle: i.vendor_name ?? i.member_name ?? undefined,
          href: `/household/${i.id}`,
          icon: Icon.Household,
        });
      }
    }

    const dest = q
      ? DESTINATIONS.filter((d) => d.title.toLowerCase().includes(q))
      : DESTINATIONS;
    return [...out, ...dest];
  }, [query, obligations, documents, items, household.timezone]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  // Keep the highlighted option scrolled into view as the cursor moves.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open || typeof document === "undefined") return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href as never);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[cursor];
      if (target) go(target.href);
    }
  };

  let lastGroup = "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <div
        className="fixed inset-0 bg-overlay motion-safe:animate-[fade-in_120ms_var(--ease-out-expo)]"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-lg motion-safe:animate-[scale-in_160ms_var(--ease-out-expo)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon.Search className="size-4 shrink-0 text-ink-tertiary" />
          <input
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[cursor] ? `command-option-${cursor}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search obligations, documents, people…"
            className="h-12 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-tertiary"
          />
          <kbd className="hidden shrink-0 rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-2xs text-ink-tertiary sm:block">
            Esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-ink-tertiary">
              Nothing matched “{query}”. Try a name, a vendor, or a date.
            </li>
          ) : (
            results.map((r, index) => {
              const showGroup = r.group !== lastGroup;
              lastGroup = r.group;
              const active = index === cursor;
              const IconComponent = r.icon;
              return (
                <li key={`${r.group}-${r.id}`}>
                  {showGroup ? (
                    <p className="px-3 pb-1 pt-3 font-mono text-2xs uppercase tracking-wider text-ink-tertiary">
                      {r.group}
                    </p>
                  ) : null}
                  <div
                    id={`command-option-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(r.href)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2",
                      active ? "bg-accent-soft text-accent" : "text-ink",
                    )}
                  >
                    <IconComponent
                      className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-tertiary")}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                    {r.subtitle ? (
                      <span className="shrink-0 truncate text-2xs text-ink-tertiary">
                        {r.subtitle}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center gap-4 border-t border-line bg-surface-sunken/60 px-4 py-2 text-2xs text-ink-tertiary">
          <span>↑↓ to navigate</span>
          <span>↵ to open</span>
          <span className="ml-auto">Search only — AutoBureau doesn't chat</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
