"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/csrf";

/**
 * Password reset request. Never reports an email as sent when no recovery endpoint exists,
 * and never reveals whether an address has an account: every accepted request gets the same
 * sentence. Only the synthetic local account mount enables the form.
 */
export function ForgotPasswordForm({ available = false }: { available?: boolean }) {
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { tone: "info" | "critical"; text: string }>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  if (!available) {
    return (
      <>
        <h1 className="text-2xl leading-tight">Reset your password</h1>
        <Alert tone="info" title="Not available in this preview" className="mt-5">
          Password reset is still being implemented. No reset email has been sent.
          You can return to sign in and use the email-link option if you have access to your inbox.
        </Alert>
        <Link href="/sign-in" className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setResult(null);
    try {
      const r = await fetch("/v1/auth/recovery", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", [CSRF_HEADER]: CSRF_HEADER_VALUE }, body: JSON.stringify({ email: email.trim() }) });
      setResult(r.status === 202 ? { tone: "info", text: "If that address can recover an account, we've sent instructions. The link works once." }
        : r.status === 429 ? { tone: "critical", text: "Too many requests. Wait a little, then try again." }
        : { tone: "critical", text: "Password reset is briefly unavailable. Nothing was sent; try again later." });
    } catch { setResult({ tone: "critical", text: "Password reset is briefly unavailable. Nothing was sent; try again later." }); }
    finally { setBusy(false); requestAnimationFrame(() => statusRef.current?.focus()); }
  }
  return (
    <>
      <h1 className="text-2xl leading-tight">Reset your password</h1>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
        <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <div><Button type="submit" variant="primary" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Send reset link"}</Button></div>
      </form>
      <div ref={statusRef} tabIndex={-1} aria-live="polite" className="mt-4 outline-none">
        {result ? <Alert tone={result.tone} title={result.tone === "info" ? "Check your email" : "Not sent"}>{result.text}</Alert> : null}
      </div>
      <Link href="/sign-in" className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline">Back to sign in</Link>
    </>
  );
}
