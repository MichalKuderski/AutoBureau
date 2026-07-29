# ADR-005: Transactional outbox + Redis Streams for events and jobs

**Status:** Accepted (2026-07-28; implemented) · **Date:** 2026-07-22

## Context
The brief asks for background workers and event-driven architecture. The failure mode to design against is dual-writes: a handler that commits to Postgres and then publishes to a broker will eventually do one without the other, and in this product a lost `document.uploaded` is a silently unprocessed passport.

## Decision
Two-part spine (mechanics in doc 07):
1. **Transactional outbox in Postgres** — domain writes and `outbox_events` rows commit atomically; a dispatcher publishes with `FOR UPDATE SKIP LOCKED` batching.
2. **Redis Streams (Upstash)** as transport — consumer groups per concern, `XAUTOCLAIM` recovery, DLQ streams, 7-day trim.

Guarantees: exactly-once intent (outbox), at-least-once delivery (streams), idempotent consumers (dedupe keys + upsert shapes). Events carry IDs, not state.

## Consequences
- ✅ Zero lost intents; replayable (outbox retained 30 d, then S3); runs in docker-compose for local dev; one Redis serves queues + rate limits + cache.
- ✅ **The load-bearing choice is the outbox; the transport is a swappable detail** — doc 14 Phase 2 can point the dispatcher at SQS/Kafka without touching producers or the consumer contract.
- ⚠️ Dispatcher poll adds ≤250 ms event latency — irrelevant for our workloads (nothing user-blocking rides the bus).
- ⚠️ At-least-once means every consumer must be written idempotent — enforced by the consumer template + integration tests, not memory.
- ❌ Rejected (doc 07 §7 details): Celery, BullMQ, SQS-first, Inngest/Trigger.dev, Kafka-now (operational heft with no current consumer that needs its semantics).
