"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { assessPassword, isPlausibleEmail } from "@/lib/password";

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

  const assessment = assessPassword(password, email);

  const submit = () => {
    const nextErrors: typeof errors = {};
    if (name.trim().length === 0) nextErrors.name = "Tell us what to call you.";
    if (!isPlausibleEmail(email)) nextErrors.email = "Enter an address we can reach you at.";
    if (!assessment.acceptable) nextErrors.password = assessment.hint;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    // Supabase Auth replaces this; a real signup lands on onboarding the same way,
    // with the verification email already in flight.
    window.setTimeout(() => {
      setPending(false);
      router.push("/onboarding");
    }, 500);
  };

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
          submit();
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
