"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { isPlausibleEmail } from "@/lib/password";

/**
 * Password reset request.
 *
 * The confirmation deliberately does not say whether the address exists. Telling an
 * attacker which emails have accounts turns this form into an account-enumeration
 * oracle, and the honest phrasing costs a real user nothing — they know whether they
 * have an account.
 *
 * Recovery is email-only in v1 (doc 06 §1). Support cannot reset MFA without a
 * documented identity check, which is why there is no "contact us" shortcut here
 * pretending otherwise.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <>
        <h1 className="text-2xl leading-tight">Check your email</h1>
        <p className="mt-2 text-sm text-ink-secondary text-pretty">
          If there&apos;s an account for that address, a reset link is on its way. It works once
          and expires in fifteen minutes.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-block text-sm text-accent underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl leading-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-secondary text-pretty">
        Tell us the address you signed up with and we&apos;ll send a link to set a new one.
      </p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPlausibleEmail(email)) {
            setError("Enter the address you signed up with.");
            return;
          }
          setPending(true);
          window.setTimeout(() => {
            setPending(false);
            setSent(true);
          }, 500);
        }}
      >
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          error={error}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(undefined);
          }}
        />
        <Button type="submit" variant="primary" fullWidth loading={pending}>
          Send the reset link
        </Button>
      </form>

      <Link
        href="/sign-in"
        className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </>
  );
}
