-- Server-side idempotency storage (blueprint P1-05; contract ADR-011 D13; store ADR-012).
--
-- WHY A TABLE AND NOT REDIS
-- -------------------------
-- doc 03 §1 says "keys stored 24h in Redis". No Redis client is a dependency of this
-- repository, no code opens a connection, and `.env.example` classifies REDIS_URL as
-- "local only" while listing what every deployed environment needs — Redis is not on that
-- list. ADR-011 D13, which is the authoritative idempotency contract, fixes the retention
-- at 24 hours and deliberately names no store. ADR-012 records the decision to satisfy it
-- in Postgres: the database the request is already inside, in the same transaction system
-- the domain write uses, with RLS already enforcing tenancy.
--
-- MIGRATION IMPACT (CLAUDE.md working agreements)
-- -----------------------------------------------
-- LOCK IMPACT: none worth measuring. Every statement below creates a NEW object — a type,
--   a table, its indexes, its policy. CREATE TABLE takes no lock on anything that exists;
--   the indexes are built on an empty table, so CONCURRENTLY would buy nothing and cannot
--   be used inside the transaction Prisma wraps a migration in. The two ALTER TABLE
--   statements target the table created six lines above them.
--
-- TABLE SIZE AT 100k HOUSEHOLDS: bounded by 24 hours of write traffic, not by household
--   count — a row exists only between a POST and its expiry. At a pessimistic 50 domain
--   POSTs per household per day that is 5M rows; at a realistic 2 (this is a filing
--   product, not a chat app) it is 200k. Row width is dominated by `response_body`, which
--   holds one serialized `/v1` response — hundreds of bytes, not megabytes, because doc
--   03 §1 caps collections at 100 items and POST responses are single resources.
--
-- RETENTION: `expires_at` is authoritative and lookups ignore lapsed rows. The boundary
--   also sweeps its own (household, user) partition opportunistically on each claim, so a
--   household that keeps writing keeps its own rows bounded. A household that stops
--   writing leaves its last rows until it writes again — the index below exists so that a
--   scheduled sweep can be added cheaply when the outbox dispatcher lands (P1-13). This
--   migration deliberately does not invent that worker.
--
-- ROLLBACK: forward-fix. Dropping the table is safe at any time — nothing references it,
--   no domain row points at it, and losing every record only means the next retry of an
--   in-flight request executes instead of replaying. The reverse migration is
--   `DROP TABLE "idempotency_keys"; DROP TYPE "IdempotencyState";` and needs no data
--   backfill in either direction.

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('in_flight', 'completed');

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "path" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "state" "IdempotencyState" NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "response_headers" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- The uniqueness that makes the claim atomic. `INSERT ... ON CONFLICT DO UPDATE` against
-- this index is what serializes two simultaneous identical requests: the second waits for
-- the first to commit and then reads its row instead of executing anything.
CREATE UNIQUE INDEX "idempotency_keys_household_id_user_id_key_key"
  ON "idempotency_keys"("household_id", "user_id", "key");

-- Serves the per-principal expiry sweep the boundary runs on each claim.
CREATE INDEX "idempotency_keys_household_id_user_id_expires_at_idx"
  ON "idempotency_keys"("household_id", "user_id", "expires_at");

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A completed record must actually carry the response it promises to replay. Without this
-- a bug that marked a row `completed` without persisting the body would answer a retry
-- with a null response instead of failing, which is the one outcome worse than a 409.
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_completed_has_response"
  CHECK (state <> 'completed' OR response_status IS NOT NULL);

-- ─────────────────────────── row-level security ───────────────────────────
--
-- STRICTER THAN household_isolation, DELIBERATELY.
--
-- Every other household-scoped table is shared: two members of one household are meant to
-- see the same documents. An idempotency record is not shared — it holds one principal's
-- response verbatim, so scoping it by household alone would let a second member of the
-- same household replay the first member's answer by guessing (or observing) their key.
-- The predicate therefore requires BOTH settings, which `withHousehold` establishes
-- together (`packages/db/src/scoped.ts`): household from the validated request context,
-- principal from the audit actor.
--
-- It fails closed like every other policy here: with either GUC unset the predicate is
-- NULL and no row is visible or writable.
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_owner_isolation ON "idempotency_keys"
  FOR ALL
  USING (
    household_id = app.current_household()
    AND user_id = app.current_user_id()
  )
  WITH CHECK (
    household_id = app.current_household()
    AND user_id = app.current_user_id()
  );

-- The RLS migration's ALTER DEFAULT PRIVILEGES already covers a table created by the same
-- owner. Stated explicitly anyway: a grant that exists only as a side effect of an earlier
-- migration is a grant nobody can find when they go looking for it.
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO app_user, app_dispatcher;
