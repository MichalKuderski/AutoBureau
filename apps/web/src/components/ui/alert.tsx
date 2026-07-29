import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/**
 * Inline alert.
 *
 * Tone is semantic, never decorative, and never used to manufacture urgency
 * (FOUNDING_PRINCIPLES §4). `critical` is reserved for things that are actually
 * losable — a lapsing registration, a closing enrollment window. A subscription
 * renewing is `info`, however much a growth team might wish otherwise.
 *
 * Assertive live-region only for `critical`: interrupting a screen-reader user
 * mid-sentence is justified when a deadline is at stake and rude otherwise.
 */

export type AlertTone = "info" | "success" | "warning" | "critical";

const TONE: Record<AlertTone, { wrap: string; icon: string; Glyph: typeof Icon.Alert }> = {
  info: {
    wrap: "border-info/25 bg-info-soft",
    icon: "text-info",
    Glyph: Icon.Sparkle,
  },
  success: {
    wrap: "border-success/25 bg-success-soft",
    icon: "text-success",
    Glyph: Icon.Check,
  },
  warning: {
    wrap: "border-warning/30 bg-warning-soft",
    icon: "text-warning",
    Glyph: Icon.Clock,
  },
  critical: {
    wrap: "border-critical/30 bg-critical-soft",
    icon: "text-critical",
    Glyph: Icon.Alert,
  },
};

export interface AlertProps {
  tone?: AlertTone | undefined;
  title: string;
  children?: React.ReactNode | undefined;
  action?: React.ReactNode | undefined;
  className?: string | undefined;
}

export function Alert({ tone = "info", title, children, action, className }: AlertProps) {
  const { wrap, icon, Glyph } = TONE[tone];
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-3.5", wrap, className)}
    >
      <Glyph className={cn("mt-0.5 size-4 shrink-0", icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {children ? <div className="mt-1 text-sm text-ink-secondary">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
