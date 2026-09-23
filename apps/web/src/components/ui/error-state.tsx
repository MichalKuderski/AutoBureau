"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ApiError } from "@/lib/api-client";
import { SIGN_IN_PATH, safeDestination } from "@/server/http/public-routes";
import { dynamicHref } from "@/lib/routes";
import { Button } from "./button";
import { cn } from "@/lib/cn";

/**
 * Error surfaces.
 *
 * The copy rule (PRD §15, FOUNDING_PRINCIPLES §4): say what went wrong and what to
 * do next. No apologies, no blame, no stack traces, and never the word "oops" in a
 * product holding someone's passport. Recoverable errors always offer the recovery.
 */

export function ErrorState({
  title,
  description,
  onRetry,
  showSignIn,
  className,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  /**
   * Blueprint P0-12. "Your session ended" used to leave only "Try again" — which
   * fails identically, because the request that produced it was never the problem,
   * the expired session was. `showSignIn` swaps that dead end for a real recovery
   * path: `/sign-in?next=<here>`, so the user lands back where they were once
   * re-authenticated. Retry is suppressed rather than shown alongside it — a request
   * that 401'd once will 401 again until the session is repaired, so offering both
   * would be offering one button that cannot work.
   */
  showSignIn?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center rounded-lg border border-critical/25 bg-critical-soft/50 px-6 py-10 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="mb-3 flex size-10 items-center justify-center rounded-full bg-critical-soft text-critical"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-5">
          <path
            d="M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h3 className="text-lg text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-md text-sm text-ink-secondary text-pretty">{description}</p>
      ) : null}
      {showSignIn ? (
        <Button
          variant="primary"
          className="mt-5"
          onClick={() => {
            // `safeDestination` is the one open-redirect guard this app has (ADR-009
            // D3) — middleware's own `/sign-in?next=` redirect uses it the same way.
            // `pathname` never carries a query string here: none of this app's
            // screens encode meaningful state there, so there is nothing to lose by
            // reading only `usePathname()` rather than adding `useSearchParams()`.
            const next = encodeURIComponent(safeDestination(pathname));
            router.push(dynamicHref(`${SIGN_IN_PATH}?next=${next}`));
          }}
        >
          Sign in again
        </Button>
      ) : onRetry ? (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Maps a thrown value to copy a person can act on. */
export function describeError(
  error: unknown,
): { title: string; description: string; showSignIn?: boolean } {
  if (error instanceof ApiError) {
    if (error.isAuth) {
      return {
        title: "Your session ended",
        description: "Sign in again to pick up where you left off.",
        showSignIn: true,
      };
    }
    if (error.isCapExceeded) {
      return {
        title: "You've reached this month's limit",
        description:
          "Processing resumes at the start of next month, or upgrade to continue right away.",
      };
    }
    if (error.status === 403) {
      return {
        title: "You don't have access to that",
        description: "Ask a household owner to grant you access.",
      };
    }
    if (error.status === 404) {
      return {
        title: "We couldn't find that",
        description: "It may have been deleted, or the link may be out of date.",
      };
    }
    if (error.status === 429) {
      return {
        title: "Too many requests",
        description: "Give it a moment and try again.",
      };
    }
    return {
      title: error.problem.title,
      description: error.problem.detail ?? "Try again in a moment.",
    };
  }
  return {
    title: "Something went wrong",
    description: "We couldn't load this. Try again, and let us know if it keeps happening.",
  };
}

interface BoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Identifies the failing region in telemetry (doc 10 §2). */
  region?: string;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Region-scoped error boundary. Placed around independent panels so one failing
 * widget degrades to a message instead of blanking the page — an obligations list
 * that fails must not take the reminder banner down with it.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Telemetry hook — wired to Sentry in doc 10 §1. Never logs PII.
    if (process.env.NODE_ENV !== "production") {
      console.error(`[${this.props.region ?? "app"}]`, error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    // Spread rather than destructure `title`/`description` alone, so a caught
    // `ApiError` gets the same P0-12 sign-in recovery the `query.isError` path does —
    // one function deciding the recovery action, not two copies of that decision.
    return <ErrorState {...describeError(error)} onRetry={this.reset} />;
  }
}
