# 07 — Background Jobs & Event Architecture

## 1. Principles

- **No dual writes.** A request handler never writes Postgres *and* publishes to Redis. It writes Postgres (domain rows + outbox row) in one transaction; a dispatcher does the publishing. Exactly-once *intent*, at-least-once *delivery*, idempotent *consumers*.
- **Events carry IDs, not state.** Consumers re-read authoritative rows; payloads can't go stale and PII doesn't ride the bus.
- **Redis is a conveyor, not a database.** Everything in Redis is reconstructible from Postgres.

## 2. Transactional outbox → Redis Streams

```
handler tx: [domain writes] + INSERT outbox_events
                 │
   dispatcher (worker, 250 ms poll batches of 500,
   FOR UPDATE SKIP LOCKED — safe to run 2×)
                 │ XADD events:{domain}  (streams: events:documents,
                 │  events:obligations, events:automation, events:notifications, events:system)
                 ▼
   consumer groups per concern, e.g. on events:documents:
     cg:pipeline       → runs document_intake
     cg:notifications  → "document processed" notices
     cg:analytics      → PostHog server events
                 │
   consumers: XAUTOCLAIM for crashed peers (idle > 5 min),
   ack on success, retry ×3 w/ backoff → DLQ stream + alert
```

Retention: streams trimmed to 7 days (`XTRIM MINID`); replay beyond that = re-emit from outbox (kept 30 days, then archived to S3).

## 3. Idempotency

Every consumer: `SETNX processed:{consumer}:{event_id} EX 7d` before side effects; domain writes additionally use natural idempotent shapes (upsert by deterministic key, e.g. reminder `(obligation_id, offset_label)`). Consumers must tolerate replays *and* reordering within a domain (they re-read state, so ordering matters less than it appears).

## 4. Event taxonomy (launch set)

| Event | Producer | Consumers |
|---|---|---|
| `document.uploaded` | web (complete endpoint) | pipeline |
| `document.processed` / `document.needs_review` / `document.failed` | pipeline worker | notifications, analytics |
| `email.received` | inbound webhook | email-matcher |
| `item.created` / `item.updated` / `item.expiring` | web, pipeline, radar | radar (incremental), notifications |
| `obligation.created` / `obligation.updated` / `obligation.completed` / `obligation.dismissed` | web, radar, pipeline | reminder-materializer, notifications, analytics |
| `reminder.due` | scheduler | notification-sender |
| `task_run.awaiting_approval` / `approval.decided` / `task_run.finished` | AI service, web | workflow-resumer, notifications |
| `radar.completed` | radar workflow | digest-builder |
| `user.deletion_requested` | web | deletion-cascade job |
| `export.requested` | web | export-builder |

Naming: `aggregate.past_tense_fact`. New events require a row in this table (the doc is the registry until an in-code registry exists).

## 5. Scheduled work

Single scheduler task (ECS, singleton via Redis lock `SET NX PX`) ticking croniter definitions; every tick just *emits events* — the scheduler contains no business logic:

| Schedule | Emits |
|---|---|
| every minute | `reminder.due` scan: indexed query on `reminders (status='scheduled', remind_at <= now)` |
| hourly | pipeline watchdog (stuck docs, doc 05 §6); outbox-lag check |
| daily 04:00 local-staggered | item status roll (`active→expiring→expired`), obligation `upcoming→action_needed` transitions |
| weekly per household (tz-staggered) | `radar.tick` |
| monthly | `subscription_audit.tick`; Redis stream trim audit; key-rotation reminders |
| daily 05:00 UTC | backup verification job (doc 09 §7) |

## 6. Dead letters & replay

DLQ per stream (`dlq:events:{domain}`) with the original event + failure metadata. Ops runbook: inspect → fix → `replay` CLI (re-XADD with a `replay_of` marker). DLQ depth > 0 for 30 min pages on-call (which is "the team" for now).

## 7. Why not Celery / BullMQ / SQS / Inngest (recorded so it isn't re-litigated monthly)

- **Celery**: heavier than needed, weak typing, we'd fight its serialization; our consumers are thin wrappers over LangGraph calls anyway.
- **BullMQ**: good, but TS-side — our consumers are Python (AI-adjacent). Split-brain queue ownership is worse than one queue idiom.
- **SQS/EventBridge**: the likely phase-2 destination (doc 14) — but adds an AWS-console dependency to local dev today; Redis Streams runs in docker-compose.
- **Inngest/Trigger.dev**: attractive DX, but puts our event spine on a young third party and complicates the zero-egress posture for PII events. Revisit if ops load proves painful.

The outbox pattern is the load-bearing decision (ADR-005); the transport behind the dispatcher is swappable by design.
