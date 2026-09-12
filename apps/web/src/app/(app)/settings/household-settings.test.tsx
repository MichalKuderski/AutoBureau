import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { HouseholdSettings } from "./household-settings";

/** Disabled member creation and truthful forwarding-address behavior. */

describe("P0-11 · Add someone is not actionable", () => {
  it("is a disabled button, not merely styled to look inactive", () => {
    renderScreen(<HouseholdSettings />);
    const button = screen.getByRole("button", { name: /add someone/i });
    expect(button).toBeDisabled();
  });

  it("states plainly that it is not available", () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByText("Not available yet.")).toBeInTheDocument();
  });

  it("produces no new member, dialog, or toast when clicked", async () => {
    renderScreen(<HouseholdSettings />);
    const button = screen.getByRole("button", { name: /add someone/i });
    const before = screen.getAllByRole("listitem").length;

    // A disabled control fires no click; this is the click a user would attempt.
    await userEvent.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/added|invited/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(before);
  });
});

describe("household settings and forwarding address", () => {
  it("still renders the household name/timezone fields and the existing preview save action", async () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByLabelText("Household name")).toBeInTheDocument();
    expect(screen.getByLabelText("Timezone")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("copies the assigned address only after clipboard success", async () => {
    const user = userEvent.setup();
    const copyText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderScreen(<HouseholdSettings />, { household: { emailAlias: "assigned@example.test" } });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith("assigned@example.test");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    copyText.mockRestore();
  });

  it("does not invent an address for a household without one", () => {
    renderScreen(<HouseholdSettings />, { household: { emailAlias: null } });
    expect(screen.getByText("No forwarding address yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("reports a failed clipboard operation without a success claim", async () => {
    const user = userEvent.setup();
    const copyText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));
    renderScreen(<HouseholdSettings />, { household: { emailAlias: "assigned@example.test" } });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Couldn’t copy the address")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    copyText.mockRestore();
  });

  it("still renders the People card and its members", () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
