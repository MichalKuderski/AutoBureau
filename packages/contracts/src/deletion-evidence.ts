import { z } from "zod";

/** ADR-018 proposal: evidence coverage, never deletion authority. No personal content. */
export const DELETION_COMPONENTS = ["documents", "quarantine", "derived-records", "identifier-secrets",
  "notifications-reminders", "outbox-delivery-inbox", "job-artifacts", "account-household",
  "provider-references", "audit", "telemetry", "backups"] as const;
const time = z.string().datetime({ offset: true });
const observation = z.object({
  component: z.enum(DELETION_COMPONENTS), requestId: z.string().uuid(), householdId: z.string().uuid(),
  evidenceId: z.string().uuid(), observedAt: time,
  state: z.enum(["absent", "remaining", "unknown", "retained"]),
  remaining: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  retention: z.object({ kind: z.enum(["backup-expiry", "security-hold", "provider-policy"]), until: time }).strict().optional(),
}).strict();
const assessment = z.object({
  version: z.literal(1), requestId: z.string().uuid(), householdId: z.string().uuid(),
  requestedAt: time, writesFencedAt: time, observations: z.array(observation).max(DELETION_COMPONENTS.length),
}).strict();
const day = 86_400_000;
export const DELETION_GRACE_MS = 14 * day;
export const BACKUP_MAX_RETENTION_MS = 35 * day;
export const DELETION_OBSERVATION_MAX_AGE_MS = 5 * 60_000;

/** A structurally complete report still needs authenticated observations, a durable
 * journal and independent read-back. This function NEVER issues a deletion receipt. */
export function assessDeletionEvidence(input: unknown, now: Date) {
  const data = assessment.safeParse(input);
  const invalid = { status: "incomplete" as const, receiptIssuable: false as const, gaps: [...DELETION_COMPONENTS] };
  if (!data.success || !Number.isFinite(now.getTime())) return invalid;
  const value = data.data, fenced = Date.parse(value.writesFencedAt), requested = Date.parse(value.requestedAt);
  if (fenced < requested + DELETION_GRACE_MS || fenced > now.getTime()) return invalid;
  const gaps: string[] = [], retained: string[] = [];
  for (const component of DELETION_COMPONENTS) {
    const rows = value.observations.filter(row => row.component === component);
    const row = rows[0];
    if (rows.length !== 1 || !row || row.requestId !== value.requestId || row.householdId !== value.householdId
      || Date.parse(row.observedAt) < fenced || Date.parse(row.observedAt) > now.getTime()
      || now.getTime() - Date.parse(row.observedAt) > DELETION_OBSERVATION_MAX_AGE_MS) { gaps.push(component); continue; }
    if (row.state === "absent" && row.remaining === 0 && !row.retention) continue;
    const kind = row.retention?.kind, until = row.retention ? Date.parse(row.retention.until) : NaN;
    const validRetention = row.state === "retained" && row.remaining > 0 && until > now.getTime()
      && ((component === "backups" && kind === "backup-expiry" && until <= fenced + BACKUP_MAX_RETENTION_MS)
        || (component === "audit" && kind === "security-hold" && until <= now.getTime() + BACKUP_MAX_RETENTION_MS)
        || (component === "provider-references" && kind === "provider-policy" && until <= now.getTime() + BACKUP_MAX_RETENTION_MS));
    if (validRetention) retained.push(component); else gaps.push(component);
  }
  return { status: gaps.length ? "incomplete" as const : "ready-for-independent-verification" as const,
    receiptIssuable: false as const, gaps, retained };
}
