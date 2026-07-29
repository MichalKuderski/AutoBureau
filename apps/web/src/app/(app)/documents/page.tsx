import type { Metadata } from "next";
import { DocumentsScreen } from "./documents-screen";

export const metadata: Metadata = {
  title: "Documents",
  description: "Every document your household has sent us, and what we found in it.",
};

export default function DocumentsPage() {
  return <DocumentsScreen />;
}
