import { z } from "zod";
import {
  CentsSchema, CurrencySchema, DocSourceSchema, DocStatusSchema, DocTypeSchema,
  HouseholdRoleSchema, IsoDateTimeSchema, ItemKindSchema, ItemStatusSchema,
  MemberKindSchema, ObligationDirectionSchema, ObligationKindSchema,
  ObligationSourceSchema, ObligationStatusSchema, PrioritySchema,
  ReminderStatusSchema, UuidSchema,
} from "./common.js";

/**
 * Entity schemas — the wire shapes of the ledger's nouns. These validate at
 * every boundary (API in/out, event consumers, future Python pipeline).
 * Unknown fields are stripped on output by handler wrappers (doc 03 §4).
 */

export const HouseholdSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(200),
  email_alias: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

export const HouseholdMemberSchema = z.object({
  id: UuidSchema,
  household_id: UuidSchema,
  user_id: UuidSchema.nullable(),
  display_name: z.string().min(1).max(120),
  kind: MemberKindSchema,
  date_of_birth: z.string().date().nullable(),
});

export const HouseholdMembershipSchema = z.object({
  household_id: UuidSchema,
  user_id: UuidSchema,
  role: HouseholdRoleSchema,
});

export const DocumentMetaSchema = z.object({
  id: UuidSchema,
  household_id: UuidSchema,
  source: DocSourceSchema,
  status: DocStatusSchema,
  doc_type: DocTypeSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  title: z.string().nullable(),
  doc_date: z.string().date().nullable(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  created_at: IsoDateTimeSchema,
  processed_at: IsoDateTimeSchema.nullable(),
});

export const ItemSchema = z.object({
  id: UuidSchema,
  household_id: UuidSchema,
  member_id: UuidSchema.nullable(),
  kind: ItemKindSchema,
  name: z.string().min(1).max(200),
  status: ItemStatusSchema,
  vendor_id: UuidSchema.nullable(),
  vendor_name: z.string().nullable(),
  amount_cents: CentsSchema.nullable(),
  currency: CurrencySchema.nullable(),
  billing_cycle: z.string().nullable(),
  valid_from: z.string().date().nullable(),
  expires_at: z.string().date().nullable(),
  /** Freshness doctrine (A-F1): when a human last confirmed this item's facts. */
  verified_at: IsoDateTimeSchema.nullable(),
  source_document_id: UuidSchema.nullable(),
});

/** A-F3: structured outcome captured when an obligation closes — Ledger B's feed. */
export const ObligationOutcomeSchema = z.object({
  done_via: z.enum(["manual", "action_kit", "external", "auto"]),
  cost_cents: CentsSchema.nullable().optional(),
  process_matched: z.boolean().nullable().optional(),
  note: z.string().max(2000).optional(),
});

export const ObligationSchema = z.object({
  id: UuidSchema,
  household_id: UuidSchema,
  item_id: UuidSchema.nullable(),
  member_id: UuidSchema.nullable(),
  title: z.string().min(1).max(300),
  kind: ObligationKindSchema,
  direction: ObligationDirectionSchema,
  status: ObligationStatusSchema,
  priority: PrioritySchema,
  due_at: IsoDateTimeSchema,
  window_start: IsoDateTimeSchema.nullable(),
  grace_until: IsoDateTimeSchema.nullable(),
  amount_cents: CentsSchema.nullable(),
  currency: CurrencySchema.nullable(),
  recurrence: z.string().nullable(),
  source: ObligationSourceSchema,
  source_document_id: UuidSchema.nullable(),
  ai_confidence: z.number().min(0).max(1).nullable(),
  outcome: ObligationOutcomeSchema.nullable(),
  verified_at: IsoDateTimeSchema.nullable(),
});

export const ReminderSchema = z.object({
  id: UuidSchema,
  obligation_id: UuidSchema,
  remind_at: IsoDateTimeSchema,
  offset_label: z.string().min(1).max(30),
  status: ReminderStatusSchema,
});

export type Household = z.infer<typeof HouseholdSchema>;
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Obligation = z.infer<typeof ObligationSchema>;
export type ObligationOutcome = z.infer<typeof ObligationOutcomeSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
