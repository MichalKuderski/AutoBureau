import { installDomainHttpFixtures } from "@/test/domain-http-fixtures";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { HouseholdScreen } from "./household-screen";

/**
 * Blueprint P0-10.
 *
 * "Stored encrypted. Revealing a full number is recorded in your activity log." was
 * present tense for a control with no implementation anywhere in this repository: no
 * code writes to `item_secrets`, no reveal endpoint exists, and nothing logs a reveal
 * because there is nothing to log. Everything else about this section was already
 * correct — the UI genuinely never shows more than the masked `last4` — so the fix is
 * narrow: stop claiming the storage and audit trail are already real.
 */

installDomainHttpFixtures();

async function openPassportDetail(): Promise<void> {
  renderScreen(<HouseholdScreen />);
  const row = await screen.findByText("Passport — Mateo");
  await userEvent.click(row);
  await screen.findByText("Identifiers");
}

describe("P0-10 Test A · no present-tense encryption claim", () => {
  it("does not claim the value is currently stored encrypted", async () => {
    await openPassportDetail();
    expect(screen.queryByText(/^stored encrypted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is stored encrypted/i)).not.toBeInTheDocument();
  });

  it("does not claim a reveal is already recorded anywhere", async () => {
    await openPassportDetail();
    expect(screen.queryByText(/is recorded in your activity log/i)).not.toBeInTheDocument();
  });
});

describe("P0-10 Test B · the replacement is accurate commitment tense", () => {
  it("states encryption and reveal-logging as a plan, not a running control", async () => {
    await openPassportDetail();
    expect(screen.getByText(/the plan is to encrypt full/i)).toBeInTheDocument();
    expect(screen.getByText(/neither is built yet/i)).toBeInTheDocument();
  });

  it("still tells the user only the last four digits ever show — that part was already true", async () => {
    await openPassportDetail();
    expect(screen.getByText(/only the last four digits are ever shown here/i)).toBeInTheDocument();
  });

  it("invents no timeline", async () => {
    await openPassportDetail();
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days/i);
  });
});

describe("P0-10 Test C · the masked value and surrounding detail are unaffected", () => {
  it("shows only the masked last four digits, never the full passport number", async () => {
    await openPassportDetail();
    expect(screen.getByText("passport number")).toBeInTheDocument();
    expect(screen.getByText(/6620/)).toBeInTheDocument();
    // The masking character(s) must still separate the digits from a full value —
    // this is the property the surrounding copy describes, and it must still hold.
    const masked = screen.getByText(/6620/).textContent ?? "";
    expect(masked).not.toBe("6620");
  });

  it("offers no reveal control of any kind next to the masked value", async () => {
    await openPassportDetail();
    expect(screen.queryByRole("button", { name: /reveal|show full|unmask/i })).not.toBeInTheDocument();
  });

  it("still renders the item's other detail fields", async () => {
    await openPassportDetail();
    const dialog = screen.getByRole("dialog");
    // "US Department of State" and "Mateo Reyes" also appear in the table row behind
    // the drawer, so scope to the drawer itself rather than asserting uniqueness.
    expect(within(dialog).getByText("US Department of State")).toBeInTheDocument();
    expect(within(dialog).getByText("Mateo Reyes")).toBeInTheDocument();
  });

  it("renders no Identifiers section for an item with no secrets", async () => {
    renderScreen(<HouseholdScreen />);
    // Both the item name and its vendor are "Streamly" in the fixture, so two matches
    // are expected; either resolves to the same row.
    const rows = await screen.findAllByText("Streamly");
    await userEvent.click(rows[0]!);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByText("Identifiers")).not.toBeInTheDocument();
  });
});

describe("manual item entry", () => {
  it("opens a working creation form and cancels without a success claim", async () => {
    renderScreen(<HouseholdScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /add item/i }));
    const dialog = await screen.findByRole("dialog", { name: "Add item" });
    expect(within(dialog).getByLabelText(/Item name/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toHaveFocus());
  });
});

/**
 * Blueprint P0-16 — WCAG 2.1.1.
 *
 * Household item detail is the other core loop the audit named. Same defect as
 * Documents, same fix, same shared `Table` — these assertions exercise this screen
 * directly rather than assuming the component-level fix covers both consumers.
 */
describe("P0-16 · an item row is reachable and operable by keyboard", () => {
  it("is a real tab stop, and Enter opens the same detail drawer a click opens", async () => {
    renderScreen(<HouseholdScreen />);
    const name = await screen.findByText("Passport — Mateo");
    const row = name.closest("tr");
    expect(row).not.toBeNull();

    for (let i = 0; i < 20 && document.activeElement !== row; i += 1) {
      await userEvent.tab();
    }
    expect(row).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    const drawer = await screen.findByRole("dialog", { name: /passport — mateo/i });
    expect(within(drawer).getByText("Mateo Reyes")).toBeInTheDocument();
  });

  it("still opens on a pointer click, unchanged", async () => {
    await openPassportDetail();
    expect(screen.getByRole("dialog", { name: /passport — mateo/i })).toBeInTheDocument();
  });
});
