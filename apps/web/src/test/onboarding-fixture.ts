import type { OnboardingView } from "@autobureau/contracts";

/** Explicit render fixture; production setup always loads its authenticated API. */
export const EMPTY_ONBOARDING: OnboardingView = {
  household_id: "22222222-2222-4222-8222-222222222222", caring_for: "self", members: [], selections: [],
  census_subject_ref: null, complete: false, documents_added: 0, records_saved: 0,
};
export const POPULATED_ONBOARDING: OnboardingView = {
  ...EMPTY_ONBOARDING, caring_for: "self_and_elder", selections: ["medicare", "supplemental", "vehicle"], records_saved: 3,
  census_subject_ref: "33333333-3333-4333-8333-333333333333",
  members: [{ client_ref: "33333333-3333-4333-8333-333333333333", member_id: "44444444-4444-4444-8444-444444444444", display_name: "Mom", kind: "dependent" }],
};
