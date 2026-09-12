"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ObligationOutcome } from "@autobureau/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";
import type {
  DashboardSummary,
  DocumentView,
  ItemView,
  NotificationView,
  ObligationView,
  TimelineEntry,
  TimelineLens,
} from "./types";
import * as fixtures from "./fixtures";
import { useCollection } from "./collection";

/** Scoped queries share contract shapes with the server. Notification cutover remains pending. */

const LATENCY_MS = 220;

async function resolve<T>(value: T): Promise<T> {
  // Simulated latency keeps loading states honest during development. Without it,
  // skeletons never render and their bugs ship.
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  return value;
}

export const queryKeys = {
  summary: (h: string) => ["summary", h] as const,
  obligations: (h: string, params?: ObligationFilters) => ["obligations", h, params ?? {}] as const,
  obligation: (h: string, id: string) => ["obligation", h, id] as const,
  items: (h: string, params?: ItemFilters) => ["items", h, params ?? {}] as const,
  item: (h: string, id: string) => ["item", h, id] as const,
  documents: (h: string, params?: DocumentFilters) => ["documents", h, params ?? {}] as const,
  document: (h: string, id: string) => ["document", h, id] as const,
  timeline: (h: string, lens?: TimelineLens) => ["timeline", h, ...(lens ? [lens] : [])] as const,
  notifications: (h: string) => ["notifications", h] as const,
  currentHousehold: () => ["household", "current"] as const,
};

/** What `GET /v1/households/current` returns — the whole contract, nothing added. */
export interface CurrentHousehold {
  id: string;
  name: string | null;
  role: "owner" | "member" | "viewer";
}

export function useCurrentHousehold() {
  return useQuery<CurrentHousehold>({
    queryKey: queryKeys.currentHousehold(),
    queryFn: () => apiFetch<CurrentHousehold>("/households/current"),
  });
}

export interface ObligationFilters {
  status?: string[];
  memberId?: string | null;
  direction?: "owed_by_household" | "owed_to_household" | null;
  dueWithinDays?: number | null;
  dueAfter?: string;
  dueBefore?: string;
  search?: string;
}

export interface ItemFilters {
  kind?: string | null;
  memberId?: string | null;
  status?: string | null;
  search?: string;
}

export interface DocumentFilters {
  status?: string | string[] | null;
  docType?: string | null;
  memberId?: string | null;
  search?: string;
}

function pathWithFilters(path: string, filters: Record<string, string | string[] | number | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    for (const part of Array.isArray(value) ? value : [value]) query.append(key, String(part));
  }
  return `${path}?${query}`;
}
async function detail<T>(path: string, householdId: string, signal: AbortSignal): Promise<T | null> {
  try { return await apiFetch<T>(path, { householdId, signal }); }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}
export function useSummary(householdId: string) {
  return useQuery<DashboardSummary>({ queryKey: queryKeys.summary(householdId),
    queryFn: ({ signal }) => apiFetch("/dashboard", { householdId, signal }) });
}
export function useObligations(householdId: string, filters: ObligationFilters = {}, enabled = true) {
  return useCollection<ObligationView>(queryKeys.obligations(householdId, filters), householdId, pathWithFilters("/obligations", {
    status: filters.status, member_id: filters.memberId, direction: filters.direction,
    due_within_days: filters.dueWithinDays, q: filters.search, due_after: filters.dueAfter, due_before: filters.dueBefore,
  }), enabled);
}
export function useObligation(householdId: string, id: string) {
  return useQuery<ObligationView | null>({ queryKey: queryKeys.obligation(householdId, id), enabled: id.length > 0,
    queryFn: ({ signal }) => detail(`/obligations/${encodeURIComponent(id)}`, householdId, signal) });
}
export function useItems(householdId: string, filters: ItemFilters = {}) {
  return useCollection<ItemView>(queryKeys.items(householdId, filters), householdId, pathWithFilters("/items", {
    kind: filters.kind, member_id: filters.memberId, status: filters.status, q: filters.search,
  }));
}
export function useItem(householdId: string, id: string) {
  return useQuery<ItemView | null>({ queryKey: queryKeys.item(householdId, id), enabled: id.length > 0,
    queryFn: ({ signal }) => detail(`/items/${encodeURIComponent(id)}`, householdId, signal) });
}
export function useDocuments(householdId: string, filters: DocumentFilters = {}) {
  return useCollection<DocumentView>(queryKeys.documents(householdId, filters), householdId, pathWithFilters("/documents", {
    status: filters.status, doc_type: filters.docType, member_id: filters.memberId, q: filters.search,
  }));
}
export function useDocument(householdId: string, id: string) {
  return useQuery<DocumentView | null>({ queryKey: queryKeys.document(householdId, id), enabled: id.length > 0,
    queryFn: ({ signal }) => detail(`/documents/${encodeURIComponent(id)}`, householdId, signal) });
}

export function useTimeline(householdId: string, lens: TimelineLens = "all") {
  return useCollection<TimelineEntry>(queryKeys.timeline(householdId, lens), householdId,
    pathWithFilters("/timeline", { lens }));
}

export function useNotifications(householdId: string) {
  return useQuery<NotificationView[]>({
    queryKey: queryKeys.notifications(householdId),
    queryFn: () => resolve(fixtures.NOTIFICATIONS),
  });
}

export interface ObligationStatusUpdate {
  id: string;
  status: ObligationView["status"];
  /**
   * A-F3 outcome capture. Present only when a completion collected one — an absent
   * outcome and a null one mean different things (not asked vs. skipped), so this is
   * optional rather than nullable at the call site.
   */
  outcome?: ObligationOutcome | undefined;
}

export function useUpdateObligationStatus(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, outcome }: ObligationStatusUpdate) => apiFetch<ObligationView>(`/obligations/${encodeURIComponent(id)}`, {
      method: "PATCH", householdId, body: outcome === undefined ? { status } : { status, outcome },
    }),
    onSuccess: async (row) => {
      qc.setQueryData(queryKeys.obligation(householdId, row.id), row);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["obligations", householdId] }),
        qc.invalidateQueries({ queryKey: queryKeys.summary(householdId) }),
        qc.invalidateQueries({ queryKey: queryKeys.timeline(householdId) }),
      ]);
    },
  });
}

export function useMarkNotificationsRead(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await new Promise((r) => setTimeout(r, 150));
      return ids;
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: queryKeys.notifications(householdId) });
      const previous = qc.getQueryData<NotificationView[]>(queryKeys.notifications(householdId));
      qc.setQueryData<NotificationView[]>(queryKeys.notifications(householdId), (old) =>
        old?.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.notifications(householdId), ctx.previous);
    },
  });
}
