"use client";

import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/**
 * Filters as a toolbar of toggle buttons rather than select menus.
 *
 * Selects hide state behind a click; in a screen whose whole job is "what needs
 * attention", the active filter must be visible at a glance. `aria-pressed` gives
 * screen readers the same information sighted users get from the fill.
 */

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  count?: number | undefined;
}

export function FilterBar<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string | undefined;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-transparent bg-accent text-accent-ink"
                : "border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-2xs",
                  active ? "bg-white/20" : "bg-surface-sunken text-ink-tertiary",
                )}
                data-tabular
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("relative", className)}>
      <Icon.Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink",
          "placeholder:text-ink-tertiary focus:border-accent focus:outline-none",
        )}
      />
    </div>
  );
}
