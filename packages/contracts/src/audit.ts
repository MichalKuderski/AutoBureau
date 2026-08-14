import { z } from "zod";

/**
 * Audit action registry (ADR-009 D6).
 *
 * Two layers write `audit_log`. The infrastructure floor records every mutation with
 * a CRUD-derived action (`item.create`) and an actor the database itself stamps. This
 * registry is the layer above: the domain verbs that replace that CRUD action where it
 * would be ambiguous or insufficient.
 *
 * A verb belongs here in exactly three cases (D6):
 *   1. a lifecycle transition where one CRUD operation maps to several user-meaningful
 *      outcomes — dismiss, complete and reopen are all `obligation.update`;
 *   2. a privileged operation (the owner-only rows of doc 06 §3);
 *   3. a security-sensitive action no write-interceptor can observe — `secret.revealed`
 *      is a *read*, so nothing but an explicit call will ever record it.
 *
 * Ordinary creates and field edits stay CRUD-level. `item.create` is a complete and
 * honest answer, and a taxonomy nobody reads is worse than no taxonomy.
 *
 * This is deliberately NOT `EVENT_TYPES`. The two measure different axes: not every
 * event is user-caused (`reminder.due`, `radar.completed`), and not every audited action
 * has an async consumer — putting `secret.revealed` in the outbox taxonomy would imply a
 * subscriber that does not exist. Same dotted `aggregate.verb` convention, separate list.
 *
 * Adding an action is a contracts PR, exactly as it is for an event type. The list starts
 * at what the governing documents actually name; it grows when a surface needs it.
 */

export const AUDIT_ACTIONS = [
  /** doc 12 §5.3 / PRD §13, F8: revealing an identifier-grade value is always audited. */
  "secret.revealed",
  /** doc 02 §9's own worked example, and the reason the verb layer exists at all. */
  "obligation.dismissed",
  /** PRD F9: completion carries outcome capture; it is not the same event as a dismissal. */
  "obligation.completed",
  /** PRD F9: dismissed obligations are recoverable for 30 days — the inverse transition. */
  "obligation.reopened",
] as const;

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** Actor kinds mirror the `actor_type` enum in doc 02 §9. */
export const ACTOR_TYPES = ["user", "agent", "system"] as const;
export const ActorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorTypeSchema>;
