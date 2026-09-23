import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { SignUpForm } from "./sign-up-form";

/**
 * Blueprint P0-05. Same finding as the sign-in form, same fix: "Continue with
 * Google/Apple" did `router.push(next)` with no request behind it. See
 * `sign-in-form.test.tsx` for the fuller rationale — this file proves the same
 * property on the second page that rendered the same dead controls.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

describe("Test A · no non-functional OAuth controls", () => {
  it("renders no Google or Apple sign-in control", () => {
    renderScreen(<SignUpForm />);

    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apple/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with apple/i)).not.toBeInTheDocument();
  });

  it("carries no leftover divider with nothing left to divide", () => {
    renderScreen(<SignUpForm />);
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });
});

describe("Test B · working authentication remains", () => {
  it("still renders the sign-up form fields and submit action", () => {
    renderScreen(<SignUpForm />);

    expect(screen.getByRole("heading", { name: /start your household ledger/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("still links back to sign-in", () => {
    renderScreen(<SignUpForm />);
    expect(screen.getByRole("link", { name: /already have an account/i })).toBeInTheDocument();
  });
});

describe("Test C · no dead OAuth handler remains", () => {
  it("has no button on the page named after a third-party provider", () => {
    renderScreen(<SignUpForm />);

    const buttonNames = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttonNames.some((name) => /google|apple/i.test(name ?? ""))).toBe(false);
  });
});
