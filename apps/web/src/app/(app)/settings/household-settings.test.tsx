import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { HouseholdSettings } from "./household-settings";

/**
 * Blueprint P0-11.
 *
 * "Add someone" rendered as an ordinary, clickable button with no `onClick` at all.
 * Onboarding has its own `addMember`, but that edits a local draft before a household
 * exists — there is no add-member flow reachable from an already-created household's
 * settings screen. These assertions prove the button is now genuinely non-interactive
 * rather than merely muted, and that the rest of this screen — including the
 * already-known-fabricated forwarding alias (P0-08 deferred it; this file is not the
 * one P0-08 was scoped to) — is otherwise untouched.
 */

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

describe("unrelated household settings remain intact", () => {
  it("still renders the household name/timezone fields and the working save action", async () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByLabelText("Household name")).toBeInTheDocument();
    expect(screen.getByLabelText("Timezone")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("still renders the forwarding-address card and its working copy button", async () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByRole("heading", { name: "Forwarding address" })).toBeInTheDocument();
    const copy = screen.getByRole("button", { name: /copy/i });
    expect(copy).toBeEnabled();
    await userEvent.click(copy);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("still renders the People card and its members", () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
