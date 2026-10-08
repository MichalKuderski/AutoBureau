"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { ApiError, apiFetch } from "@/lib/api-client";
import { DEFAULT_DESTINATION, safeDestination } from "@/server/http/public-routes";
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
 * BOTH PATHS POST TO `/v1` (blueprint P0-06). The link path used to `setTimeout` and
 * then claim an email had been sent; `POST /v1/auth/magic-link` had existed and been
 * tested the whole time, and was never called. The confirmation screen was therefore a
 * lie told to precisely the person least equipped to notice it.
 *
 * NEITHER PATH TELLS THE USER WHETHER AN ACCOUNT EXISTS, and that is not this
 * component's doing — it is the endpoints'. Sign-in collapses "wrong password" and "no
 * such account" into one refusal; magic-link answers 204 whether or not the provider
 * recognised the address. Both branches below surface the server's own message rather
 * than deriving their own, which is what keeps that property from being undone here.
 *
 * ONLY THE PASSWORD PATH REDIRECTS FROM HERE (blueprint P0-13). That is not an
 * oversight: the magic-link path never navigates on submit at all — it renders "Check
 * your email", and the eventual redirect happens server-side in `/auth/callback`, from
 * the destination stored in the PKCE cookie when the link was requested. That
 * destination is the magic-link endpoint's own concern (P0-06), validated by the same
 * `safeDestination` on the way in and again on the way out, and this component does not
 * reach into it. The consequence, recorded rather than hidden: a user who arrives at
 * `?next=/obligations` and then chooses the emailed link lands on `/dashboard`.
 */
export function SignInForm({ next = DEFAULT_DESTINATION }: { next?: string } = {}) {
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

  // A ref closes the interval before React commits the disabled button. Each attempt
  // owns its completion; leaving the form invalidates it even if fetch ignores abort.
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const abandon = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
    const leaveDocument = () => {
      abandon();
      // A back/forward-cache restoration must not resurrect a permanently busy form.
      setPending(false);
    };
    window.addEventListener("pagehide", leaveDocument);
    return () => {
      window.removeEventListener("pagehide", leaveDocument);
      abandon();
    };
  }, []);

  if (linkSentTo) {
    return (
      <>
        <h1 className="text-2xl leading-tight">Check your email</h1>
        {/* Both halves of this sentence are enforced, not asserted. "Fifteen minutes" is
            PRD §19 F1 and is held to by the PKCE verifier cookie's own Max-Age
            (`server/auth/pkce.ts` VERIFIER_TTL_SECONDS): once it lapses the browser stops
            sending it, and `/auth/callback` fails closed with nothing to redeem. "Works
            once" is the same cookie being cleared on every redemption attempt, successful
            or not — proved by the replay case in `pkce.integration.test.ts`. */}
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
    if (activeRequest.current) return;

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

    const request = new AbortController();
    activeRequest.current = request;
    const startingUrl = window.location.href;
    const isCurrent = () => activeRequest.current === request && !request.signal.aborted
      && window.location.href === startingUrl;
    let navigating = false;
    setPending(true);
    try {
      if (mode === "link") {
        const address = email.trim();
        // Preserve the magic-link endpoint's PKCE and non-enumerating confirmation.
        await apiFetch<void>("/auth/magic-link", {
          method: "POST", body: { email: address }, signal: request.signal,
        });
        if (isCurrent()) setLinkSentTo(address);
        return;
      }

      // ADR-009 D2/D4: the server establishes HttpOnly cookies; apiFetch keeps the
      // same-origin credentials and CSRF header. No tokens reach client-side storage.
      await apiFetch<void>("/auth/sign-in", {
        method: "POST",
        body: { email: email.trim(), password },
        signal: request.signal,
      });
      if (!isCurrent()) return;
      // Revalidate the page's destination at the navigation boundary (P0-13). A single
      // document replacement reads the new cookies and discards prior router/query
      // caches. replace + refresh can start two overlapping streamed server renders.
      // Preserve history replacement so Back does not return to this submitted form.
      window.location.replace(safeDestination(next));
      navigating = true;
    } catch (cause) {
      if (!isCurrent()) return;
      const fallback = mode === "link"
        ? "We couldn't send the link. Please try again."
        : "We couldn't sign you in. Please try again.";
      // Request failures never establish whether an account exists. Abandoning the
      // request suppresses this UI completion; it cannot roll back server-side work.
      setFormError(cause instanceof ApiError ? (cause.problem.detail ?? fallback) : fallback);
    } finally {
      if (activeRequest.current === request && !navigating) {
        activeRequest.current = null;
        setPending(false);
      }
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
        <Alert
          tone="critical"
          title={mode === "password" ? "Sign-in failed" : "We couldn't send the link"}
          className="mt-5"
        >
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
          disabled={pending}
          className="self-center text-sm"
          onClick={() => {
            setMode(mode === "password" ? "link" : "password");
            setErrors({});
            // The failure belonged to the path being left. Carrying it over would leave
            // the other path's heading sitting above a message about this one.
            setFormError(null);
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
