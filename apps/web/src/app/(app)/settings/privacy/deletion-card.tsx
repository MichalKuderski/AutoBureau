"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { TextInput } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useHousehold } from "@/providers/household-provider";

const PHRASE = "DELETE HOUSEHOLD";
interface DeletionStatus {
  request: null | { id: string; state: "grace" | "fenced" | "verifying" | "completed"; requestedAt: string; undoUntil: string; undoAvailable: boolean };
  finalReceiptIssuable: false;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

/**
 * Household deletion as a real, reversible-for-14-days workflow. Requesting deletion
 * erases nothing immediately: the database starts an undo window, after which a worker
 * fences and erases. The copy never implies erasure is complete or that a receipt exists
 * — provider and backup erasure are not independently verified (ADR-019), and saying
 * otherwise would be the kind of false promise this page exists to avoid.
 */
export function DeletionCard() {
  const { household } = useHousehold();
  const client = useQueryClient();
  const key = ["household", household.id, "deletion"];
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const status = useQuery({ queryKey: key, queryFn: () => apiFetch<DeletionStatus>(`/households/${household.id}/deletion`, { householdId: household.id }) });
  const done = async (next: DeletionStatus) => { client.setQueryData(key, next); await client.invalidateQueries({ queryKey: key }); };
  const request = useMutation({
    mutationFn: () => apiFetch<DeletionStatus>(`/households/${household.id}/deletion`, { method: "POST", householdId: household.id, body: { confirmation: PHRASE } }),
    onSuccess: async (next) => { setOpen(false); setTyped(""); await done(next); },
  });
  const undo = useMutation({
    mutationFn: (requestId: string) => apiFetch<DeletionStatus>(`/households/${household.id}/deletion/undo`, { method: "POST", householdId: household.id, body: { requestId } }),
    onSuccess: done,
  });
  const failure = (e: unknown) => e instanceof ApiError && e.status === 403
    ? "For your security, sign in again (and confirm your authenticator code if you use one), then try again."
    : "That didn't work. Nothing was changed — please try again.";
  const current = status.data?.request ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Delete your household</CardTitle>
        <CardDescription>Everything goes: documents, registry, reminders, and history.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.isError ? <Alert tone="critical" title="Couldn't load deletion status">{failure(status.error)}</Alert> : null}
        {current?.state === "grace" ? (
          <>
            <Alert tone="warning" title="Deletion scheduled">
              Requested {when(current.requestedAt)}. Nothing has been erased yet. You can undo until {when(current.undoUntil)};
              after that, erasure starts and can no longer be reversed.
            </Alert>
            {undo.isError ? <Alert tone="critical" title="Couldn't undo">{failure(undo.error)}</Alert> : null}
            <div>
              <Button variant="secondary" disabled={!current.undoAvailable || undo.isPending} onClick={() => undo.mutate(current.id)}>
                {undo.isPending ? "Undoing…" : "Undo deletion"}
              </Button>
            </div>
          </>
        ) : current ? (
          <Alert tone="warning" title="Deletion in progress">
            Erasure has started and can't be undone. We'll only confirm deletion is complete once it has been independently
            verified — including provider and backup copies — and we can't give you that confirmation yet.
          </Alert>
        ) : (
          <>
            <p className="text-sm text-ink-secondary">
              After you request deletion you have 14 days to change your mind. Then your household's data is erased.
              Copies held in backups and by service providers are removed on their own schedules; we'll tell you plainly
              what has and hasn't been confirmed.
            </p>
            <div>
              <Button variant="danger" disabled={status.isPending} onClick={() => setOpen(true)}>Delete household…</Button>
            </div>
          </>
        )}
      </CardContent>
      <Modal
        open={open}
        onClose={() => { setOpen(false); setTyped(""); request.reset(); }}
        title="Delete this household?"
        description={`This schedules deletion of ${household.name}. You'll have 14 days to undo it.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setOpen(false); setTyped(""); request.reset(); }}>Cancel</Button>
            <Button variant="danger" disabled={typed !== PHRASE || request.isPending} onClick={() => request.mutate()}>
              {request.isPending ? "Scheduling…" : "Schedule deletion"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {request.isError ? <Alert tone="critical" title="Deletion wasn't scheduled">{failure(request.error)}</Alert> : null}
          <TextInput label={`Type ${PHRASE} to confirm`} value={typed} autoComplete="off" spellCheck={false}
            onChange={(e) => setTyped(e.target.value)} />
        </div>
      </Modal>
    </Card>
  );
}
