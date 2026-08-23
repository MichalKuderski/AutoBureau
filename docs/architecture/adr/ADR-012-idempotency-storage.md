# ADR-012 — Idempotency records live in Postgres, not Redis

**Status:** Accepted · implemented in `apps/web/src/server/http/idempotency.ts` (blueprint P1-05)
**Date:** 2026-08-23
**Supersedes:** the store named in `03-api-design.md` §1 ("keys stored 24h in Redis"). It
supersedes nothing else: **ADR-011 D13 remains the authoritative idempotency contract** and
is unchanged by this decision.

## Context

ADR-011 D13 fixes the *contract*: honored on `POST`, ignored elsewhere, replay verbatim on
a matching fingerprint, `409` on a mismatched one, 24-hour retention, and "in flight →
409; the mechanism is P1-05's to choose". It deliberately names no store.

`03-api-design.md` §1 does name one — Redis — in a summary table row written before any of
this existed. The repository does not:

| Checked | Result |
|---|---|
| Redis client dependency in any `package.json` | none |
| Code that opens a Redis connection | none |
| `.env.example` classification of `REDIS_URL` | **"local only"**, alongside `DATABASE_EXPECTED_MAJOR` |
| Variables `.env.example` says every deployed environment needs | `DATABASE_URL` and seven `AUTH_*`/`APP_ORIGIN` values — Redis is not among them |
| `docker-compose.yml` | runs Redis for local development, header notes production would use Upstash |
| `vercel.json` (P1-01) | provisions nothing |

So Redis is *intended* by ADR-005 for the outbox, and it is available on a laptop. It is
not provisioned, connected, or reachable in any environment this application actually
deploys to.

Meanwhile the thing being protected — a domain `POST` — is already inside a Postgres
transaction, inside RLS, inside a request that has resolved a household and a principal.

## Decision

**Idempotency records are rows in `idempotency_keys`, in the application's own Postgres.**

1. **Retention stays 24 hours**, as ADR-011 D13 requires. It is an `expires_at` column;
   lookups ignore lapsed rows and the boundary sweeps its own `(household, principal)`
   partition on each claim, so the table is bounded by live traffic rather than by
   cumulative history. A row is not a Redis key with a TTL, so expiry is a predicate
   rather than an eviction — the observable behaviour ADR-011 specifies is identical.
2. **Atomic claim by unique index.** `INSERT … ON CONFLICT (household_id, user_id, key) DO
   UPDATE` takes the row lock and *waits* for a competing transaction, so of two
   simultaneous identical requests exactly one executes the handler. `DO NOTHING` would
   not do: it skips without waiting, leaving the loser unable to see the winner's
   uncommitted row.
3. **RLS scoped to household AND principal** — stricter than every other table, which is
   scoped to household alone. A stored response answers one person's request; two members
   of a household share their documents, not their replies.
4. **Three transactions, and the claim commits first.** This is stated explicitly because
   it is easy to describe wrongly:

   | | |
   |---|---|
   | tx1 | claim — writes the `in_flight` row and **commits**, before the handler starts |
   | — | handler — opens its *own* `withHousehold` transaction |
   | tx2 | settle — marks `completed`, or deletes the row |

   A claim is therefore **never rolled back**; it is released by a *compensating delete*.
   The handler's rollback is not the mechanism, it is the justification for why deleting is
   safe: Prisma rolls a `$transaction` back when its callback rejects, so a throw that
   escapes a handler means the domain write did not survive and a retry has nothing to
   duplicate. The claim has to commit first, or a concurrent duplicate could not see it and
   the mechanism would be a no-op.

