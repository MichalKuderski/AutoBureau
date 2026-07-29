import type { Metadata } from "next";
import { NotificationsScreen } from "./notifications-screen";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Reminders, review requests, and results from your household.",
};

export default function NotificationsPage() {
  return <NotificationsScreen />;
}
