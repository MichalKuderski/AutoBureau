import { Temporal } from "@js-temporal/polyfill";

export interface DeadlineInstant { iso: string; offset: string }
/** DST gaps are invalid; folds need an explicit choice instead of silent normalization.
 * See https://tc39.es/proposal-temporal/docs/timezone.html#ambiguity-due-to-dst-or-other-time-zone-offset-changes
 */
export function deadlineInstants(date: string, time: string, zone: string): DeadlineInstant[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return [];
  try {
    const local = Temporal.PlainDateTime.from(`${date}T${time}`, { overflow: "reject" });
    const candidates = (["earlier", "later"] as const).map((disambiguation) => local.toZonedDateTime(zone, { disambiguation }));
    const result = new Map<string, DeadlineInstant>();
    for (const candidate of candidates) {
      if (!candidate.toPlainDateTime().equals(local)) continue;
      const iso = candidate.toInstant().toString();
      result.set(iso, { iso, offset: candidate.offset });
    }
    return [...result.values()];
  } catch { return []; }
}
export function deadlineLocal(iso: string, zone: string) {
  const value = Temporal.Instant.from(iso).toZonedDateTimeISO(zone);
  return { date: value.toPlainDate().toString(), time: value.toPlainTime().toString({ smallestUnit: "second" }),
    iso: value.toInstant().toString(), choice: value.with({ millisecond: 0, microsecond: 0, nanosecond: 0 }).toInstant().toString() };
}
