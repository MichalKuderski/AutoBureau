import type { Metadata } from "next";
import { ObligationsScreen } from "./obligations-screen";

export const metadata: Metadata = {
  title: "Obligations",
  description: "Every deadline, renewal, and claim your household is tracking.",
};

export default function ObligationsPage() {
  return <ObligationsScreen />;
}
