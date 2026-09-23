-- Principal scope + database-enforced audit actor (ADR-009 D5).
--
-- WHY THIS EXISTS
-- ---------------
-- `household_users` is scoped by `household_id = app.current_household()`, so a request
-- that has not yet chosen a household reads zero rows from it. That makes ADR-009 D1
-- unimplementable as frozen — it has to COUNT a principal's memberships before any
-- household is selected — and it makes doc 03 §2's `/v1/me` and `/v1/households`
-- ("list mine") unimplementable too. Scope-to-candidate-then-check is not an answer: it
-- cannot run when there is no candidate, and it violates A7 when there is one.
--
-- The request therefore runs in two phases, and the database can tell them apart:
--
--   phase 1  request.user_id set, request.household_id unset
--            -> the principal may read its OWN membership and household rows
--   phase 2  both set, the household already validated against phase 1
--            -> the self-read policies switch off; household isolation is the only rule
--
-- THE `app.current_household() IS NULL` GUARD IS LOAD-BEARING.
-- Postgres policies are permissive and OR together. Without it, phase 2 returns the
-- union of the selected household's members and the principal's memberships elsewhere —
-- measured as 3 rows where 2 were correct. Not a cross-user leak, but it silently
-- falsifies "everything visible under household scope belongs to this household", and
-- code written against that rule would be wrong in a way tests rarely catch.

-- ─────────────────────────── principal accessor ───────────────────────────

-- Defined exactly like app.current_household(): NULLIF guards the empty-string case,
-- because ''::uuid raises and would turn a missing principal into a 500 rather than a
-- NULL that every predicate fails closed on.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.user_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION app.current_user_id() TO app_user, app_dispatcher;

-- ─────────────────────────── phase-1 self-reads ───────────────────────────

-- SELECT only. Membership is granted by an owner through the members API, never by the
-- principal reading its own rows — so these policies must not widen writes.
CREATE POLICY self_membership_read ON "household_users"
  FOR SELECT
  USING (user_id = app.current_user_id() AND app.current_household() IS NULL);

CREATE POLICY self_households_read ON "households"
  FOR SELECT
  USING (app.current_household() IS NULL AND EXISTS (
    SELECT 1 FROM "household_users" hu
    WHERE hu.household_id = "households".id AND hu.user_id = app.current_user_id()
  ));

-- ─────────────────────────── audit actor ───────────────────────────

-- FOUNDING_PRINCIPLES invariant 9 stops being a convention a handler author can forget
-- and becomes something Postgres refuses. The default fires only when the column is
-- omitted from the INSERT, which is exactly how the audit writer is built.
ALTER TABLE "audit_log" ALTER COLUMN actor_id SET DEFAULT app.current_user_id();

-- NOT VALID + VALIDATE in two statements: audit_log is among the largest tables at 100k
-- households (doc 02 §10), and a single ADD CONSTRAINT would hold ACCESS EXCLUSIVE for a
-- full table scan. Background actors keep working — only 'user' rows need an actor.
ALTER TABLE "audit_log" ADD CONSTRAINT audit_user_actor_requires_id
  CHECK (actor_type <> 'user' OR actor_id IS NOT NULL) NOT VALID;
ALTER TABLE "audit_log" VALIDATE CONSTRAINT audit_user_actor_requires_id;
