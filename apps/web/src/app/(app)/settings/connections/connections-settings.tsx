"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useHousehold } from "@/providers/household-provider";

type State = "active" | "login-required" | "revoked" | "unlinking" | "removal-indeterminate" | "removed";
interface Connection { id: string; state: State; statusChangedAt: string; lastOutcome: string; refreshRequested: boolean; historyAfterRemoval: "delete" | "retain";
  accounts: Array<{ id: string; name: string; kind: string; currentCents: number | null; availableCents: number | null }> }
interface Connections { linkAvailable: boolean; connections: Connection[] }
const money = (c: number | null) => c === null ? "—" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const STATE: Record<State, { label: string; tone: "success" | "warning" | "critical" | "info" }> = {
  active: { label: "Connected", tone: "success" },
  "login-required": { label: "Needs you to sign in again at your bank", tone: "warning" },
  revoked: { label: "Access was withdrawn at your bank", tone: "warning" },
  unlinking: { label: "Disconnecting — syncing has stopped", tone: "info" },
  "removal-indeterminate": { label: "Disconnect requested — we couldn't confirm it with the provider yet", tone: "warning" },
  removed: { label: "Disconnected", tone: "info" },
};

/**
 * Financial connections: read-only, consent-first, and reversible. Linking needs the
 * provider's Link flow and an isolated runtime that are not active, so "Connect" is
 * honestly unavailable. Disconnect stops syncing at once; the owner decides whether the
 * history we imported is deleted (the default) or kept.
 */
export function ConnectionsSettings() {
  const { household } = useHousehold();
  const client = useQueryClient();
  const key = ["household", household.id, "financial-connections"];
  const [target, setTarget] = useState<Connection | null>(null);
  const [history, setHistory] = useState<"delete" | "retain">("delete");
  // Focus moves once the dialog has closed and the list re-rendered; a ref (not state)
  // carries the request so the effect never sets state itself.
  const returnFocus = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const data = useQuery({ queryKey: key, queryFn: () => apiFetch<Connections>(`/households/${household.id}/financial-connections`, { householdId: household.id }) });
  const update = (next: Connections) => { client.setQueryData(key, next); };
  const disconnect = useMutation({
    mutationFn: (c: Connection) => apiFetch<Connections>(`/households/${household.id}/financial-connections/${c.id}/unlink`, { method: "POST", householdId: household.id, body: { history } }),
    onSuccess: (next) => { update(next); returnFocus.current = true; setTarget(null); },
  });
  const reconnect = useMutation({
    mutationFn: (c: Connection) => apiFetch<Connections>(`/households/${household.id}/financial-connections/${c.id}/reconnect`, { method: "POST", householdId: household.id, body: {} }),
    onSuccess: update,
  });
  useEffect(() => { if (returnFocus.current && target === null) { headingRef.current?.focus(); returnFocus.current = false; } }, [target, data.data]);
  const failure = (e: unknown) => e instanceof ApiError && e.status === 403
    ? "For your security, sign in again (and confirm your authenticator code if you use one), then try again."
    : "That didn't work. Nothing was changed — please try again.";
  const connections = data.data?.connections ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Connecting a bank or card account</CardTitle>
          <CardDescription>Optional. It lets Pellum see balances and transactions so bills and renewals stay current.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-ink-secondary">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>Read-only. Pellum can never move money, pay bills or change anything at your bank.</li>
            <li>You sign in at your bank through our provider; we never see or store your bank password.</li>
            <li>We keep account names, balances and transactions — never full account numbers.</li>
            <li>You can disconnect at any time and choose whether the history we imported is deleted.</li>
          </ul>
          <div>
            <Button variant="secondary" disabled>Connect an account</Button>
          </div>
          <p className="text-xs text-ink-tertiary">Not available yet.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2"><span ref={headingRef} tabIndex={-1} className="outline-none">Your connections</span></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.isError ? <Alert tone="critical" title="Couldn't load connections">{failure(data.error)}</Alert> : null}
          {reconnect.isError ? <Alert tone="critical" title="Couldn't request a refresh">{failure(reconnect.error)}</Alert> : null}
          {data.isSuccess && connections.length === 0 ? <p className="text-sm text-ink-secondary">No accounts are connected.</p> : null}
          {connections.map(c => (
            <section key={c.id} aria-label={`Connection: ${c.accounts.map(a => a.name).join(", ") || "accounts"}`} className="rounded-md border border-line p-4 flex flex-col gap-3">
              <Alert tone={STATE[c.state].tone} title={STATE[c.state].label}>
                {c.state === "removed" ? (c.historyAfterRemoval === "retain" ? "You chose to keep the imported history." : "Imported history was deleted as you chose.")
                  : c.state === "unlinking" ? (c.historyAfterRemoval === "retain" ? "Imported history will be kept." : "Imported history will be deleted once the provider confirms.") : null}
                {c.refreshRequested && ["active","login-required","revoked"].includes(c.state) ? " A fresh check has been requested." : null}
              </Alert>
              {c.accounts.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {c.accounts.map(a => <li key={a.id} className="flex justify-between gap-3"><span>{a.name} <span className="text-ink-tertiary">({a.kind})</span></span><span>{money(a.currentCents)}</span></li>)}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {c.state === "login-required" || c.state === "revoked" ? (
                  <Button variant="secondary" disabled={reconnect.isPending} onClick={() => reconnect.mutate(c)}>Check connection again</Button>
                ) : null}
                {["active","login-required","revoked","removal-indeterminate"].includes(c.state) ? (
                  <Button variant="ghost" onClick={() => { setHistory("delete"); disconnect.reset(); setTarget(c); }}>Disconnect…</Button>
                ) : null}
              </div>
            </section>
          ))}
        </CardContent>
      </Card>

      <Modal open={target !== null} onClose={() => setTarget(null)} title="Disconnect this account?"
        description="Syncing stops right away. We then ask the provider to remove its access."
        footer={<>
          <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
          <Button variant="danger" disabled={disconnect.isPending} onClick={() => target && disconnect.mutate(target)}>{disconnect.isPending ? "Disconnecting…" : "Disconnect"}</Button>
        </>}>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium text-ink">What should happen to the history we imported?</legend>
          {disconnect.isError ? <Alert tone="critical" title="Not disconnected">{failure(disconnect.error)}</Alert> : null}
          <label className="flex items-start gap-2"><input type="radio" name="history" value="delete" checked={history === "delete"} onChange={() => setHistory("delete")} />
            <span>Delete it (recommended). Balances and transactions from this connection are removed once the provider confirms.</span></label>
          <label className="flex items-start gap-2"><input type="radio" name="history" value="retain" checked={history === "retain"} onChange={() => setHistory("retain")} />
            <span>Keep it. It stays in your records until you delete your household.</span></label>
        </fieldset>
      </Modal>
    </div>
  );
}
