"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { OnboardingSaveSchema, type OnboardingSave, type OnboardingView } from "@autobureau/contracts";
import type { HouseholdMemberSummary } from "@/providers/household-provider";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useCurrentHousehold } from "@/lib/domain/queries";
import { seedFromCensus, type CensusSeed } from "@/lib/domain/census";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorState, describeError } from "@/components/ui/error-state";

export type CaringFor = "self" | "self_and_elder";
export interface DraftMember {
  id: string; memberId: string | null; displayName: string; kind: HouseholdMemberSummary["kind"];
}
type NewMember = Omit<DraftMember, "id" | "memberId">;
interface OnboardingValue {
  caringFor: CaringFor | null; setCaringFor: (next: CaringFor) => void;
  members: DraftMember[]; addMember: (member: NewMember) => void;
  updateMember: (id: string, patch: Partial<NewMember>) => void; removeMember: (id: string) => void;
  selections: string[]; toggleSelection: (id: string) => void;
  documentsAdded: number; censusSubject: DraftMember | null; seed: CensusSeed;
  save: (stage: OnboardingSave["stage"]) => Promise<boolean>; saving: boolean; saveError: string | null;
  recordsSaved: number; dirty: boolean;
}
const OnboardingContext = createContext<OnboardingValue | null>(null);
const drafts = (data: OnboardingView) => data.members.map((member) => ({ id: member.client_ref, memberId: member.member_id,
  displayName: member.display_name, kind: member.kind }));

/** Fetch only after the authenticated endpoint selects this household. */
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const current = useCurrentHousehold();
  const householdId = current.data?.id;
  const query = useQuery<OnboardingView>({ queryKey: ["onboarding", householdId], enabled: Boolean(householdId),
    queryFn: ({ signal }) => apiFetch("/onboarding", { householdId, signal }) });
  if (current.isError || query.isError) return <ErrorState {...describeError(current.error ?? query.error)} onRetry={() => { void current.refetch(); void query.refetch(); }} />;
  if (!query.data || current.isPending) return <SkeletonList count={3} />;
  return <OnboardingDraftProvider key={query.data.household_id} initial={query.data}>{children}</OnboardingDraftProvider>;
}

/** A draft resumes from a server snapshot; successful Continue saves it atomically. */
export function OnboardingDraftProvider({ initial, children }: { initial: OnboardingView; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [caringFor, setCaring] = useState<CaringFor | null>(initial.caring_for);
  const [members, setMembers] = useState<DraftMember[]>(() => drafts(initial));
  const [selections, setSelections] = useState(initial.selections);
  const [validationError, setValidationError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: OnboardingSave) => apiFetch<OnboardingView>("/onboarding", { method: "PATCH", householdId: initial.household_id, body }),
    onSuccess: async (data) => {
      setSaved(data); setMembers(drafts(data));
      qc.setQueryData(["onboarding", initial.household_id], data);
      await Promise.all([qc.invalidateQueries({ queryKey: ["items", initial.household_id] }),
        qc.invalidateQueries({ queryKey: ["members", initial.household_id] }),
        qc.invalidateQueries({ queryKey: ["summary", initial.household_id] }),
        qc.invalidateQueries({ queryKey: ["timeline", initial.household_id] })]);
    },
  });
  const saving = mutation.isPending;
  const addMember = useCallback((member: NewMember) => {
    if (!saving) setMembers((old) => [...old, { ...member, id: crypto.randomUUID(), memberId: null }]);
  }, [saving]);
  const setCaringFor = useCallback((next: CaringFor) => {
    if (saving) return;
    setCaring(next);
    setMembers((old) => next === "self_and_elder" && old.length === 0
      ? [{ id: crypto.randomUUID(), memberId: null, displayName: "", kind: "dependent" }] : old);
  }, [saving]);
  const updateMember = useCallback((id: string, patch: Partial<NewMember>) => {
    if (!saving) setMembers((old) => old.map((member) => member.id === id ? { ...member, ...patch } : member));
  }, [saving]);
  const removeMember = useCallback((id: string) => {
    if (!saving) setMembers((old) => old.filter((member) => member.id !== id || member.memberId !== null));
  }, [saving]);
  const toggleSelection = useCallback((id: string) => {
    if (!saving) setSelections((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id]);
  }, [saving]);
  const censusSubject = caringFor === "self_and_elder"
    ? members.find((member) => member.displayName.trim() && member.kind === "dependent") ?? null : null;
  const submittedMembers = members.filter((member) => member.memberId !== null || member.displayName.trim()).map((member) => ({
    client_ref: member.id, member_id: member.memberId, display_name: member.displayName.trim(), kind: member.kind,
  }));
  const dirty = caringFor !== saved.caring_for || JSON.stringify([...selections].sort()) !== JSON.stringify([...saved.selections].sort())
    || JSON.stringify(submittedMembers) !== JSON.stringify(saved.members) || (censusSubject?.id ?? null) !== saved.census_subject_ref;
  const value: OnboardingValue = {
    caringFor, setCaringFor, members, addMember, updateMember, removeMember, selections, toggleSelection,
    censusSubject, documentsAdded: saved.documents_added, recordsSaved: saved.records_saved, dirty, saving,
    saveError: validationError ?? (mutation.isError ? mutation.error instanceof ApiError ? mutation.error.message : "Your answers are still here. Please try saving again." : null),
    seed: useMemo(() => seedFromCensus(selections, censusSubject ? { id: censusSubject.id, name: censusSubject.displayName.trim() } : null), [selections, censusSubject]),
    save: async (stage) => {
      if (saving) return false;
      const parsed = OnboardingSaveSchema.safeParse({ stage, caring_for: caringFor, members: submittedMembers, selections, census_subject_ref: censusSubject?.id ?? null });
      if (!parsed.success) { setValidationError(parsed.error.issues[0]?.message ?? "Check your answers."); return false; }
      setValidationError(null);
      try {
        await mutation.mutateAsync(parsed.data);
        return true;
      } catch { return false; }
    },
  };
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error("useOnboarding must be used within OnboardingProvider");
  return value;
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
