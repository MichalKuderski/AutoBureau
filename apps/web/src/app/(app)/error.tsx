"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Error boundary for every authenticated screen.
 *
 * Placing it at the segment root is deliberate: it covers all present *and future*
 * screens under `(app)` without each one having to remember to wrap itself. The
 * per-widget `ErrorBoundary` inside the dashboard is a complement, not a duplicate —
 * that one isolates a single failing widget so the rest of the page survives, while
 * this one catches whatever escapes.
 *
 * The shell (navigation, household switcher) stays mounted because this file lives
 * below `(app)/layout.tsx`, so a broken screen never strands the user.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-route-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="py-12">
      <ErrorState
        title="This page didn't load"
        description="Your household data is safe. Try again, or use the navigation to go somewhere else while we sort this out."
        onRetry={reset}
      />
      {error.digest ? (
        <p className="mt-4 text-center font-mono text-xs text-ink-tertiary">
          Reference: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
