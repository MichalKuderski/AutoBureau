import { z } from "zod";
import { DocumentMetaSchema, ItemSchema, ObligationSchema } from "./entities.js";
import { CentsSchema, IsoDateTimeSchema, UuidSchema } from "./common.js";

export const ProvenanceSchema = z.object({
  document_id: UuidSchema, document_title: z.string(), captured_at: IsoDateTimeSchema,
  excerpt: z.string().optional(),
});
export const ObligationViewSchema = ObligationSchema.extend({
  member_name: z.string().nullable(), item_name: z.string().nullable(),
  provenance: ProvenanceSchema.nullable(), days_until: z.number().int(),
});
export const ItemViewSchema = ItemSchema.extend({
  member_name: z.string().nullable(), open_obligation_count: z.number().int().nonnegative(),
  document_count: z.number().int().nonnegative(),
  secrets: z.array(z.object({ field: z.string(), last4: z.string().max(4).nullable() })),
});
export const ProposedChangeSchema = z.object({
  kind: z.enum(["item", "obligation"]), action: z.enum(["create", "update"]), label: z.string(),
  fields: z.array(z.object({ path: z.string(), value: z.string(), confidence: z.number().min(0).max(1) })),
});
export const DocumentViewSchema = DocumentMetaSchema.extend({
  member_name: z.string().nullable(), linked_item_ids: z.array(UuidSchema),
  proposed_changes: z.array(ProposedChangeSchema).nullable(),
});
export const DashboardSummarySchema = z.object({
  action_needed: z.number().int().nonnegative(), upcoming_30d: z.number().int().nonnegative(),
  needs_review: z.number().int().nonnegative(), items_tracked: z.number().int().nonnegative(),
  value_found_cents: CentsSchema.nullable(),
  coverage: z.object({ captured: z.number().int().nonnegative(), expected: z.number().int().positive().nullable() }),
  next_digest_at: IsoDateTimeSchema.nullable(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ObligationView = z.infer<typeof ObligationViewSchema>;
export type ItemView = z.infer<typeof ItemViewSchema>;
export type DocumentView = z.infer<typeof DocumentViewSchema>;
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
