"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
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
  className,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
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
      {onRetry ? (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Maps a thrown value to copy a person can act on. */
export function describeError(error: unknown): { title: string; description: string } {
  if (error instanceof ApiError) {
    if (error.isAuth) {
      return {
        title: "Your session ended",
        description: "Sign in again to pick up where you left off.",
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
    const { title, description } = describeError(error);
    return <ErrorState title={title} description={description} onRetry={this.reset} />;
  }
}
