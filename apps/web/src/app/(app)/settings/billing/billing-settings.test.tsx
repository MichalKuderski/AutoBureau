import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { SidebarNav } from "@/components/layout/nav";
import { BillingSettings } from "./billing-settings";

/**
 * Blueprint P0-09.
 *
 * The defect here was two-layered. A local `useState` let clicking "Upgrade" actually
 * flip the plan this screen displayed, with a toast claiming "You're on Premium" for a
 * change nothing recorded — so the screen could tell two different true-sounding
 * stories about the same household in one session. Underneath that, `household.plan`
 * sat unused; the sidebar a few pixels away already read it correctly, so the two
 * surfaces could disagree simultaneously without either being "wrong" in isolation.
 * These assertions check both layers: that the screen renders the real value and
 * cannot be made to show anything else, and that it agrees with the sidebar because
 * both read the same field rather than two independently-trusted ones.
 */

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/billing",
}));

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Test A · the real plan is rendered", () => {
  it("marks Free current when household.plan is free", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    const freeCard = screen.getByRole("heading", { name: "Free" }).closest("div");
    expect(freeCard).not.toBeNull();
    expect(within(freeCard!).getByText("Current")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Premium" })?.closest("div")).not.toContainElement(
      screen.queryByText("Current"),
    );
  });

  it("marks Premium current when household.plan is premium", () => {
    renderScreen(<BillingSettings />, { household: { plan: "premium" } });
    const premiumCard = screen.getByRole("heading", { name: "Premium" }).closest("div");
    expect(premiumCard).not.toBeNull();
    expect(within(premiumCard!).getByText("Current")).toBeInTheDocument();
  });

  it("shows exactly one 'Current' chip, whichever plan is real", () => {
    renderScreen(<BillingSettings />, { household: { plan: "premium" } });
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });
});

describe("Test B · no fake plan change", () => {
  it("Upgrade is disabled and produces no toast when a free household is rendered", async () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    const upgrade = screen.getByRole("button", { name: /upgrade/i });
    expect(upgrade).toBeDisabled();

    await userEvent.click(upgrade);

    expect(screen.queryByText(/you're on premium/i)).not.toBeInTheDocument();
    // A disabled control fires no handler, so the plan card assignment cannot have moved.
    expect(screen.getByRole("heading", { name: "Free" }).closest("div")).toContainElement(
      screen.getByText("Current"),
    );
  });

  it("Switch to Free is disabled and produces no toast when a premium household is rendered", async () => {
    renderScreen(<BillingSettings />, { household: { plan: "premium" } });
    const switchToFree = screen.getByRole("button", { name: /switch to free/i });
    expect(switchToFree).toBeDisabled();

    await userEvent.click(switchToFree);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" }).closest("div")).toContainElement(
      screen.getByText("Current"),
    );
  });

  it("Cancel Premium is disabled, opens no dialog, and claims no cancellation", async () => {
    renderScreen(<BillingSettings />, { household: { plan: "premium" } });
    const cancel = screen.getByRole("button", { name: "Cancel Premium" });
    expect(cancel).toBeDisabled();

    await userEvent.click(cancel);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/premium cancelled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you'll keep premium until the end/i)).not.toBeInTheDocument();
  });

  it("renders no Cancel card at all for a free household — nothing to cancel", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(screen.queryByRole("heading", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("Test C · no fake usage", () => {
  it("renders no usage meter, count, or percentage", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/documents processed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*of\s*\d+/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this month's usage/i)).not.toBeInTheDocument();
  });

  it("does not claim a limit is being approached", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(screen.queryByText(/close to this month's limit/i)).not.toBeInTheDocument();
  });

  it("the same holds for a premium household", () => {
    renderScreen(<BillingSettings />, { household: { plan: "premium" } });
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});

describe("Test D · billing and sidebar agree, from the same source", () => {
  it("both say Free for a free household", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free", name: "The Alvarez Household" } });
    expect(screen.getByRole("heading", { name: "Free" }).closest("div")).toContainElement(
      screen.getByText("Current"),
    );

    const { unmount } = renderScreen(<SidebarNav />, { household: { plan: "free", name: "The Alvarez Household" } });
    expect(screen.getByText(/·\s*Free/)).toBeInTheDocument();
    expect(screen.queryByText(/·\s*Premium/)).not.toBeInTheDocument();
    unmount();
  });

  it("both say Premium for a premium household", () => {
    renderScreen(<BillingSettings />, { household: { plan: "premium", name: "The Alvarez Household" } });
    expect(screen.getByRole("heading", { name: "Premium" }).closest("div")).toContainElement(
      screen.getByText("Current"),
    );

    const { unmount } = renderScreen(<SidebarNav />, {
      household: { plan: "premium", name: "The Alvarez Household" },
    });
    expect(screen.getByText(/·\s*Premium/)).toBeInTheDocument();
    expect(screen.queryByText(/·\s*Free/)).not.toBeInTheDocument();
    unmount();
  });
});

describe("Test E · unrelated billing content remains intact", () => {
  it("still renders both plans with their pricing and feature lists", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("$12")).toBeInTheDocument();
    expect(screen.getByText("10 documents a month")).toBeInTheDocument();
    expect(screen.getByText("Unlimited documents")).toBeInTheDocument();
  });

  it("still renders under the settings navigation without crashing", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" })).toBeInTheDocument();
  });
});
