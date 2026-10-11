-- ADR-022 reviewed persistent credential format v2 (KMS-shaped envelope). Existing v1 rows are
-- unchanged and still valid: the coupling CHECK accepts exactly today's local envelope as v1.
-- v2 = key-management service data key: key ID, KMS ciphertext blob as wrapped key (bounded),
-- 12-byte GCM nonce, no separate wrap nonce; the full Item binding is the KMS encryption
-- context and the GCM AAD (services/plaid/src/kms-custody.ts). Rotation may move v1 -> v2 but
-- never back (custody never weakens). No KMS key, IAM policy or credential is created here:
-- this is the storage contract only, not operational KMS evidence.
-- Table is bounded (one row per Item); constraint validated separately (NOT VALID + VALIDATE)
-- under 5s/60s bounds. Rollback: refuse v2 writes first; v2 rows cannot be downgraded.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE plaid_local_credentials ADD COLUMN key_id text;
ALTER TABLE plaid_local_credentials ALTER COLUMN wrap_nonce DROP NOT NULL;
ALTER TABLE plaid_local_credentials DROP CONSTRAINT plaid_local_credentials_version_check,
 DROP CONSTRAINT plaid_local_credentials_wrap_nonce_check, DROP CONSTRAINT plaid_local_credentials_wrapped_key_check;
ALTER TABLE plaid_local_credentials ADD CONSTRAINT plaid_credential_envelope CHECK(
 (version=1 AND key_id IS NULL AND wrap_nonce ~ '^[A-Za-z0-9_-]{16}$' AND wrapped_key ~ '^[A-Za-z0-9_-]{64}$')
 -- PostgreSQL regex repetition counts stop at 255: bound lengths explicitly instead.
 OR (version=2 AND key_version=1 AND key_id ~ '^[A-Za-z0-9:/_.-]+$' AND length(key_id) BETWEEN 1 AND 256 AND wrap_nonce IS NULL
  AND wrapped_key ~ '^[A-Za-z0-9_-]+$' AND length(wrapped_key) BETWEEN 22 AND 1366)) NOT VALID;
ALTER TABLE plaid_local_credentials VALIDATE CONSTRAINT plaid_credential_envelope;
GRANT SELECT(key_id),INSERT(key_id),UPDATE(version,key_id) ON plaid_local_credentials TO app_plaid_sandbox;
CREATE OR REPLACE FUNCTION app.guard_plaid_custody_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,app,pg_temp AS $$
DECLARE i record;fence text;
BEGIN
 IF current_user NOT IN ('app_user','app_plaid_sandbox') THEN RETURN COALESCE(NEW,OLD);END IF;
 IF current_user<>'app_plaid_sandbox' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 fence:=app.plaid_fence_state(OLD.household_id);
 SELECT * INTO i FROM public.plaid_local_items WHERE id=OLD.id AND household_id=OLD.household_id;
 IF i.id IS NULL OR fence='closed' THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 IF TG_OP='DELETE' THEN
  IF i.state<>'removed' OR NOT (app.plaid_op_held(OLD.household_id,OLD.id,'remove') OR app.plaid_op_held(OLD.household_id,OLD.id,'reconcile')) THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
  RETURN OLD;
 END IF;
 IF NEW.id<>OLD.id OR NEW.household_id<>OLD.household_id OR NEW.version NOT IN (1,2) OR NEW.version<OLD.version OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
  OR i.credential_revision<>NEW.revision OR fence<>'open' OR NOT app.plaid_op_held(OLD.household_id,OLD.id,'rotate') THEN RAISE EXCEPTION 'Local financial operation refused';END IF;
 RETURN NEW;
END $$;
COMMIT;
