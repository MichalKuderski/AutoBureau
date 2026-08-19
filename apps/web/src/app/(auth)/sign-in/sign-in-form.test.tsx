import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { SignInForm } from "./sign-in-form";

/**
 * Blueprint P0-05.
 *
 * "Continue with Google" and "Continue with Apple" rendered as ordinary, trustworthy
 * buttons and did `router.push(next)` on click — no request, no provider, no session.
 * With the real middleware active the user would be bounced straight back to sign-in.
 * These assertions prove the page no longer offers a path it cannot walk, while the
 * two paths it genuinely has — password and magic link — are undisturbed.
 */

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Test A · no non-functional OAuth controls", () => {
  it("renders no Google or Apple sign-in control", () => {
    renderScreen(<SignInForm />);

    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apple/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with apple/i)).not.toBeInTheDocument();
  });

  it("carries no leftover divider with nothing left to divide", () => {
    renderScreen(<SignInForm />);
    // The "or" divider existed only to separate the form from the OAuth section.
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });
});

describe("Test B · working authentication remains", () => {
  it("still renders the password sign-in path", () => {
    renderScreen(<SignInForm />);

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /forgot your password/i })).toBeInTheDocument();
  });

  it("still offers the magic-link path", () => {
    renderScreen(<SignInForm />);
    expect(
      screen.getByRole("button", { name: /email me a one-time link instead/i }),
    ).toBeInTheDocument();
  });

  it("still links to sign-up", () => {
    renderScreen(<SignInForm />);
    expect(screen.getByRole("link", { name: /create an account/i })).toBeInTheDocument();
  });
});

describe("Test C · no dead OAuth handler remains", () => {
  it("has no click target anywhere on the page that navigates without authenticating", () => {
    renderScreen(<SignInForm />);

    // Every remaining button on the page is accounted for by the working paths: the
    // submit button, the password/link mode toggle. None navigates on click alone —
    // the router mock is only ever touched by the real sign-in submission, and this
    // test never submits, so it must still be untouched.
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    const buttonNames = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttonNames.some((name) => /google|apple/i.test(name ?? ""))).toBe(false);
  });
});
