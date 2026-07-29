import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";

export const metadata = { title: "Page not found" };

/**
 * 404.
 *
 * Written as a wrong-turn, not a failure: the most common way to land here is a stale
 * bookmark or a link to something since deleted, neither of which is the user's fault.
 * It offers the two places anyone actually wants — today's view and search — instead
 * of a dead end.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6">
      <EmptyState
        icon={<Icon.Search className="size-5" />}
        title="We couldn't find that page"
        description="The link may be out of date, or whatever it pointed to has since been removed. Nothing in your household has changed."
        action={{ label: "Go to Today", href: "/dashboard" }}
      />
      <p className="mt-6 text-xs text-ink-tertiary">
        Looking for something specific? Press{" "}
        <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono">⌘K</kbd>{" "}
        anywhere in the app to search.
      </p>
      <Link
        href="/"
        className="mt-4 text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Back to the start
      </Link>
    </main>
  );
}
