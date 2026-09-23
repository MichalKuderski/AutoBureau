import type { Metadata } from "next";
import { HouseholdScreen } from "./household-screen";

export const metadata: Metadata = {
  title: "Household",
  description: "Everything your household holds — policies, licences, vehicles, and warranties.",
};

export default function HouseholdPage() {
  return <HouseholdScreen />;
}
