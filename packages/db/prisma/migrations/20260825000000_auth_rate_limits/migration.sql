-- Authentication rate-limit counters (blueprint P1-08; decisions ADR-013 D3/D4).
--
-- WHY A TABLE AND NOT REDIS
-- -------------------------
-- Identical to ADR-012's finding, re-verified at the accepting commit: Redis appears in no
-- `package.json` dependency, in zero entries of `pnpm-lock.yaml`, and in no code that opens
-- a connection. `.env.example` classifies `REDIS_URL` as "local only" while listing what
-- every deployed environment needs, and Redis is not on that list. `12-security.md` §7 names
-- Upstash, but names it inside a design where Redis was already load-bearing; ADR-013 D1
-- narrows that for this limiter only.
--
-- WHY THIS TABLE IS UNLIKE EVERY OTHER TABLE HERE
-- -----------------------------------------------
-- It is the only one written by a request with no principal and no household. A sign-in
-- attempt is counted BEFORE any token is verified, so there is no tenant to scope it to.
-- That drives three things below: no `household_id`, no foreign keys, and an RLS policy
-- that is permissive rather than tenant-keyed. Each is deliberate and each is explained.
--
-- MIGRATION IMPACT (CLAUDE.md working agreements)
-- -----------------------------------------------
-- LOCK IMPACT: none worth measuring. Every statement creates a NEW object — a table, its
--   two indexes, its policy, its grants. CREATE TABLE takes no lock on anything that
--   exists; the indexes are built on an empty table, so CONCURRENTLY would buy nothing and
--   cannot be used inside the transaction Prisma wraps a migration in. No existing table,
--   policy, or grant is altered — a reviewer can check that claim by grepping this file for
--   any identifier other than `auth_rate_limits`.
--
-- TABLE SIZE AT 100k HOUSEHOLDS: bounded by DISTINCT BUCKETS PER WINDOW, not by attempts
--   and not by household count. At most one row per (policy, distinct identifier) and one
--   per (policy, distinct IP) per 15-minute window; a million guesses against one account
--   are a million UPDATEs to ONE row. With 100k households signing in a few times a day the
--   steady state is thousands of rows, not millions, and each is a few dozen bytes — no
--   bodies, no headers, nothing like `idempotency_keys.response_body`. The pathological
--   case, an enumeration run across many distinct addresses, is the case where the per-IP
--   policy is simultaneously firing and capping the rate at which new buckets appear.
--
-- RETENTION: `expires_at` is authoritative and every read ignores lapsed rows, so
--   correctness never depends on a cleaner running. The limiter also sweeps a bounded batch
--   of its own policy's expired rows on each increment, which keeps a busy policy bounded by
--   live traffic. The `expires_at` index exists so a scheduled sweep can be added cheaply
--   once the outbox dispatcher lands (P1-13). This migration deliberately does not invent
--   that worker. Retention here is minutes, not the 24 hours `idempotency_keys` needs: a
--   window is over when it is over, so the table accumulates no history of who tried to
--   sign in.
--
-- ROLLBACK: forward-fix. Dropping the table is safe at any time — nothing references it, no
--   domain row points at it, and losing every row only means in-flight windows restart at
--   zero. The reverse migration is `DROP TABLE "auth_rate_limits";` with no data backfill in
--   either direction. The application-level consequence of dropping it is that these
--   endpoints return to their pre-P1-08 posture: no application-layer limit at all.

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "policy" VARCHAR(64) NOT NULL,
    "bucket" CHAR(64) NOT NULL,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- The uniqueness that makes the counter atomic. `INSERT … ON CONFLICT DO UPDATE` against
-- this index both records the attempt and returns the running total in one statement, so
-- there is no window in which two concurrent requests read the same value and each write
-- back "one more". This is the whole reason the counter is safe without application locking.
CREATE UNIQUE INDEX "auth_rate_limits_policy_bucket_window_started_at_key"
  ON "auth_rate_limits"("policy", "bucket", "window_started_at");

-- Serves the opportunistic expiry sweep the limiter runs on each increment.
CREATE INDEX "auth_rate_limits_expires_at_idx" ON "auth_rate_limits"("expires_at");

-- Attempts are counted, never decremented. A negative counter would mean a bug had turned
-- a limiter into a permit, which is the one direction that must fail loudly.
ALTER TABLE "auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_attempts_non_negative"
  CHECK (attempts >= 0);

-- A window that expires before it starts is not a window. Cheap to state, and it pins the
-- one arithmetic error that would silently disable expiry.
ALTER TABLE "auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_window_before_expiry"
  CHECK (expires_at > window_started_at);

-- ─────────────────────────── row-level security ───────────────────────────
--
-- DELIBERATELY PERMISSIVE, AND THAT IS THE DECISION — NOT AN OVERSIGHT (ADR-013 D4).
--
-- Household-scoped RLS is not merely unnecessary here, it is WRONG. These rows come into
-- existence precisely when no household is known: a predicate on `app.current_household()`
-- would be NULL at write time, every insert would be denied, and the limiter would fail
-- closed on every request — not a security property, an outage. And the rows describe
-- ATTEMPTS, not tenant data; there is no household they belong to, and inventing one would
-- put a fiction inside a tenancy predicate.
--
-- RLS is still ENABLEd and FORCEd so that "every table has RLS, and the permissive ones say
-- so in their own policy" stays a checkable statement about this schema. A table with RLS
-- switched off is a hole whose justification lives only in someone's memory. This follows
-- the existing `vendors` precedent (migration 20260728000001_rls), which is likewise a
-- deliberately global table with a `USING (true)` policy; the difference is the grant, since
-- `vendors` is read-only for `app_user` and this table must be writable by the request path.
--
-- Note what is NOT relaxed: no other table's policy is touched, and the mechanism that
-- reaches this table (`Database.withGlobalTable`) sets no GUC at all — so a query issued
-- through it that named a household-scoped table would return zero rows rather than leak.
ALTER TABLE "auth_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_rate_limits" FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_rate_limits_global ON "auth_rate_limits"
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- The RLS migration's ALTER DEFAULT PRIVILEGES already covers a table created by the same
-- owner. Stated explicitly anyway, for the same reason the idempotency migration states it:
-- a grant that exists only as a side effect of an earlier migration is a grant nobody can
-- find when they go looking for it.
--
-- `app_dispatcher` is granted alongside `app_user` so that the scheduled sweep P1-13 may
-- add can run on the dispatcher role without a follow-up migration. Nothing runs there yet.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_rate_limits" TO app_user, app_dispatcher;
