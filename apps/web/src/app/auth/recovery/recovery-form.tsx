"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";

/**
 * Recovery landing page. The link works once: whatever happens, the next step is stated
 * plainly. Success never signs the person in — every session is revoked and they must sign
 * in with the new password. An account with an authenticator app must enter its current
 * code; recovery never bypasses the second factor.
 */
export function RecoveryForm({ available, tokenHash }: { available: boolean; tokenHash: string | null }) {
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  if (!available || !tokenHash) {
    return (
      <>
        <h1 className="text-2xl leading-tight">Choose a new password</h1>
        <Alert tone="info" title={available ? "This link isn't usable" : "Not available in this preview"} className="mt-5">
          {available ? "The reset link is incomplete. Request a new one." : "Password reset is not enabled on this deployment."}
        </Alert>
        <Link href="/forgot-password" className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline">Request a new link</Link>
      </>
    );
  }
  const mismatch = confirm.length > 0 && confirm !== password, codeOk = code === "" || /^\d{6}$/.test(code);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (mismatch || !codeOk || !password) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/v1/auth/recovery/complete", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", [CSRF_HEADER]: CSRF_HEADER_VALUE },
        body: JSON.stringify({ tokenHash, password, ...(code ? { code } : {}) }) });
      if (r.ok) setDone(true);
      else setError(r.status === 429 ? "Too many attempts. Wait a little, then request a new link."
        : "Your password wasn't changed. This link works once, so request a new one. If you use an authenticator app, include its current code.");
    } catch { setError("Your password wasn't changed. Request a new link and try again."); }
    finally { setBusy(false); requestAnimationFrame(() => statusRef.current?.focus()); }
  }
  return (
    <>
      <h1 className="text-2xl leading-tight">Choose a new password</h1>
      {done ? null : (
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
          <TextInput label="New password" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} />
          <TextInput label="Confirm new password" type="password" autoComplete="new-password" required value={confirm}
            onChange={e => setConfirm(e.target.value)} error={mismatch ? "The passwords don't match." : undefined} />
          <TextInput label="Authenticator code (only if you use an authenticator app)" inputMode="numeric" autoComplete="one-time-code"
            value={code} onChange={e => setCode(e.target.value.replace(/\s/g, ""))} error={codeOk ? undefined : "Enter the 6-digit code."} />
          <div><Button type="submit" variant="primary" disabled={busy || !password || mismatch || !codeOk}>{busy ? "Saving…" : "Save new password"}</Button></div>
        </form>
      )}
      <div ref={statusRef} tabIndex={-1} aria-live="polite" className="mt-4 outline-none">
        {done ? (
          <Alert tone="info" title="Password changed">
            You've been signed out everywhere. <Link href="/sign-in" className="underline underline-offset-2">Sign in</Link> with your new password.
          </Alert>
        ) : error ? <Alert tone="critical" title="Not changed">{error}</Alert> : null}
      </div>
    </>
  );
}
