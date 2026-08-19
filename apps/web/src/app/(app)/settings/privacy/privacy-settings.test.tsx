import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { PrivacySettings } from "./privacy-settings";

/**
 * Blueprint P0-04.
 *
 * Export and deletion rendered perfectly and told the truth about nothing: a click
 * fired a toast claiming a job or a schedule had started, and neither had a backend
 * behind it. The question these assertions answer is not whether the controls throw —
 * they never did — but what a user could reasonably conclude from what's on screen
 * after pressing them. Test A and B prove neither claims a success that didn't happen;
 * Test C proves fixing that left the rest of the page alone; Test D proves the fake
 * async machinery is actually gone, not merely unreachable.
 */

describe("Test A · export cannot claim success", () => {
  it("renders the export control disabled with a truthful description", () => {
    renderScreen(<PrivacySettings />);

    const button = screen.getByRole("button", { name: /request export/i });
    expect(button).toBeDisabled();
    expect(screen.getByText("Not available yet.")).toBeInTheDocument();
  });

  it("produces no toast when activated", async () => {
    renderScreen(<PrivacySettings />);

    // The click a user would make; a disabled control fires no handler at all.
    await userEvent.click(screen.getByRole("button", { name: /request export/i }));

    expect(screen.queryByText(/export started/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we'll email you a download link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
  });

  it("does not claim an email was sent or a file was generated anywhere on the page", () => {
    renderScreen(<PrivacySettings />);

    expect(screen.queryByText(/we'll email you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export.*(started|ready|complete)/i)).not.toBeInTheDocument();
  });
});

describe("Test B · deletion cannot claim success", () => {
  it("renders the delete control disabled with truthful, non-alarming copy", () => {
    renderScreen(<PrivacySettings />);

    const button = screen.getByRole("button", { name: /delete account/i });
    expect(button).toBeDisabled();
    // Both the export and delete cards now say "Not available yet" — consistent
    // language, so this asserts it appears at least once rather than exactly once.
    expect(screen.getAllByText(/not available yet/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/account deletion isn't implemented yet/i),
    ).toBeInTheDocument();
  });

  it("produces no confirmation dialog and no schedule/success toast when activated", async () => {
    renderScreen(<PrivacySettings />);

    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/deletion scheduled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we've emailed you the details/i)).not.toBeInTheDocument();
  });

  it("does not describe a grace period or backup policy as though it were enforced", () => {
    renderScreen(<PrivacySettings />);

    // The exact false claims this task exists to remove: a 14-day grace period and a
    // 35-day backup expiry presented as live policy, with no cascade behind either.
    expect(screen.queryByText(/14 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/35 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/permanently delete/i)).not.toBeInTheDocument();
  });
});

describe("Test C · unrelated privacy content remains intact", () => {
  it("still renders the what-we-can-and-can't-see list", () => {
    renderScreen(<PrivacySettings />);

    expect(screen.getByRole("heading", { name: "What we can and can't see" })).toBeInTheDocument();
    expect(screen.getByText(/dates, amounts, and who they belong to/i)).toBeInTheDocument();
    expect(screen.getByText(/can't decrypt them/i)).toBeInTheDocument();
    expect(screen.getByText(/sold, shared, or used to train/i)).toBeInTheDocument();
  });

  it("still renders both card headings and their descriptions", () => {
    renderScreen(<PrivacySettings />);

    expect(screen.getByRole("heading", { name: "Export everything" })).toBeInTheDocument();
    expect(screen.getByText(/original documents plus every record/i)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Delete your account" })).toBeInTheDocument();
    expect(screen.getByText(/documents, registry, reminders, and history/i)).toBeInTheDocument();
  });
});

describe("Test D · no fake asynchronous behavior remains", () => {
  it("has exactly the two controls on the page, both disabled", () => {
    renderScreen(<PrivacySettings />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
  });

  it("shows no loading/pending state, because there is nothing to wait for", () => {
    renderScreen(<PrivacySettings />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("aria-busy", "true");
    }
  });
});

/**
 * Blueprint P0-10.
 *
 * The identity-number bullet said passport and account numbers "are encrypted" and
 * that AutoBureau's own systems "cannot decrypt them" — present tense, for a control
 * with no code behind it anywhere in the repository. ADR-007 is the real design; its
 * own status line says "Accepted; not yet implemented." Test A proves the false
 * present-tense claim is gone. Test B proves the replacement states a commitment
 * without claiming it already runs. Test C proves the surrounding page — export,
 * deletion, the rest of the list — is untouched.
 */

describe("P0-10 Test A · no present-tense encryption claim", () => {
  it("does not claim identity numbers are currently encrypted", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.queryByText(/numbers are encrypted/i)).not.toBeInTheDocument();
  });

  it("does not claim AutoBureau's systems already cannot decrypt them", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.queryByText(/cannot decrypt them/i)).not.toBeInTheDocument();
  });
});

describe("P0-10 Test B · the replacement is accurate commitment tense", () => {
  it("states encryption as a plan, not a running control", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/the plan is to encrypt passport and account numbers/i)).toBeInTheDocument();
  });

  it("says plainly that the protection isn't built yet", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/isn't built yet/i)).toBeInTheDocument();
  });

  it("invents no timeline, and doesn't claim the work is already underway", () => {
    renderScreen(<PrivacySettings />);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days|we're currently encrypting|already protected/i);
  });
});

describe("P0-10 Test C · the rest of the privacy page is untouched", () => {
  it("still states what AutoBureau currently reads and builds", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/documents you send us, so we can find dates/i)).toBeInTheDocument();
    expect(screen.getByText(/the registry we build from them/i)).toBeInTheDocument();
  });

  it("still states the email-inbox and no-training-data limits", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/your email inbox, unless you connect it/i)).toBeInTheDocument();
    expect(screen.getByText(/sold, shared, or used to train/i)).toBeInTheDocument();
  });

  it("still renders five items in the can/can't list", () => {
    const { container } = renderScreen(<PrivacySettings />);
    expect(screen.getByRole("heading", { name: "What we can and can't see" })).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });

  it("still leaves export and deletion disabled with their own P0-04 copy", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByRole("button", { name: /request export/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete account/i })).toBeDisabled();
    expect(screen.getByText("Not available yet.")).toBeInTheDocument();
  });
});
