import type { Metadata } from "next";
import { DocumentsScreen } from "./documents-screen";

export const metadata: Metadata = {
  title: "Documents",
  description: "Every document your household has sent us, and what we found in it.",
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const status = (await searchParams)["status"];
  const initialStatus = status === "needs_review" || status === "processed" || status === "processing" ? status : "all";
  return <DocumentsScreen key={initialStatus} initialStatus={initialStatus} />;
}
