"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Route-level error boundary for the public segment.
 *
 * Next mounts this whenever a render throws below the root layout. Without it the
 * user gets an unstyled framework page — in a product whose entire proposition is
 * "nothing slips", a blank screen at the moment something breaks is the worst
 * possible message.
 *
 * `reset()` re-renders the segment, which is genuinely useful: most failures here are
 * transient (a fetch that failed, a hydration hiccup), so retrying in place beats
 * asking the user to navigate away and come back.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Wire to the error reporter here (doc 10 §1). Console until that lands so the
    // digest is at least recoverable from a support conversation.
    console.error("[route-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6">
      <ErrorState
        title="Something went wrong on our side"
        description="This isn't your fault and nothing you've saved is affected. Try again — if it keeps happening, we'd like to know."
        onRetry={reset}
      />
      {error.digest ? (
        <p className="mt-4 font-mono text-xs text-ink-tertiary">Reference: {error.digest}</p>
      ) : null}
    </main>
  );
}
