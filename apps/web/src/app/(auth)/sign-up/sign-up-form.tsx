"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { ApiError, apiFetch } from "@/lib/api-client";
import { assessPassword, isPlausibleEmail } from "@/lib/password";

/** 204 (session issued) arrives as `undefined`; 202 carries the pending marker. */
type SignUpResponse = { status?: "confirmation-required" } | undefined;

/**
 * Create an account.
 *
 * Three fields. Every additional one costs signups, and everything else we need —
 * who is in the household, what they hold — is asked in onboarding, where the user
 * can already see why we're asking.
 *
 * The strength meter guides rather than gates: it steers toward length (NIST
 * 800-63B), and the binding checks — zxcvbn score and the breach corpus — happen
 * server-side at set time (doc 06 §1). Saying so in the copy is deliberate; a meter
 * that implies it has checked a breach list when it hasn't is a small lie about
 * security, and this product cannot afford those.
 */
export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // `| undefined` is explicit because `exactOptionalPropertyTypes` distinguishes an
  // absent key from one set to undefined, and clearing a field error does the latter.
  const [errors, setErrors] = useState<{
    name?: string | undefined;
    email?: string | undefined;
    password?: string | undefined;
  }>({});
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Set once the provider accepted the address but the account awaits confirmation. */
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  const assessment = assessPassword(password, email);

  const submit = async () => {
    // The endpoint mints an identity, so a double-submit is more expensive here than on a
    // read. `Button` already disables itself while `loading`; this is the guard that does
    // not depend on a rendering artefact.
    if (pending) return;

    const nextErrors: typeof errors = {};
    if (name.trim().length === 0) nextErrors.name = "Tell us what to call you.";
    if (!isPlausibleEmail(email)) nextErrors.email = "Enter an address we can reach you at.";
    if (!assessment.acceptable) nextErrors.password = assessment.hint;
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    let outcome: SignUpResponse;
    try {
      // Through `apiFetch` like every other `/v1` call, so the CSRF header and same-origin
      // credential handling stay in the one place that owns them.
      outcome = await apiFetch<SignUpResponse>("/auth/sign-up", {
        method: "POST",
        body: { name: name.trim(), email: email.trim(), password },
      });
    } catch (cause) {
      setPending(false);
      // Nothing here distinguishes "this address already has an account": the endpoint
      // deliberately does not say, so there is no such branch to render and none may be
      // invented. What can be reported is a fact about the request — a rejected password,
      // too many attempts, an unconfigured or unreachable deployment.
      setFormError(
        cause instanceof ApiError
          ? (cause.problem.detail ?? "We couldn't create your account. Please try again.")
          : "We couldn't create your account. Please try again.",
      );
      return;
    }

    // 204 means the deployment does not require email confirmation and the session cookies
    // are already set — the identity is complete, so onboarding is reachable now. A 202
    // means the account is inert until the emailed link is followed, and `/auth/callback`
    // completes it there. Same destination, different reason, and the copy differs.
    if (outcome?.status === "confirmation-required") {
      setPending(false);
      setConfirmationSentTo(email.trim());
      return;
    }
    router.push("/onboarding");
  };

  // The account exists but is inert until the link is followed. Replacing the form rather
  // than annotating it is deliberate: resubmitting the same address would only spend the
  // rate-limit budget that lets them ask for the mail again.
  if (confirmationSentTo !== null) {
    return (
      <>
        <h1 className="text-2xl leading-tight">Confirm your email</h1>
        <p className="mt-2 text-sm text-ink-secondary text-pretty">
          We sent a link to <span className="font-medium text-ink-primary">{confirmationSentTo}</span>.
          Follow it and your household is ready.
        </p>
        <p className="mt-4 text-sm text-ink-tertiary text-pretty">
          Nothing arrives? Check spam, and confirm the address is right.
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
      <h1 className="text-2xl leading-tight">Start your household ledger</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Free to start.{" "}
        <Link href="/sign-in" className="text-accent underline-offset-4 hover:underline">
          Already have an account?
        </Link>
      </p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextInput
          label="Your name"
          autoComplete="name"
          autoFocus
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
          }}
        />

        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          description="We'll send a link to confirm it before anything starts flowing in."
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
        />

        <div className="flex flex-col gap-2">
          <TextInput
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            error={errors.password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
            }}
          />
          <StrengthMeter
            score={assessment.score}
            label={assessment.label}
            hint={assessment.hint}
            show={password.length > 0}
          />
        </div>

        {formError === null ? null : (
          <p role="alert" className="text-sm text-critical text-pretty">
            {formError}
          </p>
        )}

        <Button type="submit" variant="primary" fullWidth loading={pending}>
          Create account
        </Button>
      </form>

      {/* Distinct from the promise in the auth footer, which covers credentials and
          money. This one is the §6 boundary: we prepare, you decide. */}
      <p className="mt-4 flex items-start gap-2 text-xs text-ink-tertiary text-pretty">
        <Icon.Shield className="mt-0.5 size-3.5 shrink-0" />
        We prepare the paperwork and watch the dates. Nothing is sent, cancelled, or filed unless
        you do it.
      </p>
    </>
  );
}

const SEGMENT_TONE = [
  "bg-critical",
  "bg-critical",
  "bg-warning",
  "bg-success",
  "bg-success",
] as const;

function StrengthMeter({
  score,
  label,
  hint,
  show,
}: {
  score: number;
  label: string;
  hint: string;
  show: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", !show && "opacity-0")} aria-hidden={!show}>
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              segment < score ? SEGMENT_TONE[score] : "bg-line",
            )}
          />
        ))}
      </div>
      {/* The label carries the meaning; the bars only repeat it. Announced politely so
          it doesn't interrupt the user mid-word. */}
      <p className="text-xs text-ink-tertiary text-pretty" aria-live="polite">
        {label ? <span className="font-medium text-ink-secondary">{label}. </span> : null}
        {hint}
      </p>
    </div>
  );
}
