import type { Metadata } from "next";
import { OnboardingShell } from "./onboarding-shell";

export const metadata: Metadata = {
  title: "Set up your household",
  robots: { index: false, follow: false },
};

/**
 * Onboarding sits outside the `(app)` group on purpose: the shell it needs is a
 * progress rail and an exit, not the full application chrome. Keeping the draft in
 * this layout means it survives every step change without a round trip.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingShell>{children}</OnboardingShell>;
}
