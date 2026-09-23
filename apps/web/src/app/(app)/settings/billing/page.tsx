import type { Metadata } from "next";
import { BillingSettings } from "./billing-settings";

export const metadata: Metadata = { title: "Plan & billing" };

export default function BillingPage() {
  return <BillingSettings />;
}
