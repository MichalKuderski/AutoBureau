import { z } from "zod";
import { CentsSchema, IsoDateTimeSchema } from "./common.js";

export const TimelineLensSchema = z.enum(["all", "obligations", "documents", "items"]);
export type TimelineLens = z.infer<typeof TimelineLensSchema>;
export const TimelineEntrySchema = z.object({
  // Audit ids are PostgreSQL bigint values, represented losslessly as strings.
  id: z.string(), at: IsoDateTimeSchema,
  kind: z.enum(["document_added", "obligation_created", "obligation_completed", "obligation_dismissed",
    "obligation_status_changed", "item_added", "item_changed", "item_expiring", "reminder_sent", "value_found"]),
  title: z.string(), detail: z.string().optional(), member_name: z.string().nullable().optional(),
  href: z.string().optional(), amount_cents: CentsSchema.nullable().optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
