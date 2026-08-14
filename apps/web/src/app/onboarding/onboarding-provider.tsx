"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Route } from "next";
import type { HouseholdMemberSummary } from "@/providers/household-provider";
import { seedFromCensus, type CensusSeed } from "@/lib/domain/census";

/**
 * The onboarding draft.
 *
 * Held in the layout so it survives navigation between steps — the flow is four
 * routes rather than one screen with a step counter, because a caregiver doing this
 * on a phone will press the back button, and a wizard that answers back-navigation
 * by dumping them onto a landing page has failed before it started.
 *
 * It is a *draft*: nothing here is a household until the API says so. Persistence
 * across sessions is the server's job (the census resumes from what was written, not
 * from what this component remembers), which is why there is no localStorage here
 * pretending otherwise.
 */

export type CaringFor = "self" | "self_and_elder";

export interface DraftMember {
  id: string;
  displayName: string;
  kind: HouseholdMemberSummary["kind"];
}

interface OnboardingValue {
  caringFor: CaringFor | null;
  setCaringFor: (next: CaringFor) => void;
  members: DraftMember[];
  addMember: (member: Omit<DraftMember, "id">) => void;
  updateMember: (id: string, patch: Partial<Omit<DraftMember, "id">>) => void;
  removeMember: (id: string) => void;
  selections: string[];
  toggleSelection: (promptId: string) => void;
  documentsAdded: number;
  recordDocuments: (count: number) => void;
  /** The member the census is about — the elder when there is one, else nobody. */
  censusSubject: DraftMember | null;
  seed: CensusSeed;
}

const OnboardingContext = createContext<OnboardingValue | null>(null);

let memberSeq = 0;
const nextMemberId = () => `draft-${(memberSeq += 1)}`;

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [caringFor, setCaringForState] = useState<CaringFor | null>(null);
  const [members, setMembers] = useState<DraftMember[]>([]);
  const [selections, setSelections] = useState<string[]>([]);
  const [documentsAdded, setDocumentsAdded] = useState(0);

  const addMember = useCallback((member: Omit<DraftMember, "id">) => {
    setMembers((prev) => [...prev, { ...member, id: nextMemberId() }]);
  }, []);

  const setCaringFor = useCallback((next: CaringFor) => {
    setCaringForState(next);
    // Choosing "and a parent" without offering a row to fill in makes the next click
    // a guess. Seed one, once, and only when there is nothing to lose.
    setMembers((prev) =>
      next === "self_and_elder" && prev.length === 0
        ? [{ id: nextMemberId(), displayName: "", kind: "dependent" }]
        : prev,
    );
  }, []);

  const updateMember = useCallback((id: string, patch: Partial<Omit<DraftMember, "id">>) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const removeMember = useCallback((id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const toggleSelection = useCallback((promptId: string) => {
    setSelections((prev) =>
      prev.includes(promptId) ? prev.filter((p) => p !== promptId) : [...prev, promptId],
    );
  }, []);

  const recordDocuments = useCallback((count: number) => {
    setDocumentsAdded((prev) => prev + count);
  }, []);

  const value = useMemo<OnboardingValue>(() => {
    const named = members.filter((m) => m.displayName.trim().length > 0);
    const censusSubject =
      named.find((m) => m.kind === "dependent") ?? named.find((m) => m.kind !== "adult") ?? null;
    return {
      caringFor,
      setCaringFor,
      members,
      addMember,
      updateMember,
      removeMember,
      selections,
      toggleSelection,
      documentsAdded,
      recordDocuments,
      censusSubject,
      seed: seedFromCensus(
        selections,
        censusSubject ? { id: censusSubject.id, name: censusSubject.displayName.trim() } : null,
      ),
    };
  }, [
    caringFor,
    setCaringFor,
    members,
    addMember,
    updateMember,
    removeMember,
    selections,
    toggleSelection,
    documentsAdded,
    recordDocuments,
  ]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}

export interface OnboardingStep {
  href: Route;
  label: string;
}

/** One ordered list, consumed by the progress rail and every step's Continue button. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { href: "/onboarding", label: "Household" },
  { href: "/onboarding/census", label: "What to watch" },
  { href: "/onboarding/document", label: "First document" },
  { href: "/onboarding/ready", label: "Ready" },
];
