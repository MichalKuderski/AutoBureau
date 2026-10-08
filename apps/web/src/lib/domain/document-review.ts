"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, newIdempotencyKey } from "@/lib/api-client";

export const protectedDenial = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);
export const concealedDenial = (error: unknown) => error instanceof ApiError && [403, 404].includes(error.status);

/** These are distinct query roots, not descendants of ['household', id]. */
export async function invalidateDocumentReview(client: QueryClient, householdId: string, refetchType: "active" | "none" = "active") {
  await Promise.all(["documents", "document", "document-quota", "summary", "obligations", "obligation", "items", "item", "timeline", "household"]
    .map(root => client.invalidateQueries({ queryKey: [root, householdId], refetchType })));
}

interface ActionState { intent: ReviewIntent | null; pending: boolean; refused?: boolean }

// These exact domain refusals are thrown before a write by document-result-action
// and the cancel route. Other 409s (notably idempotency in-flight) remain uncertain.
const REFUSALS = new Set([
  "There's no processing room left this month, so this reading stays held. Nothing was charged.",
  "This reading has already been filed or discarded.",
  "This reading can't be changed right now. Nothing was charged.",
  "Processing has already started, so it can't be stopped now.",
]);

export interface ReviewIntent { path: string; body: Record<string, string>; idempotencyKey: string }

/** Mounted inside a scope-keyed component. An uncertain write permits only the exact
 * original retry until a fresh authoritative read observes a terminal state. A read
 * of the old state alone cannot prove that an in-flight request won't commit later. */
export function useDocumentReview<T extends { documentId: string; resultId?: string | null }>(householdId: string, documentId: string, kind: "result" | "work", terminal: (value: T) => boolean) {
  const client = useQueryClient();
  const key = ["household", householdId, `document-${kind}`, documentId];
  const path = `/documents/${encodeURIComponent(documentId)}/${kind}`;
  const alive = useRef(true);
  const actionKey = ["document-review-action", householdId, documentId];
  const shared = useQuery<ActionState>({ queryKey: actionKey, queryFn: async () => ({ intent: null, pending: false }),
    enabled: false, initialData: { intent: null, pending: false }, gcTime: Infinity });
  const state = (): ActionState => client.getQueryData<ActionState>(actionKey) ?? { intent: null, pending: false };
  const save = (value: ActionState) => client.setQueryData(actionKey, value);
  const controller = useRef<AbortController | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [denial, setDenial] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const query = useQuery<T | null>({ queryKey: key, retry: false,
    queryFn: async ({ signal }) => {
      try { return await apiFetch<T>(path, { householdId, signal }); }
      catch (cause) {
        // Clear protected cache even when a background refetch fails with stale data.
        if (protectedDenial(cause)) client.setQueryData(key, null);
        throw cause;
      }
    },
  });
  const refresh = (refetchType: "active" | "none") => {
    // Invalidation marks every root stale immediately. Background reads may remain
    // in flight; their completion is neither an action lock nor proof of its outcome.
    void invalidateDocumentReview(client, householdId, refetchType).catch(() => {});
  };
  const reconcile = async (refreshOnResolution = false) => {
    const originalIntent = state().intent;
    const next = await query.refetch();
    if (!alive.current || state().intent !== originalIntent) return;
    const matchesIntent = next.data?.documentId === documentId
      && (!originalIntent?.body.resultId || next.data.resultId === originalIntent.body.resultId);
    if (!next.isError && next.data && matchesIntent && (terminal(next.data) || state().refused) && (!state().intent || (state().intent!.path.includes("/result/") ? kind === "result" : kind === "work"))) {
      save({ intent: null, pending: state().pending });
      if (terminal(next.data)) setError(null);
      if (originalIntent && refreshOnResolution) refresh("active");
    }
    setRevision(v => v + 1);
  };
  const run = async (next: ReviewIntent) => {
    if (state().pending || !alive.current || denial || protectedDenial(query.error)) return;
    const wasUncertain = Boolean(state().intent);
    save({ intent: next, pending: true }); setError(null);
    controller.current = new AbortController();
    let accessDenied = false;
    try {
      // Deliberately no automatic POST replay: even a response-stage failure may
      // follow a committed write. Reconcile before offering the same-key retry.
      await apiFetch<T>(next.path, { method: "POST", householdId, body: next.body,
        idempotencyKey: next.idempotencyKey, signal: controller.current.signal });
      if (!alive.current) return;
      await reconcile();
    } catch (cause) {
      // assertCan rejects this exact role denial before invoking the handler. A
      // generic 403 can instead follow a committed write (session-policy drift),
      // and even a pre-write denial on retry cannot settle an earlier attempt.
      if (!wasUncertain && cause instanceof ApiError && cause.status === 403
        && cause.message === "Your role does not allow that." && state().intent === next) {
        save({ intent: null, pending: true });
      }
      if (!alive.current) return;
      setError(cause);
      if (cause instanceof ApiError && cause.status === 409 && REFUSALS.has(cause.message)) save({ ...state(), refused: true });
      if (protectedDenial(cause)) {
        accessDenied = true; setDenial(cause); client.setQueryData(key, null);
      } else await reconcile();
    } finally {
      // Navigation suppresses focus/local state work, not invalidation of a write
      // that may already have committed in the captured household.
      if (client.getQueryState(actionKey)) save({ ...state(), pending: false });
      if (alive.current) setRevision(v => v + 1);
      refresh(alive.current && !accessDenied ? "active" : "none");
    }
  };
  const ownsIntent = !shared.data.intent || (shared.data.intent.path.includes("/result/") ? kind === "result" : kind === "work");
  return { query, ownsIntent, pending: shared.data.pending, uncertain: Boolean(shared.data.intent), error, denial, revision,
    act: (suffix: string, body: Record<string, string>) => {
      if (state().intent || state().pending || denial) return;
      void run({ path: `/documents/${encodeURIComponent(documentId)}/${suffix}`, body, idempotencyKey: newIdempotencyKey() });
    },
    retry: () => { const intent = state().intent; if (intent && ownsIntent) void run(intent); },
    check: () => { if (!state().pending) void reconcile(true); },
  };
}
