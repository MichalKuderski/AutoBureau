import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { ProfileSettings } from "./profile-settings";

/**
 * Blueprint P0-03.
 *
 * The control being tested was never broken in the sense of throwing or failing to
 * render — it rendered perfectly, and told the truth about nothing. So the assertions
 * below are not about behaviour so much as about what a user could reasonably conclude
 * from what's on screen: that two-step verification is real, and that toggling it does
 * something. Test A and B prove neither is any longer true; Test C proves fixing that
 * did not disturb anything else on the page.
 */

describe("Test A · no enabled MFA claim", () => {
  it("renders the two-step verification switch as off and disabled", () => {
    renderScreen(<ProfileSettings />);

    const toggle = screen.getByRole("switch", { name: /two-step verification/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toBeDisabled();
  });

  it("states plainly that it is not available, rather than describing it as active", () => {
    renderScreen(<ProfileSettings />);

    expect(
      screen.getByText("Not available yet — two-step verification is not currently supported."),
    ).toBeInTheDocument();
    // The exact phrase this task exists to remove.
    expect(screen.queryByText(/you'll be asked for a code on new devices/i)).not.toBeInTheDocument();
  });

  it("does not name a specific sign-in mechanism the account relies on instead", () => {
    renderScreen(<ProfileSettings />);

    // A first attempt at this copy said "sign-in currently relies on your password
    // alone" — false, because a magic-link path also exists. The description must not
    // trade one narrow claim about the account's protection for another.
    expect(screen.queryByText(/password alone/i)).not.toBeInTheDocument();
  });
});

describe("Test B · no fictional success behavior", () => {
  it("produces no toast or state change when the disabled switch is activated", async () => {
    renderScreen(<ProfileSettings />);

    const toggle = screen.getByRole("switch", { name: /two-step verification/i });
    // A disabled control fires no click at all; this is the click a user would make.
    await userEvent.click(toggle);

    expect(screen.queryByText(/two-step verification on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/two-step verification off/i)).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("has no other control anywhere on the page claiming MFA is on or available", () => {
    renderScreen(<ProfileSettings />);

    expect(screen.queryByText(/authenticator app/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { checked: true })).not.toBeInTheDocument();
  });
});

describe("Test C · unrelated settings remain intact", () => {
  it("still renders profile identity fields and the save action", () => {
    renderScreen(<ProfileSettings />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("still renders the security card's other control and the sessions card", () => {
    renderScreen(<ProfileSettings />);

    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out everywhere else/i })).toBeInTheDocument();
  });

  it("still renders the privacy/data alert", () => {
    renderScreen(<ProfileSettings />);
    expect(screen.getByText(/your data belongs to you/i)).toBeInTheDocument();
  });
});
