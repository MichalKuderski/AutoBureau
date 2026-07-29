import { z } from "zod";

/** Frozen enums — doc 02 as amended (obligation direction: A-F2) + PRD v1 §8/F7. */

export const HouseholdRoleSchema = z.enum(["owner", "member", "viewer"]);
export const MemberKindSchema = z.enum(["adult", "child", "dependent", "pet", "entity"]);

export const DocSourceSchema = z.enum(["upload", "email", "api"]);
export const DocStatusSchema = z.enum([
  "received", "scanning", "processing", "needs_review", "processed", "rejected", "failed",
]);

/** The 8 launch doc types (PRD F7 — frozen; swap only via PRD §4.1/§21). */
export const LAUNCH_DOC_TYPES = [
  "government_id",
  "insurance_policy",
  "medical_bill",
  "vehicle_registration",
  "lease",
  "utility_bill",
  "warranty",
  "subscription_receipt",
] as const;
export const DocTypeSchema = z.enum(LAUNCH_DOC_TYPES);

export const ItemKindSchema = z.enum([
  "passport", "drivers_license", "vehicle_registration", "vehicle", "insurance_policy",
  "subscription", "warranty", "membership", "certification", "lease", "loan",
  "utility_account", "tax_year", "benefit_plan", "medical_account", "other",
]);
export const ItemStatusSchema = z.enum(["active", "expiring", "expired", "cancelled", "archived"]);

export const ObligationKindSchema = z.enum([
  "renewal", "payment", "cancellation_window", "filing", "claim", "enrollment", "appointment", "custom",
]);
export const ObligationStatusSchema = z.enum([
  "upcoming", "action_needed", "in_progress", "waiting", "done", "dismissed", "missed",
]);
/** A-F2: obligations run both directions — duties and entitlements. */
export const ObligationDirectionSchema = z.enum(["owed_by_household", "owed_to_household"]);
export const ObligationSourceSchema = z.enum(["ai", "user", "system"]);
/** 1 = critical (legal/expiry) · 2 = important · 3 = nice-to-do. */
export const PrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const ReminderStatusSchema = z.enum(["scheduled", "sent", "skipped", "cancelled"]);
export const NotificationChannelSchema = z.enum(["email", "push", "inapp"]); // sms reserved post-v1

/** Money is integer cents, always (PRD §12; canonicalization profile depends on it). */
export const CentsSchema = z.number().int().safe();
export const CurrencySchema = z.string().length(3).toUpperCase();

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const UuidSchema = z.string().uuid();
