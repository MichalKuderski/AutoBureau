-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deletion_pending');

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('owner', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "MemberKind" AS ENUM ('adult', 'child', 'dependent', 'pet', 'entity');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'premium');

-- CreateEnum
CREATE TYPE "DocSource" AS ENUM ('upload', 'email', 'api');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('received', 'scanning', 'processing', 'needs_review', 'processed', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "VendorKind" AS ENUM ('insurer', 'government', 'subscription', 'utility', 'retailer', 'other');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('passport', 'drivers_license', 'vehicle_registration', 'vehicle', 'insurance_policy', 'subscription', 'warranty', 'membership', 'certification', 'lease', 'loan', 'utility_account', 'tax_year', 'benefit_plan', 'medical_account', 'other');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('active', 'expiring', 'expired', 'cancelled', 'archived');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('renewal', 'payment', 'cancellation_window', 'filing', 'claim', 'enrollment', 'appointment', 'custom');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('upcoming', 'action_needed', 'in_progress', 'waiting', 'done', 'dismissed', 'missed');

-- CreateEnum
CREATE TYPE "ObligationDirection" AS ENUM ('owed_by_household', 'owed_to_household');

-- CreateEnum
CREATE TYPE "ObligationSource" AS ENUM ('ai', 'user', 'system');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('scheduled', 'sent', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'agent', 'system');

-- CreateEnum
CREATE TYPE "InboundStatus" AS ENUM ('received', 'matched', 'quarantined', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "country" CHAR(2) NOT NULL DEFAULT 'US',
    "onboarding" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "email_alias" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_users" (
    "household_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "HouseholdRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_users_pkey" PRIMARY KEY ("household_id","user_id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "user_id" UUID,
    "display_name" TEXT NOT NULL,
    "kind" "MemberKind" NOT NULL,
    "date_of_birth" DATE,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "household_id" UUID NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'free',
    "docs_per_month" INTEGER NOT NULL DEFAULT 10,
    "members_max" INTEGER NOT NULL DEFAULT 2,
    "period_start" DATE NOT NULL,
    "docs_used_this_period" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("household_id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "source" "DocSource" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" BYTEA NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'received',
    "doc_type" TEXT,
    "confidence" DECIMAL(4,3),
    "title" TEXT,
    "doc_date" DATE,
    "extracted" JSONB,
    "review" JSONB,
    "error" JSONB,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "kind" "VendorKind" NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'US',
    "region" TEXT,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "member_id" UUID,
    "kind" "ItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'active',
    "vendor_id" UUID,
    "vendor_name" TEXT,
    "attrs" JSONB NOT NULL DEFAULT '{}',
    "amount_cents" BIGINT,
    "currency" CHAR(3),
    "billing_cycle" TEXT,
    "valid_from" DATE,
    "expires_at" DATE,
    "verified_at" TIMESTAMPTZ(6),
    "source_document_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_secrets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "last4" TEXT,

    CONSTRAINT "item_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "item_id" UUID,
    "member_id" UUID,
    "title" TEXT NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "direction" "ObligationDirection" NOT NULL DEFAULT 'owed_by_household',
    "status" "ObligationStatus" NOT NULL DEFAULT 'upcoming',
    "priority" SMALLINT NOT NULL DEFAULT 2,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "window_start" TIMESTAMPTZ(6),
    "grace_until" TIMESTAMPTZ(6),
    "amount_cents" BIGINT,
    "currency" CHAR(3),
    "recurrence" TEXT,
    "source" "ObligationSource" NOT NULL,
    "source_document_id" UUID,
    "ai_confidence" DECIMAL(4,3),
    "outcome" JSONB,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "obligation_id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "remind_at" TIMESTAMPTZ(6) NOT NULL,
    "offset_label" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'scheduled',
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "household_id" UUID,
    "payload" JSONB NOT NULL,
    "traceparent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "household_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "alias" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT,
    "raw_storage_path" TEXT NOT NULL,
    "status" "InboundStatus" NOT NULL DEFAULT 'received',
    "household_id" UUID,
    "document_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "households_email_alias_key" ON "households"("email_alias");

-- CreateIndex
CREATE INDEX "household_users_user_id_idx" ON "household_users"("user_id");

-- CreateIndex
CREATE INDEX "household_members_household_id_idx" ON "household_members"("household_id");

-- CreateIndex
CREATE INDEX "documents_household_id_status_idx" ON "documents"("household_id", "status");

-- CreateIndex
CREATE INDEX "documents_household_id_doc_type_doc_date_idx" ON "documents"("household_id", "doc_type", "doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "documents_household_id_sha256_key" ON "documents"("household_id", "sha256");

-- CreateIndex
CREATE INDEX "document_chunks_household_id_idx" ON "document_chunks"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_seq_key" ON "document_chunks"("document_id", "seq");

-- CreateIndex
CREATE INDEX "vendors_name_idx" ON "vendors"("name");

-- CreateIndex
CREATE INDEX "items_household_id_kind_idx" ON "items"("household_id", "kind");

-- CreateIndex
CREATE INDEX "items_household_id_expires_at_idx" ON "items"("household_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "item_secrets_item_id_field_key" ON "item_secrets"("item_id", "field");

-- CreateIndex
CREATE INDEX "obligations_household_id_status_due_at_idx" ON "obligations"("household_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "reminders_status_remind_at_idx" ON "reminders"("status", "remind_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_obligation_id_offset_label_key" ON "reminders"("obligation_id", "offset_label");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_idx" ON "outbox_events"("published_at");

-- CreateIndex
CREATE INDEX "audit_log_household_id_created_at_idx" ON "audit_log"("household_id", "created_at");

-- CreateIndex
CREATE INDEX "inbound_emails_alias_idx" ON "inbound_emails"("alias");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_users" ADD CONSTRAINT "household_users_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_users" ADD CONSTRAINT "household_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_secrets" ADD CONSTRAINT "item_secrets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

