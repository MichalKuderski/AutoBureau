import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { HouseholdProvider, type ActiveHousehold } from "@/providers/household-provider";
import { HOUSEHOLD, VIEWER } from "@/lib/domain/fixtures";

/**
 * Renders a screen inside the providers it genuinely depends on.
 *
 * Screens are only worth testing through the real context stack — a screen that
 * passes with a stubbed household proves nothing about the screen that ships. The
 * one deviation from production is the query client: retries off and no cache
 * carried between tests, so a failing assertion reports the first failure rather
 * than the third retry of it.
 */
export function renderScreen(
  ui: ReactElement,
  { household }: { household?: Partial<ActiveHousehold> } = {},
): RenderResult {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <HouseholdProvider household={{ ...HOUSEHOLD, ...household }} viewer={VIEWER}>
          <ToastProvider>{children}</ToastProvider>
        </HouseholdProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
