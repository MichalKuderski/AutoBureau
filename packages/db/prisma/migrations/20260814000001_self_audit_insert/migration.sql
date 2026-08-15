-- Household-less audit rows for identity mirroring (ADR-009 D8).
--
-- WHY THIS EXISTS
-- ---------------
-- A Supabase-authenticated principal has no rows in this database until something
-- mirrors them into `users` / `user_profiles`. Until then `household_users` yields no
-- membership and every request resolves to 403 — a person can hold a valid session and
-- reach nothing.
--
-- Mirroring is a state mutation, so FOUNDING_PRINCIPLES invariant 9 requires an audit
-- row for it. But it happens before any household exists, and `audit_insert` checks
-- `household_id = app.current_household()`, which a NULL household can never satisfy.
-- Invariant 9 is therefore currently unsatisfiable for identity writes: not awkward,
-- refused by policy.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not touch `audit_insert`. Policies are permissive and OR together, so the
-- household-scoped path is unchanged and this adds one narrow alternative:
--
--   household row, matching household   -> audit_insert         allowed
--   NULL household, matching actor      -> self_audit_insert    allowed
--   NULL household, different actor     -> neither              refused
--   foreign household                   -> neither              refused
--
-- It grants no read. `audit_read` still requires `household_id = app.current_household()`,
-- and NULL is never equal to a household, so these rows are write-only to `app_user` —
-- visible to the dispatcher/ops path and to nobody's tenant-scoped query.
--
-- It cannot be used to forge attribution. `actor_id` defaults to `app.current_user_id()`
-- (the principal-scope migration) and the CHECK below compares the *resulting* row's
-- actor to that same setting, so a caller who supplies someone else's id is rejected
-- rather than silently corrected.
--
-- It is not a tenancy hole. A row carrying no household cannot be read through a
-- household scope, and writing one confers no access to anything.

CREATE POLICY self_audit_insert ON "audit_log"
  FOR INSERT
  WITH CHECK (
    household_id IS NULL
    AND actor_id = app.current_user_id()
  );
