import { z } from "zod";
import { HouseholdMemberSchema } from "./entities.js";
import { IsoDateTimeSchema, MemberKindSchema } from "./common.js";

const displayName = z.string().trim().min(1).max(120);
const birthday = z.string().date().refine((date) => date <= new Date().toISOString().slice(0, 10), "Enter a date of birth that is not in the future.");
export const MemberCreateSchema = z.object({
  display_name: displayName, kind: MemberKindSchema,
  date_of_birth: birthday.nullable().optional(),
}).strict();
export const MemberPatchSchema = MemberCreateSchema.partial().strict();
export const MemberViewSchema = HouseholdMemberSchema.extend({ archived_at: IsoDateTimeSchema.nullable() });
export type MemberView = z.infer<typeof MemberViewSchema>;
