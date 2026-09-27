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
    expect(screen.getByText("50 documents/month")).toBeInTheDocument();
  });

  it("still renders under the settings navigation without crashing", () => {
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" })).toBeInTheDocument();
  });
});

describe("Test F · hosted TEST checkout, only as the server allows", () => {
  const status = (over: Record<string, unknown> = {}) => ({ tier: "free", state: "none", cadence: null, paidThrough: null, premiumUntil: null, testMode: false,
    subscribed: false, checkoutOpen: false, paymentUpdateAvailable: false, checkoutAvailable: true, ...over });
  function stub(routes: Record<string, unknown>) {
    const calls: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://app.example.test").pathname.replace(/^\/v1\/households\/[^/]+/, "");
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json(routes[path] ?? {});
    }));
    return calls;
  }
  function trapNavigation() {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    return assign;
  }

  it("offers monthly and annual upgrades and leaves only for Stripe's checkout origin", async () => {
    const calls = stub({ "/billing": status(), "/billing/checkout": { url: "https://checkout.stripe.com/c/pay/cs_test_Synthetic" } });
    const assign = trapNavigation();
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    await userEvent.click(await screen.findByRole("button", { name: "Upgrade — $99/year" }));
    expect(await screen.findByText(/Opening Stripe checkout/)).toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_Synthetic");
    expect(calls.find(c => c.path === "/billing/checkout")?.body).toMatchObject({ plan: "annual" });
    expect(screen.getByRole("button", { name: "Upgrade — $12/month" })).toBeInTheDocument();
  });

  it("never navigates to a destination the server did not name on the exact provider origin", async () => {
    stub({ "/billing": status(), "/billing/checkout": { url: "https://checkout.stripe.com.attacker.example/pay" } });
    const assign = trapNavigation();
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    await userEvent.click(await screen.findByRole("button", { name: "Upgrade — $12/month" }));
    await new Promise(r => setTimeout(r, 20));
    expect(assign).not.toHaveBeenCalled();
  });

  it("an open checkout offers status and cancel instead of a second checkout", async () => {
    const calls = stub({ "/billing": status({ checkoutOpen: true }), "/billing/confirm": { status: "abandoned", reconciled: false } });
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(await screen.findByRole("button", { name: "Check checkout status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade — / })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel checkout" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The checkout was cancelled. Nothing was charged.");
    expect(calls.find(c => c.path === "/billing/confirm")?.body).toEqual({ cancel: true });
  });

  it("a recorded subscription whose Premium limits are off never reads as Premium", async () => {
    stub({ "/billing": status({ state: "active", cadence: "monthly", subscribed: true, checkoutAvailable: false, paymentUpdateAvailable: true }) });
    renderScreen(<BillingSettings />, { household: { plan: "free" } });
    expect(await screen.findByText("Subscription recorded, Premium limits not on")).toBeInTheDocument();
    expect(screen.queryByText("Premium is on")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
  });

  it("a payment problem offers the portal to update the payment method", async () => {
    const calls = stub({ "/billing": status({ tier: "premium", state: "grace", premiumUntil: "2026-10-08T00:00:00.000Z", subscribed: true, checkoutAvailable: false, paymentUpdateAvailable: true }),
      "/billing/portal": { url: "https://billing.stripe.com/p/session/Synthetic" } });
    const assign = trapNavigation();
    renderScreen(<BillingSettings />, { household: { plan: "premium" } });
    await userEvent.click(await screen.findByRole("button", { name: "Update payment method" }));
    expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/Synthetic");
    expect(calls.some(c => c.path === "/billing/portal")).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel Premium" })).not.toBeInTheDocument();
  });
});
