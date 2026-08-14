"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { OnboardingProvider, ONBOARDING_STEPS } from "./onboarding-provider";

/**
 * Onboarding chrome.
 *
 * No sidebar, no search, no notifications — the whole navigation surface is one
 * progress rail and one exit. A first session that offers eight places to go is how
 * the ten-minute rule (PRD §15.5) gets missed.
 *
 * "Skip for now" is deliberately as visible as the progress: the census must be
 * abandonable at any point without dead-ending (PRD F3), and burying the exit is how
 * a setup flow turns into a hostage situation.
 */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentIndex = Math.max(
    0,
    ONBOARDING_STEPS.findIndex((s) => s.href === pathname),
  );

  return (
    <OnboardingProvider>
      <div className="flex min-h-dvh flex-col bg-canvas">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3.5 sm:px-6">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-ink"
            >
              <Icon.Shield className="size-4.5" />
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">AutoBureau</span>
            <Link
              href="/dashboard"
              className="ml-auto text-sm text-ink-secondary underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              Skip for now
            </Link>
          </div>
        </header>

        <nav aria-label="Setup progress" className="border-b border-line bg-surface">
          <ol className="mx-auto flex w-full max-w-3xl gap-1 px-4 pb-3 sm:px-6">
            {ONBOARDING_STEPS.map((step, index) => {
              const state =
                index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
              return (
                <li key={step.href} className="min-w-0 flex-1">
                  <span
                    aria-current={state === "current" ? "step" : undefined}
                    className={cn(
                      "block border-t-2 pt-2 text-2xs font-medium transition-colors",
                      state === "todo"
                        ? "border-line text-ink-tertiary"
                        : "border-accent text-accent",
                    )}
                  >
                    <span className="sr-only">
                      Step {index + 1} of {ONBOARDING_STEPS.length}
                      {state === "done" ? ", complete" : ""}:{" "}
                    </span>
                    <span className="block truncate">{step.label}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
      </div>
    </OnboardingProvider>
  );
}

/**
 * The footer every step shares: one primary way forward, one quiet way past.
 * Consistent placement matters more here than anywhere else in the product — the
 * user is learning the interface and the flow at the same time.
 */
export function StepFooter({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: string | undefined;
}) {
  return (
    <div className="mt-8 flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      {note ? <p className="text-xs text-ink-tertiary text-pretty">{note}</p> : null}
    </div>
  );
}
