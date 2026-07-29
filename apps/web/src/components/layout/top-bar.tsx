"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "@/providers/theme-provider";
import { useHousehold } from "@/providers/household-provider";
import { initialsOf } from "@/lib/format";

/**
 * Top bar: navigation trigger on mobile, search entry, capture, theme, account.
 *
 * The search control is a button, not an input. It opens the command palette, and
 * pretending to be a text field would strand keyboard users who type into it before
 * the palette mounts. It also advertises its shortcut, which is how the shortcut
 * gets discovered at all.
 */
export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 rounded-md p-2 text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink lg:hidden"
        >
          <Icon.Menu />
        </button>

        <SearchTrigger />

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/documents/upload"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
          >
            <Icon.Plus className="size-4" />
            <span className="hidden sm:inline">Add document</span>
          </Link>
          <ThemeToggle />
          <NotificationsButton />
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

/**
 * Platform is an external, never-changing fact. Reading it through
 * `useSyncExternalStore` (with a no-op subscribe) gives an explicit server snapshot
 * so hydration can't mismatch, and avoids the extra render an effect would cost.
 */
const subscribePlatform = () => () => {};
const readShortcut = (): string =>
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";
const shortcutServerSnapshot = (): string => "Ctrl K";

function SearchTrigger() {
  const shortcut = useSyncExternalStore(
    subscribePlatform,
    readShortcut,
    shortcutServerSnapshot,
  );

  const open = () => window.dispatchEvent(new CustomEvent("autobureau:open-command-palette"));

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-left text-sm text-ink-tertiary transition-colors",
        "hover:border-line-strong hover:text-ink-secondary sm:max-w-md",
      )}
    >
      <Icon.Search className="size-4 shrink-0" />
      <span className="truncate">Search documents, obligations, people…</span>
      <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-2xs text-ink-tertiary sm:inline-block">
        {shortcut}
      </kbd>
    </button>
  );
}

function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`Switch to ${next} theme`}
      className="rounded-md p-2 text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {resolved === "dark" ? <Icon.Sun className="size-[18px]" /> : <Icon.Moon className="size-[18px]" />}
    </button>
  );
}

function NotificationsButton() {
  return (
    <Link
      href="/notifications"
      aria-label="Notifications"
      className="relative rounded-md p-2 text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <Icon.Bell className="size-[18px]" />
    </Link>
  );
}

function AccountButton() {
  const { viewer } = useHousehold();
  return (
    <Link
      href="/settings/profile"
      aria-label="Your profile"
      className="ml-1 flex size-8 items-center justify-center rounded-full bg-surface-sunken text-2xs font-semibold text-ink-secondary transition-colors hover:bg-accent-soft hover:text-accent"
    >
      {initialsOf(viewer.displayName)}
    </Link>
  );
}
