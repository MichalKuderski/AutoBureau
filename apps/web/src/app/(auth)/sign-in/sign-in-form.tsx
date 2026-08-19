"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/api-client";
import { isPlausibleEmail } from "@/lib/password";

/**
 * Sign in.
 *
 * Two paths, and the quiet one matters more than it looks: a one-time link is the
 * only route that works for someone who set this up in a hospital waiting room eight
 * weeks ago and has no idea what password they chose. That is the wedge persona, not
 * an edge case, which is why the link option sits in the form rather than behind a
 * "trouble signing in?" footnote.
 *
 * The transport lands with Supabase Auth (doc 06 §1). What is already production
 * shape here is the contract: what the form collects, what it refuses, what it says
 * when it refuses, and where each path ends up.
 */
export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // `| undefined` is explicit because `exactOptionalPropertyTypes` distinguishes an
  // absent key from one set to undefined, and clearing a field error does the latter.
  const [errors, setErrors] = useState<{
    email?: string | undefined;
    password?: string | undefined;
  }>({});
  const [pending, setPending] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  /** Form-level failure — the server never says *which* half was wrong, and neither do we. */
  const [formError, setFormError] = useState<string | null>(null);

  if (linkSentTo) {
    return (
      <>
        <h1 className="text-2xl leading-tight">Check your email</h1>
        <p className="mt-2 text-sm text-ink-secondary text-pretty">
          We&apos;ve sent a sign-in link to <strong className="text-ink">{linkSentTo}</strong>. It
          works once and expires in fifteen minutes.
        </p>
        <Alert tone="info" title="Nothing arrived?" className="mt-5">
          Check the spam folder, then try again — links are single-use, so an older one in your
          inbox will already be dead.
        </Alert>
        <Button
          variant="ghost"
          fullWidth
          className="mt-4"
          onClick={() => {
            setLinkSentTo(null);
            setMode("password");
          }}
        >
          Use a password instead
        </Button>
      </>
    );
  }

  const submit = async () => {
    const nextErrors: typeof errors = {};
    if (!isPlausibleEmail(email)) {
      nextErrors.email = "Enter the address you signed up with.";
    }
    if (mode === "password" && password.length === 0) {
      nextErrors.password = "Enter your password, or ask for a one-time link instead.";
    }
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    if (mode === "link") {
      // The magic-link endpoint exists and is provider-verified, but wiring its UI is
      // deliberately outside this gate. Left as it was rather than half-migrated.
      setPending(true);
      window.setTimeout(() => {
        setPending(false);
        setLinkSentTo(email.trim());
      }, 500);
      return;
    }

    setPending(true);
    try {
      // ADR-009 D2: the session is established server-side. `apiFetch` attaches the D4
      // CSRF header and `credentials: "same-origin"`; the response carries no token, only
      // `Set-Cookie`. Nothing token-shaped is read, stored, or inspected on this side.
      await apiFetch<void>("/auth/sign-in", {
        method: "POST",
        body: { email: email.trim(), password },
      });
      // The session now lives in cookies the browser will not show us, so the destination
      // must be re-fetched from the server rather than rendered from anything held here.
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setPending(false);
      if (cause instanceof ApiError) {
        // The endpoint already collapses "wrong password" and "no such account" into one
        // answer; repeating its detail verbatim keeps that property instead of guessing.
        setFormError(cause.problem.detail ?? "We couldn't sign you in. Please try again.");
        return;
      }
      setFormError("We couldn't sign you in. Please try again.");
    }
  };

  return (
    <>
      <h1 className="text-2xl leading-tight">Welcome back</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Everything is where you left it.{" "}
        <Link href="/sign-up" className="text-accent underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>

      {formError ? (
        <Alert tone="critical" title="Sign-in failed" className="mt-5">
          {formError}
        </Alert>
      ) : null}

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
        />

        {mode === "password" ? (
          <div className="flex flex-col gap-1.5">
            <TextInput
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              error={errors.password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
              }}
            />
            <Link
              href="/forgot-password"
              className="self-start text-xs text-accent underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        ) : null}

        <Button type="submit" variant="primary" fullWidth loading={pending}>
          {mode === "password" ? "Sign in" : "Email me a sign-in link"}
        </Button>

        <Button
          variant="link"
          className="self-center text-sm"
          onClick={() => {
            setMode(mode === "password" ? "link" : "password");
            setErrors({});
          }}
        >
          {mode === "password"
            ? "Email me a one-time link instead"
            : "Sign in with a password instead"}
        </Button>
      </form>
    </>
  );
}
