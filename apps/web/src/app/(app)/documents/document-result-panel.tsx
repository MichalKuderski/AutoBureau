"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useHousehold } from "@/providers/household-provider";

export interface DocumentResultView {
  documentId: string; resultId: string | null;
  state: "none" | "awaiting-review" | "action-required" | "capacity-unavailable" | "applied" | "discarded" | "held"
    | "deletion-fenced" | "operator-review-required" | "incompatible-result";
  resultPeriodStart: string | null; currentPeriodStart: string; chargedPeriodStart: string | null;
  capacity: { used: number; limit: number } | null; canApply: boolean; canDiscard: boolean;
}
/** Entitlement months are UTC calendar months (PRD §21.2), so they are named in UTC. */
const month = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

/**
 * PRD §21.3: what happened to this document's reading, and the owner's two explicit
 * choices for a finished-but-unfiled one. Every sentence is derived from the durable state
 * the server returns: nothing here says "filed", "charged" or "deleted" unless the
 * database recorded it. Only owners receive this view (403 renders nothing).
 */
export function DocumentResultPanel({ documentId }: { documentId: string }) {
  const { household } = useHousehold();
  const client = useQueryClient();
  const key = ["household", household.id, "document-result", documentId];
  const [confirm, setConfirm] = useState<null | "apply" | "discard">(null);
  const applyRef = useRef<HTMLButtonElement>(null), discardRef = useRef<HTMLButtonElement>(null), statusRef = useRef<HTMLParagraphElement>(null);
  // Focus follows the owner's action: back to the trigger on cancel, to the new status after success.
  const pendingFocus = useRef<null | "apply" | "discard" | "status">(null);
  const result = useQuery({
    queryKey: key, retry: false,
    queryFn: () => apiFetch<DocumentResultView>(`/documents/${documentId}/result`, { householdId: household.id }),
  });
  const act = useMutation({
    mutationFn: (kind: "apply" | "discard") => apiFetch<DocumentResultView>(`/documents/${documentId}/result/${kind}`,
      { method: "POST", householdId: household.id, body: { resultId: result.data!.resultId } }),
    onSuccess: async (next) => { pendingFocus.current = "status"; setConfirm(null); client.setQueryData(key, next); await client.invalidateQueries({ queryKey: ["household", household.id] }); },
    onError: async () => { setConfirm(null); await client.invalidateQueries({ queryKey: key }); },
  });
  useEffect(() => {
    const target = pendingFocus.current === "apply" ? applyRef.current : pendingFocus.current === "discard" ? discardRef.current
      : pendingFocus.current === "status" ? statusRef.current : null;
    if (target && !confirm) { target.focus(); pendingFocus.current = null; }
  }, [confirm, result.data]);
  if (result.isPending || result.isError) return null; // not an owner, or no result: nothing to decide
  const v = result.data;
  if (v.state === "none" || v.state === "deletion-fenced") return null;
  const cap = v.capacity, current = month(v.currentPeriodStart), original = month(v.resultPeriodStart);
  const failure = act.error instanceof ApiError && act.error.status === 409 ? act.error.message : "That didn't work. Nothing was changed — please try again.";
  const cancel = (kind: "apply" | "discard") => { pendingFocus.current = kind; setConfirm(null); };
  return (
    <section aria-label="Reading" className="mb-4 flex flex-col gap-3">
      {v.state === "action-required" ? (
        <Alert tone="warning" title="Action required">
          We read this document in {original}, but it wasn't filed before that month ended, so it hasn't been counted.
          Applying it now uses 1 of your {cap?.limit} documents for {current} ({cap?.used} used so far) — we won't read it again.
          Or discard the reading. Your original document stays with your household either way.
        </Alert>
      ) : v.state === "capacity-unavailable" ? (
        <Alert tone="warning" title="No room this month">
          You've used all {cap?.limit} documents for {current}. This reading stays here — not filed and not counted — until there's
          room or you discard it. Your original document stays with your household.
        </Alert>
      ) : v.state === "awaiting-review" ? (
        <Alert tone="info" title="Ready for your review">
          Filing this reading uses the document slot already set aside for it in {current}.
        </Alert>
      ) : v.state === "held" ? (
        <Alert tone="warning" title="On hold">
          This reading can't be filed because the document's review date has passed. Nothing has been counted. You can discard it.
        </Alert>
      ) : v.state === "applied" ? (
        <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-ink-secondary">Filed and counted in {month(v.chargedPeriodStart)}.</p>
      ) : v.state === "discarded" ? (
        <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-ink-secondary">
          You discarded this reading. It wasn't filed or counted, and your original document is still stored with your household.
        </p>
      ) : (
        <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-ink-secondary">We need to check this reading before it can be used. Nothing has been counted.</p>
      )}
      {act.isError ? <Alert tone="critical" title="Nothing was changed">{failure}</Alert> : null}
      {confirm ? (
        <div role="group" aria-label={confirm === "apply" ? "Confirm applying this reading" : "Confirm discarding this reading"} className="flex flex-col gap-2">
          <p className="text-sm text-ink">
            {confirm === "apply"
              ? `Apply this reading in ${current}? It will be filed and count as 1 of your ${cap?.limit} documents for ${current}.`
              : "Discard this reading? It won't be filed or counted. Your original document stays stored."}
          </p>
          <div className="flex gap-2">
            <Button variant={confirm === "apply" ? "primary" : "danger"} size="sm" autoFocus disabled={act.isPending} onClick={() => act.mutate(confirm)}>
              {act.isPending ? "Working…" : confirm === "apply" ? `Apply in ${current}` : "Discard reading"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cancel(confirm)}>Cancel</Button>
          </div>
        </div>
      ) : v.canApply || v.canDiscard ? (
        <div className="flex flex-wrap gap-2">
          {v.canApply ? <Button ref={applyRef} variant="primary" size="sm" onClick={() => setConfirm("apply")}>{v.state === "action-required" ? "Apply this month…" : "Approve and file…"}</Button> : null}
          {v.canDiscard ? <Button ref={discardRef} variant="secondary" size="sm" onClick={() => setConfirm("discard")}>Discard reading…</Button> : null}
        </div>
      ) : null}
    </section>
  );
}
