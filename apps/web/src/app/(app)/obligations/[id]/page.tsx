import type { Metadata } from "next";
import { ObligationDetailScreen } from "./obligation-detail-screen";

/**
 * The title stays generic on purpose. Deriving it from the obligation would put the
 * household's business ("Elena's Medicare Part B enrollment window") into the browser
 * tab, the history file, and any screen shared over a call — for a product holding
 * medical and identity paperwork that is a privacy leak with no upside.
 */
export const metadata: Metadata = {
  title: "Obligation",
  description: "What this is, when it's due, and where we read it.",
  robots: { index: false, follow: false },
};

export default async function ObligationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ObligationDetailScreen id={id} />;
}
