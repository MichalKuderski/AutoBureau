"use client";

import { createContext, useContext, useMemo } from "react";
import { setActiveHousehold } from "@/lib/api-client";
import { reloadForHousehold, writeActiveHousehold } from "@/lib/active-household";

/**
 * The active household, resolved server-side and injected here.
 *
 * Tenant scope is not client state: it is established by the session and validated
 * against membership on every request (doc 06 §2). This context exists so components
 * can *read* the active household for display and for the API client's header —
 * never so they can choose one. Switching households is a navigation, not a setState.
 *
 * P1-03 keeps that sentence literally true. `select()` writes a preference cookie and
 * refreshes; it changes no client state and returns no new household. The household this
 * provider holds only ever changes because the *server* resolved a different one on the
 * render that followed — which is why a refused selection cannot make the UI claim a
 * household the principal has no access to.
 */

export interface HouseholdMemberSummary {
  id: string;
  displayName: string;
  kind: "adult" | "child" | "dependent" | "pet" | "entity";
}

export interface ActiveHousehold {
  id: string;
  name: string;
  role: "owner" | "member" | "viewer";
  timezone: string;
  locale: string;
  emailAlias: string | null;
  members: HouseholdMemberSummary[];
  plan: "free" | "premium";
}

export interface Viewer {
  id: string;
  displayName: string;
  email: string;
}

/** One of the principal's memberships, as the server enumerated them in phase 1. */
export interface HouseholdOption {
  id: string;
  name: string;
}

interface HouseholdContextValue {
  household: ActiveHousehold;
  viewer: Viewer;
  /** Capability check — mirrors the server policy so the UI never offers a denied action. */
  can: (action: "write" | "manage" | "approve" | "reveal_secret") => boolean;
  /** Every household this principal belongs to. One entry is the ordinary case. */
  households: readonly HouseholdOption[];
  /** Record a preference for `householdId` and re-render from the server. */
  select: (householdId: string) => void;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({
  household,
  viewer,
  households,
  children,
}: {
  household: ActiveHousehold;
  viewer: Viewer;
  /** Omitted by callers that render a single household — most tests, and every screen. */
  households?: readonly HouseholdOption[] | undefined;
  children: React.ReactNode;
}) {
  const options = useMemo<readonly HouseholdOption[]>(
    () => households ?? [{ id: household.id, name: household.name }],
    [households, household.id, household.name],
  );

  // Published during render rather than in an effect: a child's `useQuery` can fire
  // before effects run, and a request that raced the effect would go out unscoped and
  // resolve `ambiguous-household`. Assigning module state during render is safe here
  // precisely because it is not React state — nothing re-renders as a result.
  //
  // `null` when there is nothing to disambiguate, so a single-household deployment sends
  // no header and behaves exactly as it did before P1-03.
  setActiveHousehold(options.length > 1 ? household.id : null);

  const value = useMemo<HouseholdContextValue>(() => {
    const can: HouseholdContextValue["can"] = (action) => {
      switch (action) {
        case "write":
        case "approve":
        case "reveal_secret":
          return household.role === "owner" || household.role === "member";
        case "manage":
          return household.role === "owner";
      }
    };
    const select = (householdId: string) => {
      if (householdId === household.id) return;
      // Preference first, then hand the whole decision back to the server. Nothing local
      // changes: the next render decides whether this selection was allowed, and the
      // provider is handed whatever it decided. A selection the server refuses therefore
      // never shows up here as an active household.
      writeActiveHousehold(householdId);
      reloadForHousehold();
    };
    return { household, viewer, can, households: options, select };
  }, [household, viewer, options]);

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
