import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { BillingBanner, describeBilling, type BillingStatus } from "./billing-status";

const base: BillingStatus = { tier: "free", state: "none", cadence: null, paidThrough: null, premiumUntil: null, testMode: true, subscribed: false, checkoutOpen: false, paymentUpdateAvailable: false, checkoutAvailable: false };
afterEach(() => vi.unstubAllGlobals());

describe("billing status wording (from durable state only)", () => {
  it("never calls Premium on unless the effective plan is Premium", () => {
    // A reconciled subscription whose Premium limits are not in effect says so, never "Premium is on".
    for (const testMode of [true, false]) {
      const d = describeBilling({ ...base, state: "active", tier: "free", testMode })!;
      expect(d.title).toBe("Subscription recorded, Premium limits not on");
      expect(`${d.title} ${d.body}`).not.toMatch(/Premium is on|Premium stays on/);
      expect(d.body).toMatch(/Free limits/);
    }
    expect(describeBilling({ ...base, state: "active", tier: "premium", cadence: "monthly", paidThrough: "2026-10-31T00:00:00.000Z" }))
      .toMatchObject({ title: "Premium is on", body: expect.stringMatching(/paid through October 31, 2026/) });
  });
  it("explains grace with its end date and that nothing is deleted", () => {
    const d = describeBilling({ ...base, state: "grace", tier: "premium", premiumUntil: "2026-10-08T00:00:00.000Z" })!;
    expect(d).toMatchObject({ tone: "warning", title: "Payment problem" });
    expect(d.body).toMatch(/stays on until October 8, 2026/);
    expect(d.body).toMatch(/nothing is deleted/);
  });
  it("past due, canceled and blocked are never presented as Premium", () => {
    for (const state of ["past_due", "canceled", "blocked"] as const) {
      const d = describeBilling({ ...base, state })!;
      expect(d.body).not.toMatch(/Premium stays on|Premium is on/);
      expect(d.body).toMatch(/kept/);
    }
  });
  it("shows the banner only for grace and past due", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, state: "grace", tier: "premium", premiumUntil: "2026-10-08T00:00:00.000Z" })));
    const { unmount } = renderScreen(<BillingBanner />);
    expect(await screen.findByText(/payment problem/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /billing details/i })).toHaveAttribute("href", "/settings/billing");
    unmount(); vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, state: "canceling", tier: "premium", premiumUntil: "2026-10-08T00:00:00.000Z" })));
    const { container } = renderScreen(<BillingBanner />);
    await waitFor(() => expect(container.textContent ?? "").toBe(""));
  });
});
