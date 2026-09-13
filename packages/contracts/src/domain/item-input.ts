import { z } from "zod";
import { CentsSchema, ItemKindSchema, UuidSchema } from "./common.js";

// Manual entry deliberately accepts no arbitrary attrs, identifiers, ciphertext or
// source/verification claims. Identifier fields need the separate encrypted path.
const fields = z.object({
  name: z.string().trim().min(1).max(200), kind: ItemKindSchema,
  member_id: UuidSchema.nullable(), vendor_name: z.string().trim().min(1).max(200).nullable(),
  amount_cents: CentsSchema.nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  billing_cycle: z.string().trim().min(1).max(32).nullable(),
  valid_from: z.string().date().nullable(), expires_at: z.string().date().nullable(),
}).strict();
export const ItemCreateSchema = fields.extend({
  member_id: fields.shape.member_id.default(null), vendor_name: fields.shape.vendor_name.default(null),
  amount_cents: fields.shape.amount_cents.default(null), currency: fields.shape.currency.default(null),
  billing_cycle: fields.shape.billing_cycle.default(null), valid_from: fields.shape.valid_from.default(null),
  expires_at: fields.shape.expires_at.default(null),
}).superRefine((row, ctx) => {
  if ((row.amount_cents === null) !== (row.currency === null)) ctx.addIssue({ code: "custom", path: ["amount_cents"], message: "Provide both an amount and its currency, or leave both empty." });
  if (row.valid_from && row.expires_at && row.expires_at < row.valid_from) ctx.addIssue({ code: "custom", path: ["expires_at"], message: "Expiry must be on or after the start date." });
});
export const ItemPatchSchema = fields.partial();
export type ItemCreate = z.infer<typeof ItemCreateSchema>;
export type ItemPatch = z.infer<typeof ItemPatchSchema>;
