"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { SidebarNav, MobileTabBar, NAV_ITEMS } from "./nav";
import { TopBar } from "./top-bar";

/**
 * The authenticated shell.
 *
 * Rendered once by the `(app)` route group so navigation swaps only the main region:
 * the sidebar, top bar, and any open drawer keep their state across routes, and the
 * browser never repaints chrome it already has. At scale this is also what keeps
 * navigation feeling instant — the expensive parts of the tree simply don't remount.
 *
 * Three landmarks, one skip link, and a focus reset on route change so keyboard users
 * are not dumped back at the top of the nav after every navigation.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The drawer records *which route* it was opened on, so a route change closes it
  // by derivation rather than by an effect. An effect here would set state during
  // commit and force a second render on every navigation; this version also handles
  // browser back/forward for free, which a click handler alone would miss.
  const [navOpenFor, setNavOpenFor] = useState<string | null>(null);
  const mobileNavOpen = navOpenFor === pathname;
  const setMobileNavOpen = (next: boolean) => setNavOpenFor(next ? pathname : null);

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only-focusable fixed left-4 top-4 z-50 rounded-md bg-accent px-4 py-2 text-accent-ink shadow-lg"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex w-full max-w-[1600px]">
        {/* Desktop sidebar — persistent, never remounts */}
        <aside
          aria-label="Primary"
          className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line bg-surface lg:block"
        >
          <SidebarNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenNav={() => setMobileNavOpen(true)} />

          <main
            id="main"
            tabIndex={-1}
            className="flex-1 px-4 pb-24 pt-5 outline-none sm:px-6 lg:px-8 lg:pb-10"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Mobile: bottom tabs for the four primary destinations */}
      <MobileTabBar items={NAV_ITEMS.slice(0, 4)} />

      {/* Mobile: full nav drawer */}
      {mobileNavOpen ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className={cn(
              "fixed inset-0 z-40 bg-overlay",
              "motion-safe:animate-[fade-in_150ms_var(--ease-out-expo)]",
            )}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-72 border-r border-line bg-surface",
              "motion-safe:animate-[slide-in-left_220ms_var(--ease-out-expo)]",
            )}
          >
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} showClose />
          </div>
        </div>
      ) : null}
    </div>
  );
}
