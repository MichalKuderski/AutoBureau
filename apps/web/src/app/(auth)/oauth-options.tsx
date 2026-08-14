"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Third-party sign-in.
 *
 * Rendered as plain labelled buttons rather than brand-marked ones: reproducing
 * Google's and Apple's marks means shipping their assets under their brand guidelines,
 * which is a legal review this repository has not had. The words are unambiguous and
 * the buttons work; the marks can land when someone signs off on them.
 *
 * Provider sign-in links to an existing account by *verified* email (PRD F1) — the
 * account-linking decision belongs to the server, which is why this component knows
 * nothing about whether the user has been here before.
 */

const PROVIDERS = [
  { id: "google", label: "Continue with Google" },
  { id: "apple", label: "Continue with Apple" },
] as const;

export function OAuthOptions({ next }: { next: "/dashboard" | "/onboarding" }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.map((provider) => (
        <Button
          key={provider.id}
          variant="secondary"
          fullWidth
          // The OAuth redirect replaces this in the Supabase wiring; the button's
          // contract — which provider, where the user lands — is already the real one.
          onClick={() => router.push(next)}
        >
          {provider.label}
        </Button>
      ))}
    </div>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="text-xs text-ink-tertiary">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
