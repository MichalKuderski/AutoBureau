-- Row-Level Security: the second wall (ADR-002, doc 06 §5).
--
-- The application already scopes every query in code via the scoped client
-- (src/scoped.ts). These policies exist to catch the bug we WILL eventually write:
-- a raw SQL report, a forgotten scope in a new module, a mistaken join.
--
-- THREE THINGS MAKE THIS ACTUALLY WORK (review F-01 — the original design got
-- this wrong and would have shipped either a tenant leak or a deny-all):
--   1. The app connects as `app_user`, which does NOT own these tables and is
--      NOT superuser. A table owner bypasses RLS unless FORCE is set; a superuser
--      bypasses it always. We set FORCE anyway as belt-and-braces.
--   2. Scope is carried in a transaction-local GUC set via set_config(..., true),
--      which is `SET LOCAL` semantics — it dies with the transaction and therefore
--      cannot leak across pooled connections. A session-level SET would leak the
--      previous tenant's id to the next request on that connection.
--   3. If the GUC is unset, app.current_household() returns NULL and every policy
--      predicate evaluates to NULL → zero rows. The system fails CLOSED.

-- ─────────────────────────── roles ───────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_dispatcher') THEN
    -- Outbox dispatcher + deletion cascade + migrations. Bypasses RLS by design;
    -- its use is confined to two named jobs and is greppable in CI (doc 06 §5).
    CREATE ROLE app_dispatcher NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user, app_dispatcher;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, app_dispatcher;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_dispatcher;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_dispatcher;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_dispatcher;

-- audit_log is append-only for every application role (doc 06 §5).
REVOKE UPDATE, DELETE ON "audit_log" FROM app_user, app_dispatcher;

-- ─────────────────────────── scope accessor ───────────────────────────

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO app_user, app_dispatcher;

-- NULLIF guards the empty-string case: ''::uuid raises, which would turn a
-- missing scope into a 500 instead of an empty result set.
CREATE OR REPLACE FUNCTION app.current_household() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.household_id', true), '')::uuid
$$;

-- ─────────────────────────── policies ───────────────────────────

-- Household-scoped tables carrying household_id directly.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'household_users', 'household_members', 'entitlements', 'documents',
    'document_chunks', 'items', 'obligations', 'reminders', 'outbox_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY household_isolation ON %I
        FOR ALL
        USING (household_id = app.current_household())
        WITH CHECK (household_id = app.current_household())
    $f$, t);
  END LOOP;
END
$$;

-- households: the tenancy key is the primary key.
ALTER TABLE "households" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "households" FORCE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON "households"
  FOR ALL
  USING (id = app.current_household())
  WITH CHECK (id = app.current_household());

-- item_secrets has no household_id column by design (ADR-007 keeps the table
-- minimal); isolation is derived through the owning item.
ALTER TABLE "item_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_secrets" FORCE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON "item_secrets"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "items" i
    WHERE i.id = "item_secrets".item_id AND i.household_id = app.current_household()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "items" i
    WHERE i.id = "item_secrets".item_id AND i.household_id = app.current_household()
  ));

-- audit_log: INSERT-only, and only into your own household's stream.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON "audit_log"
  FOR INSERT WITH CHECK (household_id = app.current_household());
CREATE POLICY audit_read ON "audit_log"
  FOR SELECT USING (household_id = app.current_household());

-- inbound_emails: household_id is NULL until the matcher resolves the alias, so
-- the matcher necessarily runs on the dispatcher role. app_user sees only matched
-- mail for its own household.
ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_emails" FORCE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON "inbound_emails"
  FOR ALL
  USING (household_id = app.current_household())
  WITH CHECK (household_id = app.current_household());

-- vendors is deliberately global (the shared rulebook, A-B2): readable by all,
-- writable only by the dispatcher/ops role.
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendors_read ON "vendors" FOR SELECT USING (true);

-- users / user_profiles are not household-scoped; access is enforced in the
-- application's session layer (doc 06 §2). Left without RLS deliberately —
-- adding a policy keyed on a household GUC would be wrong, not safer.
