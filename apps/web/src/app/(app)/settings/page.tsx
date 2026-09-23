import type { Metadata } from "next";
import { HouseholdSettings } from "./household-settings";

export const metadata: Metadata = { title: "Household settings" };

export default function SettingsPage() {
  return <HouseholdSettings />;
}
