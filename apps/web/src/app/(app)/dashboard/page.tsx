import type { Metadata } from "next";
import { DashboardScreen } from "./dashboard-screen";

export const metadata: Metadata = {
  title: "Today",
  description: "What needs your attention, and what's already handled.",
};

export default function DashboardPage() {
  return <DashboardScreen />;
}
