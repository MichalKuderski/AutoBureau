import type { Metadata } from "next";
import { ConnectionsSettings } from "./connections-settings";

export const metadata: Metadata = { title: "Connected accounts" };

export default function ConnectionsPage() {
  return <ConnectionsSettings />;
}
