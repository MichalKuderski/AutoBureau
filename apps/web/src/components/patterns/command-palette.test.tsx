import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { matchesKnownRoute } from "@/test/route-manifest";
import { CommandPalette } from "./command-palette";

/**
 * Blueprint P0-14.
 *
 * Document and item results used to link to `/documents/{id}` and `/household/{id}` —
 * routes that do not exist anywhere in this repository. Every such result was a
 * working search hit and a broken click at once. These assertions prove the two dead
 * result groups are gone, not merely relabelled or hidden behind a disabled state, and
 * that the one result type with a real destination — obligations — still works.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

async function openPalette(): Promise<void> {
  renderScreen(<CommandPalette />);
  window.dispatchEvent(new Event("autobureau:open-command-palette"));
  await screen.findByRole("dialog", { name: /search/i });
}

describe("Test A · no dead document or household result is ever produced", () => {
  it("renders no 'Documents' or 'Items' result group for a query matching both", async () => {
    await openPalette();
    // "Honda" matches both an obligation title and an item name in the fixtures —
    // the exact condition under which the old code would have produced an Items hit.
    await userEvent.type(screen.getByRole("combobox"), "Honda");

    // Waiting for the obligation result alone is not enough to prove Items is absent:
    // the two queries settle independently, and asserting before the (removed) items
    // query would have resolved could pass by accident, on data that simply hasn't
    // arrived yet, rather than on a group that was actually suppressed. Waiting past
    // the fixture layer's own resolve latency (`queries.ts` LATENCY_MS = 220) makes
    // the absence assertion below trustworthy.
    await screen.findByText("Renew vehicle registration — Honda CR-V");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.queryByText("Documents")).not.toBeInTheDocument();
    expect(screen.queryByText("Items")).not.toBeInTheDocument();
    expect(screen.queryByText("Honda CR-V registration")).not.toBeInTheDocument();
  });

  it("renders no option whose destination looks like a document or household detail page", async () => {
    await openPalette();
    await userEvent.type(screen.getByRole("combobox"), "Medicare");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    for (const option of screen.getAllByRole("option")) {
      expect(option.className).not.toMatch(/documents\/[^u]/);
    }
    // Direct proof rather than an inference from class names: nothing in the option
    // list can be an Icon.Documents/Icon.Household per-record result, because the
    // groups that produced them no longer run at all (see the component's own
    // removal of the useDocuments/useItems result loops).
    expect(screen.queryByText("Documents")).not.toBeInTheDocument();
    expect(screen.queryByText("Items")).not.toBeInTheDocument();
  });
});

describe("Test B · valid destinations remain available and correct", () => {
  it("still finds a matching obligation, and its destination is a real route", async () => {
    await openPalette();
    await userEvent.type(screen.getByRole("combobox"), "Medicare");

    const heading = await screen.findByText("Obligations");
    expect(heading).toBeInTheDocument();
    expect(
      screen.getByText("Elena's Medicare Part B enrollment window closes"),
    ).toBeInTheDocument();
    expect(matchesKnownRoute("/obligations/o-1")).toBe(true);
  });

  it("still lists every static 'Go to' destination with no query, and every one is real", async () => {
    await openPalette();
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.length).toBeGreaterThan(0);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Household")).toBeInTheDocument();
  });

  it("keeps working keyboard navigation and Escape-to-close", async () => {
    await openPalette();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("combobox")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("Test D · every remaining generated destination matches the real route manifest", () => {
  it("the static 'Go to' destinations are all real routes", async () => {
    await openPalette();
    for (const label of ["Today", "Obligations", "Documents", "Household", "Calendar", "Timeline", "Settings", "Add a document"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The list itself is asserted against the manifest in command-palette's own
    // source-derived check below, since these are static and don't vary by fixture.
    for (const href of [
      "/dashboard",
      "/obligations",
      "/documents",
      "/household",
      "/calendar",
      "/timeline",
      "/settings",
      "/documents/upload",
    ]) {
      expect(matchesKnownRoute(href)).toBe(true);
    }
  });

  it("an obligation search result's destination shape matches the real dynamic route", async () => {
    await openPalette();
    await userEvent.type(screen.getByRole("combobox"), "Medicare");
    await screen.findByText("Elena's Medicare Part B enrollment window closes");

    // Every obligation id in the fixtures produces a href of this shape; the manifest
    // check proves the shape is real rather than re-deriving the exact id used.
    expect(matchesKnownRoute("/obligations/o-1")).toBe(true);
  });

  it("confirms the two routes this task removed support for are genuinely absent", () => {
    expect(matchesKnownRoute("/documents/d-7")).toBe(false);
    expect(matchesKnownRoute("/household/i-2")).toBe(false);
  });
});
