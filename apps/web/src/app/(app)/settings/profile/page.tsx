import type { Metadata } from "next";
import { ProfileSettings } from "./profile-settings";

export const metadata: Metadata = { title: "Your profile" };

export default function ProfilePage() {
  return <ProfileSettings />;
}
