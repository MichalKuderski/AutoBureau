import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { EMPTY_ONBOARDING } from "@/test/onboarding-fixture";
import { OnboardingProvider } from "./onboarding-provider";
import { HouseholdStep } from "./household-step";

vi.mock("next/navigation", () => ({ usePathname: () => "/onboarding", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("onboarding people, keyboard focus", () => {
  it("adding a person moves focus into their name field; removing one returns it to 'Add someone'", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/v1/households/current" ? json({ id: EMPTY_ONBOARDING.household_id, name: "Our household", role: "owner" }) : json(EMPTY_ONBOARDING)));
    const user = userEvent.setup();
    renderScreen(<OnboardingProvider><HouseholdStep /></OnboardingProvider>);
    await user.click(await screen.findByRole("radio", { name: /just my own household/i }));
    const add = await screen.findByRole("button", { name: /add someone/i });
    add.focus(); await user.keyboard("{Enter}");
    const names = await screen.findAllByRole("textbox", { name: /name/i });
    await waitFor(() => expect(names.at(-1)).toHaveFocus());
    await user.keyboard("Second Person");
    await user.click(screen.getAllByRole("button", { name: /remove/i }).at(-1)!);
    await waitFor(() => expect(screen.getByRole("button", { name: /add someone/i })).toHaveFocus());
  });
});
