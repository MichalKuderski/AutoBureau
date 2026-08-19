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
    // Redundant, deliberately. `Button` disables itself while `loading`, and that alone
    // stops every duplicate the tests can construct — removing this line leaves them all
    // green. It stays because the cost of being wrong is asymmetric: a second magic-link
    // request overwrites the first one's verifier cookie, silently killing the link
    // already sitting in the user's inbox, and a disabled attribute is a rendering
    // artefact while this is not.
    if (pending) return;

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
      const address = email.trim();
      setPending(true);
      try {
        // The magic-link endpoint is called through apiFetch so the established CSRF and
        // same-origin credential handling remain centralized.
        await apiFetch<void>("/auth/magic-link", { method: "POST", body: { email: address } });
      } catch (cause) {
        setPending(false);
        // Every failure that reaches here is a fact about the *request* — rate limiting,
        // an unverifiable origin, a malformed body, the deployment being unconfigured or
        // the provider unreachable. None is a fact about the address: the endpoint
        // answers 204 for one it could not send to, so there is no "no such account"
        // branch to render and none may be invented here.
        setFormError(
          cause instanceof ApiError
            ? (cause.problem.detail ?? "We couldn't send the link. Please try again.")
            : "We couldn't send the link. Please try again.",
        );
        return;
      }
      // Cleared before the confirmation replaces the form, so that "Use a password
      // instead" comes back to a live submit button rather than a stuck spinner.
      setPending(false);
      setLinkSentTo(address);
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
