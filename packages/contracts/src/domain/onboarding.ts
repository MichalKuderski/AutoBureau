import { z } from "zod";
import { MemberKindSchema, UuidSchema } from "./common.js";
import { CENSUS } from "./census.js";

const promptIds = new Set(CENSUS.flatMap((group) => group.prompts.map((prompt) => prompt.id)));
export const CensusSelectionsSchema = z.array(z.string().refine((id) => promptIds.has(id), "Choose an available census answer."))
  .max(promptIds.size).refine((ids) => new Set(ids).size === ids.length, "Each answer may appear only once.");
export const OnboardingMemberSchema = z.object({
  client_ref: UuidSchema, member_id: UuidSchema.nullable(),
  display_name: z.string().trim().min(1, "Enter a name for each person.").max(120, "Use no more than 120 characters for a name."), kind: MemberKindSchema,
}).strict();
export const OnboardingSaveSchema = z.object({
  stage: z.enum(["household", "census", "complete"]),
  caring_for: z.enum(["self", "self_and_elder"]).nullable(),
  members: z.array(OnboardingMemberSchema).max(25), selections: CensusSelectionsSchema,
  census_subject_ref: UuidSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.members.map((member) => member.client_ref)).size !== value.members.length) {
    ctx.addIssue({ code: "custom", path: ["members"], message: "Each person must have a distinct reference." });
  }
  const savedIds = value.members.flatMap((member) => member.member_id ? [member.member_id] : []);
  if (new Set(savedIds).size !== savedIds.length) ctx.addIssue({ code: "custom", path: ["members"], message: "Each saved person may appear only once." });
  if (value.census_subject_ref && !value.members.some((member) => member.client_ref === value.census_subject_ref)) {
    ctx.addIssue({ code: "custom", path: ["census_subject_ref"], message: "Choose a person in this setup." });
  }
});
export const OnboardingViewSchema = z.object({
  household_id: UuidSchema, caring_for: z.enum(["self", "self_and_elder"]).nullable(),
  members: z.array(OnboardingMemberSchema), selections: CensusSelectionsSchema,
  census_subject_ref: UuidSchema.nullable(), complete: z.boolean(),
  documents_added: z.number().int().nonnegative(), records_saved: z.number().int().nonnegative(),
});
export type OnboardingSave = z.infer<typeof OnboardingSaveSchema>;
export type OnboardingView = z.infer<typeof OnboardingViewSchema>;