5. **Failure is closed, never duplicated, and never memoized.**

   | Outcome | Persisted state | Retry gets |
   |---|---|---|
   | Handler throws | released | executes |
   | Handler answers ≥ 400 | released — **only a success is stored** | executes |
   | Success, tx2 fails | `in_flight`; **the success is still returned** | 409 |
   | Crash mid-handler | `in_flight` | 409 until expiry |

   Two of these are deliberate and worth stating. A 4xx/5xx is *not* stored: replaying a
   transient 503 for 24 hours would block every ordinary retry of a request that never
   completed. And a failed `tx2` does not become a 500 — the mutation committed, so
   reporting failure would be a lie whose natural client response (retry) is the duplicate
   this module exists to prevent.

6. **An `in_flight` row is never reclaimed early.** A crash before the domain commit and a
   crash after it leave the *identical* record, so any age-based lease would be
   indistinguishable from licensing a duplicate. Only expiry clears one. 409 for the
   remainder of the retention is the price of never being wrong here.

## Why not Redis

- **It would be a new deployment dependency, decided by a mechanism task.** Adding Upstash
  means a client library, a secret in Doppler, a new per-environment variable, and a new
  outage mode — for a feature whose entire job is to make retries safe.
- **It splits the durability story.** A Redis flush loses idempotency records while the
  mutations they describe survive in Postgres. The principal-panel review logged exactly
  that as an accepted risk (`review/2026-07-23-principal-panel-review.md`) — accepted for a
  design where Redis was already load-bearing. It is not a risk worth *acquiring*.
- **The atomicity is free here and bought there.** Postgres gives the claim a unique index
  and a transaction. Redis gives `SET NX`, then needs its own answer for the window
  between the mutation committing and the response being stored.
- **Cost is two short statements** on the mutation path — one claim, one completion —
  against a connection the request already holds.

## Consequences

- ✅ Zero new infrastructure. P1-05 ships on what is already deployed.
- ✅ The contract in ADR-011 D13 is met exactly; no clause is reinterpreted.
- ✅ Tenant *and* principal isolation are enforced by the database, not by a WHERE clause.
- ⚠️ **Writes land on the primary.** Idempotency adds two round trips to every honored
  `POST`. On the read-heavy product this is negligible; if the write path ever becomes hot,
  this is the first thing to measure (P1-17 instruments transaction lifetime).
- ⚠️ **Expiry is opportunistic, not scheduled.** A household that stops posting leaves its
  last rows until it posts again. The `(household_id, user_id, expires_at)` index exists so
  a sweep can be added cheaply once the outbox dispatcher lands (P1-13). This ADR
  deliberately does not invent that worker.
- ⚠️ **Stored responses are household data.** A row can hold whatever an endpoint returned.
  It is never logged, never exposed through an endpoint, and never joined to. Cookies and
  `authorization` headers are refused at the point of capture.
- ⚠️ **One shape this layer cannot compensate for:** a handler that commits its domain
  write and *then* throws or answers a failure. Releasing the claim lets a retry duplicate
  it; retaining the claim would block every ordinary retry for a day. The boundary cannot
  see inside the handler's transaction to tell the two apart, so it takes the second risk
  over the first. This is already ruled out by `withHousehold`'s own contract — the scoped
  unit of work *is* the transaction — and it is exercised by a test
  (`commit-then-fail`) so the consequence is recorded rather than assumed.
- ↩️ **Reversible.** Nothing references the table and no domain row points at it. Dropping
  it only means the next retry of an in-flight request executes instead of replaying.
  If Redis is later provisioned for the outbox, moving these records is a swap behind one
  module — but the reason to do it would have to be measured contention, not tidiness.

## What this does not decide

- It does not change `apiFetch`, which still sends a key on `POST`, `PATCH` and `PUT`
  (ADR-011 D13 leaves it deliberately unchanged).
- It does not change ADR-005. The outbox still targets Redis Streams; that decision is
  about fan-out, not about request deduplication.
- It does not touch `/v1/auth/*` or `/v1/webhooks/*`. Both are outside ordinary domain
  idempotency (ADR-011 D13), and both are excluded structurally — the layer lives inside
  `authenticated()`, which neither uses.
