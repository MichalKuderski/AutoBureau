import type { Metadata } from "next";
import { NotificationSettings } from "./notification-settings";

export const metadata: Metadata = { title: "Notification settings" };

export default function NotificationSettingsPage() {
  return <NotificationSettings />;
}
