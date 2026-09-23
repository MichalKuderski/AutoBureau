import { z } from "zod";
import { CentsSchema, CurrencySchema, IsoDateTimeSchema, ObligationDirectionSchema, ObligationKindSchema, ObligationStatusSchema, PrioritySchema, UuidSchema } from "./common.js";
import { ObligationOutcomeSchema } from "./entities.js";

/** A user supplies an exact deadline; AI provenance and lifecycle fields are server-owned. */
const createFields = z.object({
  title: z.string().trim().min(1, "Enter a deadline title.").max(300),
  kind: ObligationKindSchema.default("custom"), direction: ObligationDirectionSchema.default("owed_by_household"),
  due_at: IsoDateTimeSchema, priority: PrioritySchema.default(2),
  item_id: UuidSchema.nullable().default(null), member_id: UuidSchema.nullable().default(null),
  amount_cents: CentsSchema.nonnegative().nullable().default(null), currency: CurrencySchema.nullable().default(null),
}).strict();
export const ObligationCreateSchema = createFields.superRefine((value, ctx) => {
  if ((value.amount_cents === null) !== (value.currency === null)) ctx.addIssue({ code: "custom", path: ["amount_cents"], message: "Enter both an amount and its currency, or leave both empty." });
});
export const ObligationDetailsPatchSchema = createFields.partial();
export type ObligationDetailsPatch = z.infer<typeof ObligationDetailsPatchSchema>;
export type ObligationCreate = z.infer<typeof ObligationCreateSchema>;

/** The outcome records what the user reports, including an automatic renewal. */
export const ObligationStatusPatchSchema = z.object({
  status: ObligationStatusSchema,
  outcome: ObligationOutcomeSchema.strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.outcome !== undefined && value.status !== "done") ctx.addIssue({
    code: z.ZodIssueCode.custom, path: ["outcome"], message: "Capture an outcome when marking this obligation done.",
  });
});
export const ObligationMutationSchema = z.union([ObligationStatusPatchSchema, ObligationDetailsPatchSchema]);
