import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";
import { ErrorState, describeError, ErrorBoundary } from "./error-state";

/**
 * Blueprint P0-12.
 *
 * "Your session ended" left the user with only "Try again" — a button that retries
 * the exact request that just 401'd, against the exact session that is still expired,
 * which fails identically every time. `showSignIn` replaces that dead end with a real
 * path back in: `/sign-in?next=<here>`, built from wherever the user actually was
 * when the session gave out, run through the same `safeDestination` guard the rest of
 * the app already trusts for this — not a second implementation of it.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const pathnameRef = { current: "/dashboard" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathnameRef.current,
}));

beforeEach(() => {
  push.mockClear();
  pathnameRef.current = "/dashboard";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const authError = () =>
  new ApiError({
    type: "https://autobureau.com/problems/unauthorized",
    title: "Sign in to continue.",
    status: 401,
  });

const notFoundError = () =>
  new ApiError({
    type: "https://autobureau.com/problems/not-found",
    title: "That wasn't found.",
    status: 404,
  });

describe("Test 1 · existing behavior is unchanged when no primary action is supplied", () => {
  it("renders title and description alone when neither onRetry nor showSignIn is passed", () => {
    render(<ErrorState title="Something went wrong" description="Try again in a moment." />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("Try again in a moment.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("still renders the Try again button exactly as before when only onRetry is passed", async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn't load this" onRetry={onRetry} />);

    const button = screen.getByRole("button", { name: /try again/i });
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("renders no alert-region regression — role and structure are unchanged", () => {
    render(<ErrorState title="X" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("Test 2 · a 401/session-expired state renders a visible Sign in again action", () => {
  it("describeError marks a 401 ApiError with showSignIn", () => {
    const described = describeError(authError());
    expect(described.title).toBe("Your session ended");
    expect(described.showSignIn).toBe(true);
  });

  it("renders the Sign in again button, not Try again, for a 401", () => {
    render(<ErrorState {...describeError(authError())} onRetry={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
    // Retry is suppressed for this case — see the component's own rationale comment:
    // a request that 401'd once will 401 again until the session is repaired.
    expect(screen.queryByRole("button", { name: /^try again$/i })).not.toBeInTheDocument();
  });

  it("keeps the truthful session-ended messaging", () => {
    render(<ErrorState {...describeError(authError())} />);
    expect(screen.getByText("Your session ended")).toBeInTheDocument();
    expect(screen.getByText("Sign in again to pick up where you left off.")).toBeInTheDocument();
  });
});

describe("Test 3 · the action targets /sign-in?next=<current-path>", () => {
  it("navigates to /sign-in with the current path as next", async () => {
    pathnameRef.current = "/obligations/o-1";
    render(<ErrorState {...describeError(authError())} />);

    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/sign-in?next=%2Fobligations%2Fo-1");
  });
});

describe("Test 4 · the current path is correctly URL-encoded", () => {
  it("encodes characters that would otherwise corrupt the query string", async () => {
    // A space and a literal "&" — either would break a naively-concatenated query
    // string if not encoded.
    pathnameRef.current = "/documents/a b & c";
    render(<ErrorState {...describeError(authError())} />);

    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    const [href] = push.mock.calls[0] as [string];
    expect(href).toBe(`/sign-in?next=${encodeURIComponent("/documents/a b & c")}`);
    // The encoded form must not contain a raw space or ampersand — proof the query
    // string itself cannot be split or extended by the path's own content.
    expect(href).not.toMatch(/next=.*[ &]/);
  });
});

describe("Test 5 · the destination cannot become an external redirect", () => {
  it("falls back to the safe default when the path looks like a protocol-relative URL", async () => {
    // Not a value `usePathname()` returns in practice, but this proves the guard
    // itself runs rather than being trusted to never see a hostile value.
    pathnameRef.current = "//evil.example/pwn";
    render(<ErrorState {...describeError(authError())} />);

    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(push).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent("/dashboard")}`);
  });

  it("never sends the router to an absolute or protocol-based URL", async () => {
    pathnameRef.current = "https://evil.example/pwn";
    render(<ErrorState {...describeError(authError())} />);
    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    const [href] = push.mock.calls[0] as [string];
    expect(href.startsWith("/sign-in?next=")).toBe(true);
    expect(href).not.toContain("evil.example");
  });
});

describe("Test 6 · Try again remains intact for unrelated errors", () => {
  it("a 404 still offers Try again and nothing else", async () => {
    const onRetry = vi.fn();
    render(<ErrorState {...describeError(notFoundError())} onRetry={onRetry} />);

    const button = screen.getByRole("button", { name: /try again/i });
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Test 7 · non-401 error states do not unexpectedly receive a sign-in action", () => {
  it.each([403, 404, 429, 500, 402])("status %d does not set showSignIn", (status) => {
    const error = new ApiError({
      type: "https://autobureau.com/problems/internal",
      title: "x",
      status,
    });
    expect(describeError(error).showSignIn).toBeUndefined();
  });

  it("a non-ApiError (unknown thrown value) does not set showSignIn", () => {
    expect(describeError(new Error("boom")).showSignIn).toBeUndefined();
  });

  it("renders no Sign in again button for a 404", () => {
    render(<ErrorState {...describeError(notFoundError())} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /sign in again/i })).not.toBeInTheDocument();
  });
});

describe("ErrorBoundary consistency", () => {
  it("gives a caught 401 ApiError the same Sign in again recovery as the query.isError path", async () => {
    function Thrower(): never {
      throw authError();
    }
    render(
      <ErrorBoundary region="test">
        <Thrower />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
  });
});
