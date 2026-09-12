-- Expand only: notification persistence (PRD F13, architecture 02 §8 / 08).
-- Lock impact: new empty tables/indexes. Foreign-key creation briefly locks the
-- existing users/households tables; fail quickly rather than waiting behind traffic.
-- At 100k households: 30 retained notifications/household averages 3M rows; at
-- roughly 1KB/row plus indexes, budget several GB, plus up to 3 delivery rows each.
-- Fifteen preference rows/user are bounded by the kind/channel matrix. Retention
-- and delivery workers remain separate release gates; these are not hard bounds.
-- Rollback: deploy the prior application; these additive objects can remain.
-- Once notifications exist, preserve/export them before any later approved drop.
-- No existing policy, role flag, owner, auth setting or historical migration changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "NotificationChannel" AS ENUM ('email', 'push', 'inapp');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "target_type" VARCHAR(32),
  "target_id" UUID,
  "dedupe_key" VARCHAR(200) NOT NULL,
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_target_pair" CHECK ((target_type IS NULL) = (target_id IS NULL))
);
CREATE UNIQUE INDEX "notifications_household_id_user_id_dedupe_key_key" ON "notifications"("household_id", "user_id", "dedupe_key");
CREATE INDEX "notifications_household_id_user_id_created_at_id_idx" ON "notifications"("household_id", "user_id", "created_at", "id");

CREATE TABLE "notification_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notification_id" UUID NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'queued',
  "provider_message_id" VARCHAR(255),
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_until" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "error_code" VARCHAR(80),
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_deliveries_attempts_nonnegative" CHECK (attempts >= 0),
  CONSTRAINT "notification_deliveries_lease_pair" CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");
CREATE INDEX "notification_deliveries_status_available_at_idx" ON "notification_deliveries"("status", "available_at");

CREATE TABLE "notification_preferences" (
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "kind", "channel"),
  CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_security_cannot_be_disabled" CHECK (kind <> 'security' OR enabled)
);

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_owner_read ON "notifications" FOR SELECT USING (
  household_id = app.current_household() AND user_id = app.current_user_id()
);
CREATE POLICY notification_owner_read_state ON "notifications" FOR UPDATE USING (
  household_id = app.current_household() AND user_id = app.current_user_id()
) WITH CHECK (household_id = app.current_household() AND user_id = app.current_user_id());

ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_delivery_owner_read ON "notification_deliveries" FOR SELECT USING (
  EXISTS (SELECT 1 FROM notifications n WHERE n.id = notification_deliveries.notification_id
    AND n.household_id = app.current_household() AND n.user_id = app.current_user_id())
);

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preference_owner ON "notification_preferences" FOR ALL
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- Only the trusted dispatcher composes notices and changes delivery status.
-- Request handlers may read their own notices and mark those notices read.
REVOKE ALL ON notifications, notification_deliveries, notification_preferences FROM PUBLIC, app_user;
GRANT SELECT ON notifications, notification_deliveries TO app_user;
GRANT UPDATE (read_at) ON notifications TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications, notification_deliveries, notification_preferences TO app_dispatcher;
COMMIT;
