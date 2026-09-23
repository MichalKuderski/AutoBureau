import type { Metadata } from "next";
import { PrivacySettings } from "./privacy-settings";

export const metadata: Metadata = { title: "Privacy & data" };

export default function PrivacyPage() {
  return <PrivacySettings />;
}
