"use client";

import { Icon } from "@/components/ui/icon";
import { reloadForHousehold, writeActiveHousehold } from "@/lib/active-household";
import type { HouseholdOption } from "@/providers/household-provider";

/**
 * Which household to open (blueprint P1-03).
 *
 * Shown only when `resolveRequestContext` refused to guess between several memberships.
 * That refusal is D1 working as designed — the resolver must never pick one — but before
 * P1-03 it left a caregiver with two households unable to load any page at all, and
 * therefore unable to reach the switcher that would have fixed it. This is the way out.
 *
 * It renders no application shell on purpose. There is no active household yet, so a
 * sidebar naming one would be inventing the very answer the server declined to give.
 *
 * The list arrives from the server, enumerated under phase-1 scope. Choosing writes the
 * preference and re-renders; the server decides what that preference means.
 */
export function HouseholdChooser({ households }: { households: readonly HouseholdOption[] }) {
  const choose = (householdId: string) => {
    writeActiveHousehold(householdId);
    reloadForHousehold();
  };

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-lg border border-line bg-surface p-6">
        <div
          aria-hidden
          className="mb-4 flex size-9 items-center justify-center rounded-md bg-accent text-accent-ink"
        >
          <Icon.Household className="size-5" />
        </div>

        <h1 className="text-xl leading-tight">Which household?</h1>
        <p className="mt-2 text-sm text-ink-secondary text-pretty">
          You look after more than one. Pick the one to open — you can switch whenever you like.
        </p>

        <ul className="mt-5 flex flex-col gap-2">
          {households.map((household) => (
            <li key={household.id}>
              <button
                type="button"
                onClick={() => choose(household.id)}
                className="flex w-full items-center gap-3 rounded-md border border-line px-3 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {household.name}
                </span>
                <Icon.ChevronRight className="size-4 shrink-0 text-ink-tertiary" />
              </button>
            </li>
          ))}
        </ul>

        {households.length === 0 ? (
          <p className="mt-4 text-sm text-ink-tertiary">
            We couldn&apos;t list your households just now. Reload the page to try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}
