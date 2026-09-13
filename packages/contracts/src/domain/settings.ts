import { z } from "zod";
import { HouseholdSchema } from "./entities.js";
import { UuidSchema } from "./common.js";

export const TimezoneSchema = z.string().min(1).max(80).refine((value) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
  catch { return false; }
}, "Choose a valid timezone.");

export const ProfilePatchSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  timezone: TimezoneSchema.optional(),
}).strict();

export const ProfileViewSchema = z.object({
  user_id: UuidSchema,
  display_name: z.string(),
  email: z.string().email(),
  timezone: TimezoneSchema,
  locale: z.string(),
});

export const HouseholdPatchSchema = z.object({
  name: HouseholdSchema.shape.name.trim().min(1).optional(),
}).strict();

export type ProfileView = z.infer<typeof ProfileViewSchema>;
