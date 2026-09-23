import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { CSRF_HEADER } from "@/lib/csrf";
import { SignOutButton } from "./nav";

/**
 * Blueprint P0-02.
 *
 * The question these assertions exist to answer is not "does pressing Sign Out reach
 * `/sign-in`" — the control already did that, and it was the defect. It is whether the
 * request that ends the session is actually made, and whether the UI refuses to claim
 * success when it was not.
 *
 * Where the session is genuinely terminated is proved one level down, over HTTP against a
 * real database, in `server/http/v1-boundary.integration.test.ts`. A mocked `replace()` is
 * evidence of navigation and nothing else, so it is never the proof relied on here.
 */

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const NO_CONTENT = (): Response => new Response(null, { status: 204 });

const PROBLEM = (status: number): Response =>
  new Response(
    JSON.stringify({
      type: "https://autobureau.com/problems/unavailable",
      title: "Temporarily unavailable — try again shortly.",
      status,
    }),
    { status, headers: { "content-type": "application/problem+json" } },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  fetchMock = vi.fn().mockResolvedValue(NO_CONTENT());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the sign-out control ends the session rather than navigating away from it", () => {
  it("posts to the sign-out endpoint", async () => {
    renderScreen(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(path).toBe("/v1/auth/sign-out");
    expect(init.method).toBe("POST");
  });

  it("carries the CSRF header the endpoint requires", async () => {
    renderScreen(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Not re-implemented here: `apiFetch` attaches it, which is the point of routing
    // through the one HTTP door rather than calling `fetch` from a component.
    expect(headers[CSRF_HEADER]).toBe("1");
    expect(init.credentials).toBe("same-origin");
  });

  it("is a button, not a link to /sign-in", async () => {
    renderScreen(<SignOutButton />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("leaves for /sign-in only after the server confirms with 204", async () => {
    renderScreen(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    // The router cache would otherwise re-render the last authenticated payload on Back.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledBefore(replace as never);
  });
});

describe("a failed sign-out is never reported as success", () => {
  it.each([
    ["the deployment is unconfigured", () => PROBLEM(503)],
    ["the request could not be verified", () => PROBLEM(403)],
    ["the network is unreachable", () => Promise.reject(new TypeError("network"))],
  ])("%s → stays put and says so", async (_label, outcome) => {
    fetchMock.mockImplementation(() => outcome());
    renderScreen(<SignOutButton />);

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByText(/couldn't sign you out/i)).toBeInTheDocument();
    expect(screen.getByText(/still signed in/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("re-enables so the user can try again", async () => {
    fetchMock.mockResolvedValue(PROBLEM(503));
    renderScreen(<SignOutButton />);

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await screen.findByText(/couldn't sign you out/i);

    const button = screen.getByRole("button", { name: /sign out/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("the control cannot be double-submitted", () => {
  it("posts once however many times it is pressed", async () => {
    // A request that never settles: the window in which a second press is possible.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen(<SignOutButton />);

    const button = screen.getByRole("button", { name: /sign out/i });
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables itself and announces that it is working", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen(<SignOutButton />);

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    const button = await screen.findByRole("button", { name: /signing out/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("it remains operable without a mouse", () => {
  it("activates on Enter", async () => {
    renderScreen(<SignOutButton />);
    screen.getByRole("button", { name: /sign out/i }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("activates on Space — which the previous anchor did not", async () => {
    renderScreen(<SignOutButton />);
    screen.getByRole("button", { name: /sign out/i }).focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("is reachable by keyboard and keeps an accessible name", async () => {
    renderScreen(<SignOutButton />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /sign out/i })).toHaveFocus();
  });
});
