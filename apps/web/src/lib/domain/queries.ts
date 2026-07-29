"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardSummary,
  DocumentView,
  ItemView,
  NotificationView,
  ObligationView,
  TimelineEntry,
} from "./types";
import * as fixtures from "./fixtures";

/**
 * The domain data layer.
 *
 * Every screen consumes these hooks and nothing else — no component calls `fetch`.
 * Today they resolve from fixtures; in Phase 2D each body is replaced with an
 * `apiFetch` call against `/v1` and the screens do not change, because the signatures
 * and the shapes are already the production ones. That is the entire point of paying
 * the contracts tax up front (ADR-008).
 *
 * Query keys are structured `[entity, householdId, params]` so a household switch or
 * a targeted invalidation never has to guess at string prefixes.
 */

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
  timeline: (h: string) => ["timeline", h] as const,
  notifications: (h: string) => ["notifications", h] as const,
};

export interface ObligationFilters {
  status?: string[];
  memberId?: string | null;
  direction?: "owed_by_household" | "owed_to_household" | null;
  dueWithinDays?: number | null;
  search?: string;
}

export interface ItemFilters {
  kind?: string | null;
  memberId?: string | null;
  status?: string | null;
  search?: string;
}

export interface DocumentFilters {
  status?: string | null;
  docType?: string | null;
  memberId?: string | null;
  search?: string;
}

function matchesSearch(haystack: Array<string | null | undefined>, needle?: string): boolean {
  if (!needle) return true;
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => h?.toLowerCase().includes(q));
}

export function useSummary(householdId: string) {
  return useQuery<DashboardSummary>({
    queryKey: queryKeys.summary(householdId),
    queryFn: () => resolve(fixtures.SUMMARY),
  });
}

export function useObligations(householdId: string, filters: ObligationFilters = {}) {
  return useQuery<ObligationView[]>({
    queryKey: queryKeys.obligations(householdId, filters),
    queryFn: () =>
      resolve(
        fixtures.OBLIGATIONS.filter((o) => {
          if (filters.status?.length && !filters.status.includes(o.status)) return false;
          if (filters.memberId && o.member_id !== filters.memberId) return false;
          if (filters.direction && o.direction !== filters.direction) return false;
          if (
            filters.dueWithinDays != null &&
            (o.days_until < 0 || o.days_until > filters.dueWithinDays)
          ) {
            return false;
          }
          return matchesSearch([o.title, o.item_name, o.member_name], filters.search);
        }).sort((a, b) => a.priority - b.priority || a.days_until - b.days_until),
      ),
  });
}

export function useObligation(householdId: string, id: string) {
  return useQuery<ObligationView | undefined>({
    queryKey: queryKeys.obligation(householdId, id),
    queryFn: () => resolve(fixtures.OBLIGATIONS.find((o) => o.id === id)),
  });
}

export function useItems(householdId: string, filters: ItemFilters = {}) {
  return useQuery<ItemView[]>({
    queryKey: queryKeys.items(householdId, filters),
    queryFn: () =>
      resolve(
        fixtures.ITEMS.filter((i) => {
          if (filters.kind && i.kind !== filters.kind) return false;
          if (filters.memberId && i.member_id !== filters.memberId) return false;
          if (filters.status && i.status !== filters.status) return false;
          return matchesSearch([i.name, i.vendor_name, i.member_name], filters.search);
        }),
      ),
  });
}

export function useItem(householdId: string, id: string) {
  return useQuery<ItemView | undefined>({
    queryKey: queryKeys.item(householdId, id),
    queryFn: () => resolve(fixtures.ITEMS.find((i) => i.id === id)),
  });
}

export function useDocuments(householdId: string, filters: DocumentFilters = {}) {
  return useQuery<DocumentView[]>({
    queryKey: queryKeys.documents(householdId, filters),
    queryFn: () =>
      resolve(
        fixtures.DOCUMENTS.filter((d) => {
          if (filters.status && d.status !== filters.status) return false;
          if (filters.docType && d.doc_type !== filters.docType) return false;
          return matchesSearch([d.title, d.member_name, d.doc_type], filters.search);
        }).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      ),
  });
}

export function useDocument(householdId: string, id: string) {
  return useQuery<DocumentView | undefined>({
    queryKey: queryKeys.document(householdId, id),
    queryFn: () => resolve(fixtures.DOCUMENTS.find((d) => d.id === id)),
  });
}

export function useTimeline(householdId: string) {
  return useQuery<TimelineEntry[]>({
    queryKey: queryKeys.timeline(householdId),
    queryFn: () => resolve(fixtures.TIMELINE),
  });
}

export function useNotifications(householdId: string) {
  return useQuery<NotificationView[]>({
    queryKey: queryKeys.notifications(householdId),
    queryFn: () => resolve(fixtures.NOTIFICATIONS),
  });
}

/**
 * Mutations use optimistic updates with rollback. In an administrative product the
 * user is often on a phone in a waiting room; the UI must respond instantly and
 * repair itself if the server disagrees.
 */
export function useUpdateObligationStatus(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ObligationView["status"] }) => {
      await new Promise((r) => setTimeout(r, 260));
      return { id, status };
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["obligations", householdId] });
      const previous = qc.getQueriesData<ObligationView[]>({
        queryKey: ["obligations", householdId],
      });
      qc.setQueriesData<ObligationView[]>({ queryKey: ["obligations", householdId] }, (old) =>
        old?.map((o) => (o.id === id ? { ...o, status } : o)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["obligations", householdId] });
      void qc.invalidateQueries({ queryKey: queryKeys.summary(householdId) });
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
