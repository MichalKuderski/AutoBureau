import { AppShell } from "@/components/layout/app-shell";
import { HouseholdProvider } from "@/providers/household-provider";
import { CommandPalette } from "@/components/patterns/command-palette";
import { HOUSEHOLD, VIEWER } from "@/lib/domain/fixtures";

/**
 * Authenticated route group.
 *
 * The household and viewer are resolved here — in production from the session and a
 * membership check (doc 06 §2), today from fixtures — and provided to the tree once.
 * Because this layout wraps a route *group*, the shell mounts a single time and
 * navigation between screens swaps only the page body.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <HouseholdProvider household={HOUSEHOLD} viewer={VIEWER}>
      <AppShell>{children}</AppShell>
      <CommandPalette />
    </HouseholdProvider>
  );
}
