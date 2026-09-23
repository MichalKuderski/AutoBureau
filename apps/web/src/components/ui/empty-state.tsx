import { cn } from "@/lib/cn";
import { Button } from "./button";

/**
 * Empty states.
 *
 * PRD §15.4 treats these as product surface, not a blank div: "nothing at risk this
 * week" is a *feature* — it is the reassurance the user pays for. Every empty state
 * therefore states the good news first, then teaches the next step. None of them
 * apologise, and none of them use fear to prompt action.
 */

export interface EmptyStateProps {
  icon?: React.ReactNode | undefined;
  title: string;
  description?: string | undefined;
  action?: { label: string; onClick?: (() => void) | undefined; href?: string | undefined } | undefined;
  secondaryAction?: { label: string; onClick?: (() => void) | undefined; href?: string | undefined } | undefined;
  tone?: "neutral" | "reassuring" | undefined;
  className?: string | undefined;
}

/**
 * Renders a link when the action navigates and a button when it acts. Using the
 * right element matters: a link must be openable in a new tab, and a button must
 * not be.
 */
function EmptyStateAction({
  label,
  href,
  onClick,
  variant = "primary",
}: {
  label: string;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  variant?: "primary" | "ghost" | undefined;
}) {
  if (href) {
    return (
      <a
        href={href}
        className={cn(
          "inline-flex h-10 items-center justify-center rounded-md px-4 text-base font-medium transition-colors",
          variant === "primary"
            ? "bg-accent text-accent-ink hover:bg-accent-hover shadow-sm"
            : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
        )}
      >
        {label}
      </a>
    );
  }
  return (
    <Button variant={variant === "primary" ? "primary" : "ghost"} onClick={onClick}>
      {label}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center",
        tone === "reassuring"
          ? "border-success/30 bg-success-soft/40"
          : "border-line bg-surface-sunken/40",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className={cn(
            "mb-4 flex size-11 items-center justify-center rounded-full",
            tone === "reassuring" ? "bg-success-soft text-success" : "bg-surface text-ink-tertiary",
          )}
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-ink-secondary text-pretty">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action ? <EmptyStateAction {...action} /> : null}
          {secondaryAction ? <EmptyStateAction {...secondaryAction} variant="ghost" /> : null}
        </div>
      ) : null}
    </div>
  );
}
