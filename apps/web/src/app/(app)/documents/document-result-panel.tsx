"use client";

import { DOCUMENT_REJECTION_LABELS, type DocumentRejectionReason } from "@autobureau/contracts";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { concealedDenial, useDocumentReview } from "@/lib/domain/document-review";
import { useHousehold } from "@/providers/household-provider";

export interface DocumentResultView {
  documentId: string; resultId: string | null;
  state: "none" | "awaiting-review" | "action-required" | "capacity-unavailable" | "applied" | "discarded" | "held"
    | "deletion-fenced" | "operator-review-required" | "incompatible-result";
  resultPeriodStart: string | null; currentPeriodStart: string; chargedPeriodStart: string | null;
  capacity: { used: number; limit: number } | null; canApply: boolean; canDiscard: boolean;
  rejectionReason?: DocumentRejectionReason | null;
  evidence?: { kind: "public-synthetic-deadline"; dueDate: string; page: 1 } | null;
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
  useEffect(() => {
    if (household.role !== "owner") {
      const queryKey = ["household", household.id, "document-result", documentId];
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    }
  }, [client, household.id, household.role, documentId]);
  if (household.role !== "owner") return null;
  return <ScopedResultPanel key={`${household.id}:${documentId}:${household.role}`} householdId={household.id} documentId={documentId} />;
}
function ScopedResultPanel({ householdId, documentId }: { householdId: string; documentId: string }) {
  const [reason, setReason] = useState<DocumentRejectionReason | "">("");
  const [confirm, setConfirm] = useState<null | "apply" | "discard">(null);
  const applyRef = useRef<HTMLButtonElement>(null), discardRef = useRef<HTMLButtonElement>(null), statusRef = useRef<HTMLParagraphElement>(null);
  const retryRef = useRef<HTMLDivElement>(null);
  const confirmedResult = useRef<{ resultId: string | null; period: string } | null>(null);
  const pendingFocus = useRef<null | "apply" | "discard" | "status">(null);
  const action = useDocumentReview<DocumentResultView>(householdId, documentId, "result", v => v.state === "applied" || v.state === "discarded");
  const result = action.query;
  useEffect(() => {
    const target = pendingFocus.current === "apply" ? applyRef.current : pendingFocus.current === "discard" ? discardRef.current
      : pendingFocus.current === "status" ? (statusRef.current ?? retryRef.current) : null;
    if (target && !confirm && !action.pending && !result.isFetching) { target.focus(); pendingFocus.current = null; }
  }, [confirm, result.data, action.revision, action.pending, result.isFetching]);
  const failure = action.denial ?? result.error;
  if (concealedDenial(failure)) return null;
  if (failure) return <div ref={retryRef} tabIndex={-1}><ErrorState {...describeError(failure)} onRetry={() => { pendingFocus.current = "status"; action.check(); }} /></div>;
  if (result.isPending || !result.data) return <p role="status">Loading reading status…</p>;
  const v = result.data;
  if (v.state === "none" || v.state === "deletion-fenced") return null;
  const cap = v.capacity, current = month(v.currentPeriodStart), original = month(v.resultPeriodStart);

  const choose = (kind: "apply" | "discard") => {
    confirmedResult.current = { resultId: v.resultId, period: v.currentPeriodStart };
    setReason("");
    setConfirm(kind);
  };
  const cancel = (kind: "apply" | "discard") => { pendingFocus.current = kind; setReason(""); setConfirm(null); };
  return (
    <div ref={retryRef} tabIndex={-1}><section aria-label="Reading" aria-busy={action.pending || result.isFetching} className="mb-4 flex flex-col gap-3">
      {!action.pending && !action.uncertain ? <>
      {v.evidence ? <section aria-label="Date and source" className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Public synthetic deadline notice</h3>
          <dl><dt className="mt-2 text-xs text-ink-secondary">{v.state === "applied" ? "Filed due date" : "Proposed due date"}</dt>
            <dd><time dateTime={v.evidence.dueDate}>{new Date(`${v.evidence.dueDate}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })}</time></dd></dl>
          {v.state !== "applied" ? <p className="mt-2 text-xs text-ink-secondary">Check the source before filing. Corrections are not available yet.</p> : null}
        </div>
        <details key={v.resultId}>
          <summary className="cursor-pointer text-sm text-accent">View source text · page 1</summary>
          <blockquote className="mt-2 border-l-2 border-accent pl-3 text-sm">
            <p>PELLUM PUBLIC DEADLINE NOTICE</p>
            <p>Due: <mark>{v.evidence.dueDate}</mark></p>
          </blockquote>
          <p className="mt-2 text-xs text-ink-secondary">Source text matches the saved reading. The stored PDF is not opened here.</p>
        </details>
      </section> : null}
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
          You discarded this reading. Discarding adds no charge and does not refund any earlier charge. Your original document is still stored with your household.
          {v.rejectionReason ? <> Reason: {DOCUMENT_REJECTION_LABELS[v.rejectionReason]}.</> : null}
        </p>
      ) : (
        <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-ink-secondary">We need to check this reading before it can be used. Nothing has been counted.</p>
      )}
      </> : null}
      {action.error instanceof ApiError && !action.uncertain ? <Alert tone="warning" title="Action not completed">{action.error.message}</Alert> : null}
      {action.pending || action.uncertain ? <div role="status">
        <p ref={statusRef} tabIndex={-1}>{action.pending ? "Checking the outcome…" : "We couldn't confirm the outcome. The action may have completed. Check the status before making another decision."}</p>
        {action.error instanceof ApiError && action.error.status === 409 ? <p>{action.error.message}</p> : null}
        {!action.pending ? <div className="flex gap-2"><Button size="sm" onClick={() => { pendingFocus.current = "status"; action.check(); }}>Check status</Button>
          {action.ownsIntent ? <Button size="sm" variant="secondary" onClick={() => { pendingFocus.current = "status"; action.retry(); }}>Retry same action</Button> : null}</div> : null}
      </div> : null}
      {!action.pending && !action.uncertain && confirm ? (
        <div role="group" aria-label={confirm === "apply" ? "Confirm applying this reading" : "Confirm discarding this reading"} className="flex flex-col gap-2">
          <p className="text-sm text-ink">
            {confirm === "apply"
              ? `Apply this reading in ${current}? It will be filed and count as 1 of your ${cap?.limit} documents for ${current}.`
              : "Reject this reading? Choose a reason. It will not be filed; discarding adds no charge and does not refund an earlier charge. Your original document stays stored."}
          </p>
          {confirm === "discard" ? <label className="flex flex-col gap-1 text-sm">
            Reason for discarding
            <select autoFocus required value={reason} onChange={e => setReason(e.target.value as DocumentRejectionReason | "")} className="rounded-md border border-line bg-surface p-2 text-ink">
              <option value="">Choose a reason</option>
              {Object.entries(DOCUMENT_REJECTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label> : null}
          <div className="flex gap-2">
            <Button variant={confirm === "apply" ? "primary" : "danger"} size="sm" autoFocus={confirm === "apply"} disabled={action.pending || (confirm === "discard" && !reason)} onClick={() => { pendingFocus.current = "status"; setConfirm(null);
              // A background refresh must not substitute a new result or charging
              // month into a confirmation the owner opened for an earlier one.
              if (v.resultId && confirmedResult.current?.resultId === v.resultId && confirmedResult.current.period === v.currentPeriodStart) {
                if (confirm === "discard" && reason) action.act("result/discard", { resultId: v.resultId, reason });
                else if (confirm === "apply") action.act("result/apply", { resultId: v.resultId });
              } }}>
              {action.pending ? "Working…" : confirm === "apply" ? `Apply in ${current}` : "Discard reading"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cancel(confirm)}>Cancel</Button>
          </div>
        </div>
      ) : !action.pending && !action.uncertain && (v.canApply || v.canDiscard) ? (
        <div className="flex flex-wrap gap-2">
          {v.canApply ? <Button ref={applyRef} variant="primary" size="sm" onClick={() => choose("apply")}>{v.state === "action-required" ? "Apply this month…" : "Approve and file…"}</Button> : null}
          {v.canDiscard ? <Button ref={discardRef} variant="secondary" size="sm" onClick={() => choose("discard")}>Discard reading…</Button> : null}
        </div>
      ) : null}
    </section></div>
  );
}
