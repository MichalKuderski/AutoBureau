"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { concealedDenial, useDocumentReview } from "@/lib/domain/document-review";
import { useHousehold } from "@/providers/household-provider";

export interface DocumentWork {
  documentId: string;
  state: "checking" | "waiting" | "working" | "done" | "held" | "stopped" | "failed" | "rejected" | "none";
  cancellable: boolean;
  reviewAt: string | null;
}
const COPY: Record<DocumentWork["state"], string | null> = {
  checking: "We're checking this file for safety before anything else happens.",
  waiting: "Waiting its turn to be read. Nothing has been counted toward your allowance yet.",
  held: "On hold — it wasn't read before its review date. Nothing has been counted toward your allowance.",
  working: "Being read now. This can't be stopped part-way; it only counts once it's read successfully.",
  done: null,
  stopped: "Processing was stopped. The file is still stored with your household and included in your exports.",
  failed: "We couldn't read this file. It wasn't counted toward your allowance.",
  rejected: "This file didn't pass our safety check, so it won't be read.",
  none: null,
};

/**
 * Processing state for one document, with the one owner action that is always safe:
 * stopping work that hasn't started. The database decides eligibility (a reserved or
 * started read is never interrupted, because its result could otherwise be stranded);
 * this panel only mirrors that answer. Stopping keeps the stored original — it is not
 * deletion, and the copy never implies it frees space or erases anything.
 */
export function DocumentWorkPanel({ documentId }: { documentId: string }) {
  const { household } = useHousehold();
  return <ScopedWorkPanel key={`${household.id}:${documentId}:${household.role}`} householdId={household.id} documentId={documentId} canStop={household.role !== "viewer"} />;
}
function ScopedWorkPanel({ householdId, documentId, canStop }: { householdId: string; documentId: string; canStop: boolean }) {
  const action = useDocumentReview<DocumentWork>(householdId, documentId, "work", v => v.state === "stopped" || v.state === "working" || v.state === "done");
  const work = action.query;
  const statusRef = useRef<HTMLParagraphElement>(null);
  const retryRef = useRef<HTMLDivElement>(null);
  const statusFocus = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const stopRef = useRef<HTMLButtonElement>(null);
  // The trigger is re-rendered when the inline confirmation closes; focus it then,
  // rather than letting focus fall back to the document body.
  const returnFocus = useRef(false);
  useEffect(() => { if (returnFocus.current && !confirming) { stopRef.current?.focus(); returnFocus.current = false; } }, [confirming]);
  useEffect(() => { if (statusFocus.current && !action.pending && !work.isFetching) { (statusRef.current ?? retryRef.current)?.focus(); statusFocus.current = false; } }, [action.pending, action.revision, work.isFetching]);
  const failure = action.denial ?? work.error;
  if (concealedDenial(failure)) return null;
  if (failure) return <div ref={retryRef} tabIndex={-1}><ErrorState {...describeError(failure)} onRetry={() => { statusFocus.current = true; action.check(); }} /></div>;
  if (work.isPending || !work.data) return <p role="status" className="text-sm text-ink-secondary">Loading processing status…</p>;
  const copy = COPY[work.data.state];
  return (
    <div ref={retryRef} tabIndex={-1}><section aria-label="Processing" aria-busy={action.pending || work.isFetching} className="mb-4 flex flex-col gap-3">
      {!action.pending && !action.uncertain && copy ? <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-ink-secondary">{copy}</p> : null}
      {action.error instanceof ApiError && !action.uncertain ? <Alert tone="warning" title="Action not completed">{action.error.message}</Alert> : null}
      {action.pending || action.uncertain ? <div role="status">
        <p ref={statusRef} tabIndex={-1}>{action.pending ? "Checking the outcome…" : "We couldn't confirm whether processing stopped. Check the status before making another decision."}</p>
        {action.error instanceof ApiError && action.error.status === 409 ? <p>{action.error.message}</p> : null}
        {!action.pending ? <div className="flex gap-2"><Button size="sm" onClick={() => { statusFocus.current = true; action.check(); }}>Check status</Button>
          {canStop && action.ownsIntent ? <Button size="sm" variant="secondary" onClick={() => { statusFocus.current = true; action.retry(); }}>Retry same action</Button> : null}</div> : null}
      </div> : null}
      {!action.pending && !action.uncertain && canStop && work.data.cancellable ? (
        confirming ? (
          <div role="group" aria-label="Confirm stopping processing" className="flex flex-col gap-2">
            <p className="text-sm text-ink">Stop reading this document? The file stays stored; you can't restart it from here.</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" autoFocus disabled={action.pending} onClick={() => { statusFocus.current = true; setConfirming(false); action.act("cancel", {}); }}>
                {action.pending ? "Stopping…" : "Stop processing"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { returnFocus.current = true; setConfirming(false); }}>Keep it</Button>
            </div>
          </div>
        ) : (
          <div><Button ref={stopRef} variant="secondary" size="sm" onClick={() => setConfirming(true)}>Stop processing…</Button></div>
        )
      ) : null}
    </section></div>
  );
}
