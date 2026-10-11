BEGIN;
-- Read opaque ownership columns used by existing owner policies; no message content.
-- Explicit household-scoped retention/verifier policies; no bypass or INSERT/UPDATE.
-- Catalog locks, no data rewrite; rollback revokes these grants/policies after stopping workers.
GRANT SELECT(user_id) ON notifications TO app_retention_worker,app_deletion_verifier;
CREATE POLICY notification_retention_read ON notifications FOR SELECT TO app_retention_worker,app_deletion_verifier
 USING (household_id=app.current_household());
CREATE POLICY notification_retention_delete ON notifications FOR DELETE TO app_retention_worker
 USING (household_id=app.current_household());
CREATE POLICY notification_delivery_retention_read ON notification_deliveries FOR SELECT TO app_retention_worker,app_deletion_verifier
 USING (EXISTS(SELECT 1 FROM notifications n WHERE n.id=notification_id AND n.household_id=app.current_household()));
CREATE POLICY notification_delivery_retention_delete ON notification_deliveries FOR DELETE TO app_retention_worker
 USING (EXISTS(SELECT 1 FROM notifications n WHERE n.id=notification_id AND n.household_id=app.current_household()));
-- Never destroy a provider locator before provider-specific reconciliation exists.
CREATE FUNCTION app.guard_delivery_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app AS $$
BEGIN
 IF current_user='app_retention_worker' AND OLD.provider_message_id IS NOT NULL THEN
  RAISE EXCEPTION 'Provider reference unresolved' USING ERRCODE='55000';
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION app.guard_delivery_erasure() FROM PUBLIC;
CREATE TRIGGER provider_erasure_guard BEFORE DELETE ON notification_deliveries FOR EACH ROW EXECUTE FUNCTION app.guard_delivery_erasure();

COMMIT;
