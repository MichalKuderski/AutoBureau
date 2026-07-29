"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * The active household, resolved server-side and injected here.
 *
 * Tenant scope is not client state: it is established by the session and validated
 * against membership on every request (doc 06 §2). This context exists so components
 * can *read* the active household for display and for the API client's header —
 * never so they can choose one. Switching households is a navigation, not a setState.
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

interface HouseholdContextValue {
  household: ActiveHousehold;
  viewer: Viewer;
  /** Capability check — mirrors the server policy so the UI never offers a denied action. */
  can: (action: "write" | "manage" | "approve" | "reveal_secret") => boolean;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({
  household,
  viewer,
  children,
}: {
  household: ActiveHousehold;
  viewer: Viewer;
  children: React.ReactNode;
}) {
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
    return { household, viewer, can };
  }, [household, viewer]);

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
