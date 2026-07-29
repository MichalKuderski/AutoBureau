import { z } from "zod";

/**
 * Event taxonomy (doc 07 §4). Adding an event type is a contracts PR — the
 * enum below is the registry. Envelope rule (doc 07 §1): payloads carry IDs
 * and minimal facts, never full state; consumers re-read authoritative rows.
 */

export const EVENT_TYPES = [
  "document.uploaded",
  "document.processed",
  "document.needs_review",
  "document.failed",
  "email.received",
  "item.created",
  "item.updated",
  "item.expiring",
  "obligation.created",
  "obligation.updated",
  "obligation.completed",
  "obligation.dismissed",
  "reminder.due",
  "radar.completed",
  "notification.requested",
  "user.deletion_requested",
  "export.requested",
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Shallow scalar-only payload: IDs + minimal facts. Nested state is a contract violation. */
const ScalarSchema = z.union([z.string(), z.number().int(), z.boolean(), z.null()]);
export const EventPayloadSchema = z.record(z.string(), ScalarSchema);

export const EventEnvelopeSchema = z.object({
  event_type: EventTypeSchema,
  aggregate_type: z.string().min(1),
  aggregate_id: z.string().uuid(),
  household_id: z.string().uuid().nullable(),
  payload: EventPayloadSchema,
  /** W3C traceparent, propagated across the outbox so async hops share a trace (doc 10 §1). */
  traceparent: z.string().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
