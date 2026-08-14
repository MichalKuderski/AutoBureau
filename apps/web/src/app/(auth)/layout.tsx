import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The authentication frame.
 *
 * One column, one card, no marketing. Somebody arriving here has either been sent by
 * a reminder email about a deadline or is coming back to check whether something is
 * handled — neither is a moment to sell to them.
 *
 * The wordmark links home rather than nowhere, because the most common reason to
 * bounce off a sign-in screen is arriving at it by accident.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-4 py-5 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-ink"
          >
            <Icon.Shield className="size-4.5" />
          </span>
          <span className="font-serif text-lg font-semibold tracking-tight">AutoBureau</span>
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="px-4 pb-8 text-center text-xs text-ink-tertiary sm:px-6">
        <p className="text-pretty">
          AutoBureau never asks for a bank or government login, and never moves money.
        </p>
      </footer>
    </div>
  );
}
