import { cn } from "@/lib/cn";

/**
 * Indeterminate progress. Decorative by default — the surrounding control owns the
 * accessible announcement (`aria-busy` + an sr-only label), so screen readers hear
 * "Working…" once instead of a bare spinner role on every nested element.
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <>
      <svg
        className={cn("animate-spin", className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}
