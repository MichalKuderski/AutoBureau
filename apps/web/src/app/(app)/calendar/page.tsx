import type { Metadata } from "next";
import { CalendarScreen } from "./calendar-screen";

export const metadata: Metadata = {
  title: "Calendar",
  description: "Your household's deadlines laid out by month.",
};

export default function CalendarPage() {
  return <CalendarScreen />;
}
