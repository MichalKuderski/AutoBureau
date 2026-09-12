import { z } from "zod";
import { ObligationStatusSchema } from "./common.js";
import { ObligationOutcomeSchema } from "./entities.js";

/** The outcome records what the user reports, including an automatic renewal. */
export const ObligationStatusPatchSchema = z.object({
  status: ObligationStatusSchema,
  outcome: ObligationOutcomeSchema.strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.outcome !== undefined && value.status !== "done") ctx.addIssue({
    code: z.ZodIssueCode.custom, path: ["outcome"], message: "Capture an outcome when marking this obligation done.",
  });
});
