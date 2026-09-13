import { z } from "zod";
import { EventTypeSchema, type EventType } from "./events.js";

/** ADR-017: queue contents are an opaque reference, never an event payload. */
export const JobScopeSchema = z.enum(["stg", "preview"]);
export type JobScope = z.infer<typeof JobScopeSchema>;
export const JobConsumerSchema = z.enum([
  "pipeline", "notifications", "analytics", "email-matcher", "radar",
  "reminder-materializer", "notification-sender", "digest-builder", "deletion-cascade", "export-builder",
]);
export type JobConsumer = z.infer<typeof JobConsumerSchema>;
export type JobQueue = "pipeline" | "notifications";
export const JobEnvelopeSchema = z.object({
  version: z.literal(1),
  event_id: z.string().regex(/^[1-9][0-9]{0,18}$/).pipe(z.string().refine((v) => BigInt(v) <= 9223372036854775807n)),
  household_id: z.string().uuid(),
  event_type: EventTypeSchema,
  consumer: JobConsumerSchema,
}).strict();
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

export const JOB_ROUTES: Readonly<Record<EventType, readonly JobConsumer[]>> = {
  "document.uploaded": ["pipeline"],
  "document.processed": ["notifications", "analytics"],
  "document.needs_review": ["notifications", "analytics"],
  "document.failed": ["notifications", "analytics"],
  "email.received": ["email-matcher"],
  "item.created": ["radar", "notifications"],
  "item.updated": ["radar", "notifications"],
  "item.expiring": ["radar", "notifications"],
  "obligation.created": ["reminder-materializer", "notifications", "analytics"],
  "obligation.updated": ["reminder-materializer", "notifications", "analytics"],
  "obligation.completed": ["reminder-materializer", "notifications", "analytics"],
  "obligation.dismissed": ["reminder-materializer", "notifications", "analytics"],
  "reminder.due": ["notification-sender"],
  "radar.completed": ["digest-builder"],
  "notification.requested": ["notification-sender"],
  "user.deletion_requested": ["deletion-cascade"],
  "export.requested": ["export-builder"],
};
export function jobQueue(consumer: JobConsumer): JobQueue {
  return ["notifications", "notification-sender", "digest-builder"].includes(consumer) ? "notifications" : "pipeline";
}
/** Reject extra keys rather than silently stripping a accidentally supplied payload. */
export function encodeJobEnvelope(value: unknown): string { return JSON.stringify(JobEnvelopeSchema.parse(value)); }
export function decodeJobEnvelope(body: string): JobEnvelope {
  if (body.length > 512) throw new Error("Invalid job envelope");
  const parsed = JobEnvelopeSchema.parse(JSON.parse(body));
  if (!JOB_ROUTES[parsed.event_type].includes(parsed.consumer)) throw new Error("Invalid job route");
  return parsed;
}

/** Current consumer step is database-only: 2s pool wait + 5s transaction, never scanning/model I/O.
 * Budget conservatively includes a full receive deadline, acknowledgement, then 25% margin.
 * A future slow worker must supply a newly reviewed bound before using these queues. */
export const JOB_EXECUTION_BUDGET = Object.freeze({
  receiveTimeoutMs: 30_000, longPollSeconds: 20, databaseWaitMs: 2_000,
  databaseTransactionMs: 5_000, acknowledgementTimeoutMs: 10_000, safetyMargin: 0.25,
  visibilitySeconds: 60, maxVisibilityLifetimeSeconds: 120, maxVisibilityExtensions: 1,
  maxConcurrentMessages: 1, maxReceives: 3,
});
