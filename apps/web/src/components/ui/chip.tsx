import { cn } from "@/lib/cn";

/**
 * Status chips.
 *
 * Status is encoded in shape *and* color — a dot glyph plus a label — never color
 * alone (WCAG 1.4.1). A colorblind user reading "Overdue" gets the same information
 * as everyone else, and the chip still works in a printed page.
 */

export type ChipTone = "neutral" | "accent" | "critical" | "warning" | "success" | "info";

const TONES: Record<ChipTone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-surface-sunken text-ink-secondary border-line", dot: "bg-ink-tertiary" },
  accent: { chip: "bg-accent-soft text-accent border-transparent", dot: "bg-accent" },
  critical: { chip: "bg-critical-soft text-critical border-transparent", dot: "bg-critical" },
  warning: { chip: "bg-warning-soft text-warning border-transparent", dot: "bg-warning" },
  success: { chip: "bg-success-soft text-success border-transparent", dot: "bg-success" },
  info: { chip: "bg-info-soft text-info border-transparent", dot: "bg-info" },
};

export interface ChipProps {
  tone?: ChipTone | undefined;
  children: React.ReactNode;
  /** Renders the status dot. Off for pure labels (counts, categories). */
  dot?: boolean | undefined;
  size?: "sm" | "md" | undefined;
  className?: string | undefined;
  title?: string | undefined;
}

export function Chip({
  tone = "neutral",
  children,
  dot = false,
  size = "md",
  className,
  title,
}: ChipProps) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
        t.chip,
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} /> : null}
      {children}
    </span>
  );
}

/** Obligation status → tone, in one place so every screen agrees. */
export const OBLIGATION_TONE: Record<string, ChipTone> = {
  upcoming: "neutral",
  action_needed: "warning",
  in_progress: "info",
  waiting: "info",
  done: "success",
  dismissed: "neutral",
  missed: "critical",
};

export const OBLIGATION_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  action_needed: "Needs action",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  dismissed: "Dismissed",
  missed: "Missed",
};

/** Obligation kind → plain English. The enum values are wire shapes, not copy. */
export const OBLIGATION_KIND_LABEL: Record<string, string> = {
  renewal: "Renewal",
  payment: "Payment",
  cancellation_window: "Cancellation window",
  filing: "Filing",
  claim: "Claim",
  enrollment: "Enrollment",
  appointment: "Appointment",
  custom: "Task",
};

export const ITEM_TONE: Record<string, ChipTone> = {
  active: "success",
  expiring: "warning",
  expired: "critical",
  cancelled: "neutral",
  archived: "neutral",
};

export const DOC_STATUS_TONE: Record<string, ChipTone> = {
  received: "neutral",
  scanning: "info",
  processing: "info",
  needs_review: "warning",
  processed: "success",
  rejected: "critical",
  failed: "critical",
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  received: "Received",
  scanning: "Checking",
  processing: "Reading",
  needs_review: "Needs review",
  processed: "Filed",
  rejected: "Rejected",
  failed: "Failed",
};
