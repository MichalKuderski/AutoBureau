import Link from "next/link";
import { cn } from "@/lib/cn";
import { dynamicHref } from "@/lib/routes";
import { Icon } from "./icon";

/**
 * Stat tile and coverage meter — the dashboard's summary layer.
 *
 * Numbers carry their unit and their meaning; a bare "3" on a card is a puzzle. Tone
 * encodes state so the row reads at a glance without relying on colour alone (the
 * label and the icon both carry it, per WCAG 1.4.1).
 */

export type StatTone = "neutral" | "attention" | "positive";

const TONE: Record<StatTone, { value: string; chip: string }> = {
  neutral: { value: "text-ink", chip: "bg-surface-sunken text-ink-tertiary" },
  attention: { value: "text-critical", chip: "bg-critical-soft text-critical" },
  positive: { value: "text-success", chip: "bg-success-soft text-success" },
};

export interface StatProps {
  label: string;
  value: string | number;
  /** Short qualifier: "due in 30 days", "since March". */
  hint?: string | undefined;
  tone?: StatTone | undefined;
  href?: string | undefined;
  icon?: React.ReactNode | undefined;
  className?: string | undefined;
}

export function Stat({ label, value, hint, tone = "neutral", href, icon, className }: StatProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-ink-tertiary uppercase">
          {label}
        </span>
        {icon ? <span className="text-ink-tertiary">{icon}</span> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-3xl tabular-nums tracking-tight",
          TONE[tone].value,
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-tertiary">{hint}</p> : null}
    </>
  );

  const shell = cn(
    "block rounded-lg border border-line bg-surface p-4 transition-colors",
    href && "hover:border-line-strong hover:bg-surface-raised",
    className,
  );

  if (href) {
    return (
      <Link
        href={dynamicHref(href)}
        className={cn(
          shell,
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        )}
      >
        {body}
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-accent">
          View
          <Icon.ChevronRight className="size-3" />
        </span>
      </Link>
    );
  }

  return <div className={shell}>{body}</div>;
}

export interface CoverageMeterProps {
  captured: number;
  expected: number;
  className?: string | undefined;
}

/**
 * Coverage — how much of the household's standing we actually hold.
 *
 * This is the ledger thesis made visible: the product's value is the fraction of
 * real-world obligations the system knows about, and showing it honestly (including
 * when it is low) is what earns the right to be trusted with the rest.
 */
export function CoverageMeter({ captured, expected, className }: CoverageMeterProps) {
  const pct = expected === 0 ? 0 : Math.round((captured / expected) * 100);
  return (
    <div className={cn("rounded-lg border border-line bg-surface p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-ink-tertiary uppercase">
          Coverage
        </span>
        <span className="text-sm tabular-nums text-ink-secondary">
          {captured} of {expected}
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Household coverage: ${pct} percent`}
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-ink-tertiary text-pretty">
        {pct >= 80
          ? "We're tracking most of what your household manages."
          : "Add what's missing and we'll watch the dates for you."}
      </p>
    </div>
  );
}
