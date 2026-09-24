"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useHousehold } from "@/providers/household-provider";

interface Latest { requestId: string; requestedAt: string; expiresAt: string; state: "requested" | "ready" | "revoked"; complete: boolean; bytes: number | null }
interface ExportStatus { available: boolean; latest: Latest | null }
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
const size = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Export as a working flow wherever reviewed storage exists, and an honest "not available
 * here" everywhere else. The archive's manifest — not this page — is the authority on what
 * was included, so the copy only repeats its completeness verdict, never embellishes it.
 */
export function ExportCard() {
  const { household } = useHousehold();
  const client = useQueryClient();
  const key = ["household", household.id, "exports"];
  const status = useQuery({ queryKey: key, queryFn: () => apiFetch<ExportStatus>(`/households/${household.id}/exports`, { householdId: household.id }) });
  const refresh = async (latest: Latest | null) => { client.setQueryData<ExportStatus>(key, s => ({ available: s?.available ?? true, latest })); await client.invalidateQueries({ queryKey: key }); };
  const prepare = useMutation({
    mutationFn: () => apiFetch<Latest>(`/households/${household.id}/exports`, { method: "POST", householdId: household.id, body: { requestId: crypto.randomUUID() } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (requestId: string) => apiFetch<Latest>(`/households/${household.id}/exports/revoke`, { method: "POST", householdId: household.id, body: { requestId } }),
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: async (latest: Latest) => {
      const response = await fetch(`/v1/households/${household.id}/exports/${latest.requestId}`, { headers: { "X-Household-Id": household.id }, credentials: "same-origin" });
      if (!response.ok) throw new ApiError(await response.json().catch(() => ({ type: "about:blank", title: "Error", status: response.status })));
      const url = URL.createObjectURL(await response.blob()), a = document.createElement("a");
      a.href = url; a.download = `pellum-export-${latest.requestId.slice(0, 8)}.zip`; a.click(); URL.revokeObjectURL(url);
    },
  });
  const failure = (e: unknown) => e instanceof ApiError && e.status === 403
    ? "For your security, sign in again (and confirm your authenticator code if you use one), then try again."
    : e instanceof ApiError && e.problem.detail ? e.problem.detail : "That didn't work. Nothing was shared — please try again.";
  const latest = status.data?.latest ?? null, ready = latest?.state === "ready";
  const error = prepare.error ?? remove.error ?? download.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Export everything</CardTitle>
        <CardDescription>Your original documents plus every record we've built from them, in open formats.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.isError ? <Alert tone="critical" title="Couldn't load export status">{failure(status.error)}</Alert> : null}
        {error ? <Alert tone="critical" title="Export problem">{failure(error)}</Alert> : null}
        {ready && latest ? (
          <Alert tone={latest.complete ? "success" : "warning"} title={latest.complete ? "Your export is ready" : "Your export is ready, with gaps"}>
            {latest.complete
              ? "Everything we hold for this household is included. "
              : "Some items couldn't be included — manifest.json in the download lists each one and why. "}
            {latest.bytes ? `ZIP, ${size(latest.bytes)}. ` : ""}Available until {when(latest.expiresAt)}.
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {ready && latest ? (
            <>
              <Button variant="primary" disabled={download.isPending} onClick={() => download.mutate(latest)}>
                <Icon.Upload className="size-4 rotate-180" />{download.isPending ? "Downloading…" : "Download export"}
              </Button>
              <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(latest.requestId)}>Delete this export</Button>
            </>
          ) : (
            <Button variant="secondary" disabled={!status.data?.available || prepare.isPending} onClick={() => prepare.mutate()}>
              <Icon.Upload className="size-4 rotate-180" />{prepare.isPending ? "Preparing…" : "Request export"}
            </Button>
          )}
        </div>
        {status.data && !status.data.available ? <p className="text-xs text-ink-tertiary">Not available yet.</p> : null}
        {status.data?.available && !ready ? <p className="text-xs text-ink-tertiary">Preparing asks you to confirm it's you. Downloads expire after 72 hours.</p> : null}
      </CardContent>
    </Card>
  );
}
