import type { Metadata } from "next";
import { TimelineScreen } from "./timeline-screen";

export const metadata: Metadata = {
  title: "Timeline",
  description: "Everything that has happened across your household's paperwork.",
};

export default function TimelinePage() {
  return <TimelineScreen />;
}
