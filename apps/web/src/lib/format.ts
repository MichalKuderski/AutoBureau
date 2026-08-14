/**
 * Formatting primitives.
 *
 * Two rules this product cannot break (PRD §15, FOUNDING_PRINCIPLES §4):
 *   1. Dates are rendered in the household's timezone, never the browser's guess,
 *      because an obligation due "tomorrow" must mean tomorrow where the user lives.
 *   2. Relative time is calm: "in 12 days", never "ONLY 12 DAYS LEFT".
 */

export type Money = { amountCents: number; currency: string };

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${timeZone}|${JSON.stringify(opts)}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone });
    dateFormatters.set(key, f);
  }
  return f;
}

export function formatDate(
  value: string | Date,
  { locale = "en-US", timeZone = "UTC", style = "medium" }:
    { locale?: string; timeZone?: string; style?: "short" | "medium" | "long" } = {},
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", day: "numeric" }
      : style === "long"
        ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  return dateFormatter(locale, timeZone, opts).format(d);
}

/** Clock time in the household's timezone. Separate from formatDate because a
 *  timeline needs "3:42 PM" without repeating the date on every row. */
export function formatTime(
  value: string | Date,
  { locale = "en-US", timeZone = "UTC" }: { locale?: string; timeZone?: string } = {},
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter(locale, timeZone, { hour: "numeric", minute: "2-digit" }).format(d);
}

/** Whole days between now and `value`, computed in the household's timezone. */
export function daysUntil(value: string | Date, timeZone = "UTC", now: Date = new Date()): number {
  const target = typeof value === "string" ? new Date(value) : value;
  const dayInTz = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return Date.UTC(
      Number(parts.slice(0, 4)),
      Number(parts.slice(5, 7)) - 1,
      Number(parts.slice(8, 10)),
    );
  };
  return Math.round((dayInTz(target) - dayInTz(now)) / 86_400_000);
}

/** Calm relative time. Never exclamatory, never all-caps. */
export function formatDueLabel(value: string | Date, timeZone = "UTC", now?: Date): string {
  const days = daysUntil(value, timeZone, now);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "Was due yesterday";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days < 30) return `Due in ${days} days`;
  const months = Math.round(days / 30);
  if (months === 1) return "Due in about a month";
  if (months < 12) return `Due in about ${months} months`;
  const years = Math.round(days / 365);
  return years === 1 ? "Due in about a year" : `Due in about ${years} years`;
}

export function formatMoney(
  money: Money | null | undefined,
  locale = "en-US",
): string {
  if (!money) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: money.amountCents % 100 === 0 ? 0 : 2,
  }).format(money.amountCents / 100);
}

/**
 * Recurrence, in the one dimension this product actually renders: how often.
 *
 * Deliberately not an RRULE parser. We store the rule verbatim so a future scheduler
 * can honour it exactly; here we only need to tell a person "every year", and a rule
 * we can't confidently summarise returns null so the caller renders nothing rather
 * than a wrong sentence.
 */
const RECURRENCE_LABELS: Record<string, string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  YEARLY: "Every year",
};

export function formatRecurrence(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const freq = /(?:^|;)FREQ=([A-Z]+)/.exec(rule)?.[1];
  if (!freq) return null;
  // An interval other than 1 changes the meaning ("every 2 years"); rather than
  // guess the phrasing we decline to summarise.
  const interval = /(?:^|;)INTERVAL=(\d+)/.exec(rule)?.[1];
  if (interval && interval !== "1") return null;
  return RECURRENCE_LABELS[freq] ?? null;
}

/**
 * The inverse of `formatMoney` for a typed amount.
 *
 * Money is integer cents everywhere (PRD §12), so the float→int conversion happens
 * exactly here rather than at each input. More than two decimal places is rejected
 * rather than silently rounded: a user who typed `12.345` meant something, and
 * guessing which cent they meant is how ledgers drift.
 */
export function parseCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Masked display for identifier-grade values. The full value never reaches the client. */
export function formatMasked(last4: string | null | undefined): string {
  return last4 ? `•••• ${last4}` : "••••";
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
