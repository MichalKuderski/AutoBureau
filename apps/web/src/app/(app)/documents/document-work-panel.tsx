"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api-client";
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
  const client = useQueryClient();
  const key = ["household", household.id, "document-work", documentId];
  const [confirming, setConfirming] = useState(false);
  const stopRef = useRef<HTMLButtonElement>(null);
  // The trigger is re-rendered when the inline confirmation closes; focus it then,
  // rather than letting focus fall back to the document body.
  const returnFocus = useRef(false);
  useEffect(() => { if (returnFocus.current && !confirming) { stopRef.current?.focus(); returnFocus.current = false; } }, [confirming]);
  const work = useQuery({ queryKey: key, queryFn: () => apiFetch<DocumentWork>(`/documents/${documentId}/work`, { householdId: household.id }) });
  const stop = useMutation({
    mutationFn: () => apiFetch<DocumentWork>(`/documents/${documentId}/cancel`, { method: "POST", householdId: household.id, body: {} }),
    onSuccess: async (next) => { setConfirming(false); client.setQueryData(key, next); await client.invalidateQueries({ queryKey: ["household", household.id] }); },
    onError: async () => { setConfirming(false); await client.invalidateQueries({ queryKey: key }); },
  });
  if (work.isPending) return <p role="status" className="text-sm text-ink-secondary">Loading processing status…</p>;
  if (work.isError) return <p role="status" className="text-sm text-ink-secondary">Processing status is unavailable right now.</p>;
  const copy = COPY[work.data.state];
  const failure = stop.error instanceof ApiError && stop.error.status === 409
    ? "Reading has already started, so it can't be stopped now."
    : stop.error instanceof ApiError && stop.error.status === 403
      ? "Only people who can add documents can stop processing."
      : "That didn't work. Nothing was changed — please try again.";
  return (
    <section aria-label="Processing" className="mb-4 flex flex-col gap-3">
      {copy ? <p role="status" className="text-sm text-ink-secondary">{copy}</p> : null}
      {stop.isError ? <Alert tone="critical" title="Processing wasn't stopped">{failure}</Alert> : null}
      {work.data.cancellable ? (
        confirming ? (
          <div role="group" aria-label="Confirm stopping processing" className="flex flex-col gap-2">
            <p className="text-sm text-ink">Stop reading this document? The file stays stored; you can't restart it from here.</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" autoFocus disabled={stop.isPending} onClick={() => stop.mutate()}>
                {stop.isPending ? "Stopping…" : "Stop processing"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { returnFocus.current = true; setConfirming(false); }}>Keep it</Button>
            </div>
          </div>
        ) : (
          <div><Button ref={stopRef} variant="secondary" size="sm" onClick={() => setConfirming(true)}>Stop processing…</Button></div>
        )
      ) : null}
    </section>
  );
}
