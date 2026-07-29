import { EventEnvelopeSchema, type EventType } from "@autobureau/contracts";
import type { ScopedClient } from "./scoped.js";

/**
 * Transactional outbox writer (ADR-005).
 *
 * The rule this enforces mechanically: a domain change and its event are written
 * in ONE transaction, or neither is. Handlers never publish to Redis directly —
 * a dual write eventually drops one side, and in this product a lost
 * `document.uploaded` is a silently unprocessed passport.
 *
 * Usage is intentionally shaped so the event cannot escape the transaction:
 *
 *   await db.withHousehold(householdId, async (tx) => {
 *     const doc = await tx.document.update({ ... });
 *     await outbox(tx).emit({
 *       event_type: "document.uploaded",
 *       aggregate_type: "document",
 *       aggregate_id: doc.id,
 *       household_id: householdId,
 *       payload: { source: doc.source },
 *     });
 *   });
 */

export interface OutboxWrite {
  event_type: EventType;
  aggregate_type: string;
  aggregate_id: string;
  household_id: string | null;
  /** IDs and minimal scalars only — consumers re-read authoritative rows (doc 07 §1). */
  payload?: Record<string, string | number | boolean | null>;
  traceparent?: string;
}

export function outbox(tx: ScopedClient) {
  return {
    async emit(event: OutboxWrite): Promise<void> {
      // Validate here rather than at the consumer: a malformed event that reaches
      // the stream is a 3am problem; one rejected at write time is a test failure.
      const parsed = EventEnvelopeSchema.parse({
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        household_id: event.household_id,
        payload: event.payload ?? {},
        ...(event.traceparent === undefined ? {} : { traceparent: event.traceparent }),
      });

      await tx.outboxEvent.create({
        data: {
          eventType: parsed.event_type,
          aggregateType: parsed.aggregate_type,
          aggregateId: parsed.aggregate_id,
          householdId: parsed.household_id,
          payload: parsed.payload,
          traceparent: parsed.traceparent ?? null,
        },
      });
    },
  };
}
