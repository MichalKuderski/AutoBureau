-- ADR-017 additive delivery/inbox foundation; no hosted apply is implicit.
-- Lock impact: metadata locks for nullable outbox columns, then an index build.
-- Existing staging outbox is small. At 100k households x 100 events/month x 30-day
-- retention, estimate 10M outbox + up to 30M deliveries/inbox, 15-30GB with indexes.
-- At that size the outbox index must be built concurrently in a separate reviewed
-- migration; do not use this small-staging path without checking size first.
-- Rollback: disable dispatch/consumption, deploy prior app; keep additive schema and
-- receipts. Never drop inbox rows while an envelope or replay can still exist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE outbox_events ADD COLUMN transport_scope VARCHAR(7), ADD COLUMN routed_at TIMESTAMPTZ(6);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_transport_scope_check CHECK (transport_scope IS NULL OR transport_scope IN ('stg','preview'));
CREATE INDEX outbox_events_transport_scope_routed_at_id_idx ON outbox_events(transport_scope,routed_at,id);
CREATE TABLE job_deliveries (
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 event_id BIGINT NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE ON UPDATE CASCADE,
 household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE ON UPDATE CASCADE,
 transport_scope VARCHAR(7) NOT NULL CHECK (transport_scope IN ('stg','preview')),
 consumer VARCHAR(32) NOT NULL CHECK (consumer IN ('pipeline','notifications','analytics','email-matcher','radar','reminder-materializer','notification-sender','digest-builder','deletion-cascade','export-builder')),
 state VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','exhausted')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
 available_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_token UUID,
 lease_until TIMESTAMPTZ(6),
 sent_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT job_deliveries_pkey PRIMARY KEY(id),
 CONSTRAINT job_delivery_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE UNIQUE INDEX job_deliveries_event_id_consumer_key ON job_deliveries(event_id,consumer);
CREATE UNIQUE INDEX job_deliveries_id_household_id_key ON job_deliveries(id,household_id);
CREATE INDEX job_deliveries_transport_scope_state_available_at_idx ON job_deliveries(transport_scope,state,available_at);
CREATE INDEX job_deliveries_household_id_idx ON job_deliveries(household_id);
CREATE TABLE job_inbox (
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 delivery_id UUID NOT NULL,
 household_id UUID NOT NULL,
 completed_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT job_inbox_pkey PRIMARY KEY(id),
 CONSTRAINT job_inbox_delivery_id_household_id_fkey FOREIGN KEY(delivery_id,household_id) REFERENCES job_deliveries(id,household_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX job_inbox_delivery_id_key ON job_inbox(delivery_id);
CREATE INDEX job_inbox_household_id_idx ON job_inbox(household_id);
ALTER TABLE job_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE job_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY job_delivery_household ON job_deliveries FOR ALL
 USING (household_id = app.current_household()) WITH CHECK (
  household_id = app.current_household() AND EXISTS (
   SELECT 1 FROM outbox_events e WHERE e.id = event_id AND e.household_id = job_deliveries.household_id AND e.transport_scope = job_deliveries.transport_scope
  )
 );
CREATE POLICY job_inbox_household ON job_inbox FOR ALL
 USING (household_id = app.current_household()) WITH CHECK (household_id = app.current_household());
-- NOLOGIN until a separate deployment/custody gate; no implicit broad default grants.
CREATE ROLE app_job_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, app TO app_job_worker;
REVOKE ALL ON job_deliveries, job_inbox FROM PUBLIC, app_user, app_dispatcher;
GRANT SELECT ON job_deliveries, job_inbox TO app_user;
GRANT SELECT, INSERT, UPDATE ON job_deliveries TO app_dispatcher;
GRANT SELECT ON job_inbox TO app_dispatcher;
GRANT SELECT ON job_deliveries TO app_job_worker;
GRANT SELECT, INSERT ON job_inbox TO app_job_worker;
GRANT SELECT ON households TO app_job_worker;
GRANT SELECT, INSERT ON outbox_events TO app_job_worker;
GRANT SELECT, INSERT ON audit_log TO app_job_worker;
GRANT USAGE ON SEQUENCE outbox_events_id_seq, audit_log_id_seq TO app_job_worker;
COMMIT;
