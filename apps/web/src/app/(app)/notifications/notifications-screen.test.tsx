import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { matchesKnownRoute } from "@/test/route-manifest";
import { installDomainHttpFixtures } from "@/test/domain-http-fixtures";
import { NotificationsScreen } from "./notifications-screen";

installDomainHttpFixtures();

/**
 * Blueprint P0-14.
 *
 * The "A document needs your review" notification used to link to `/documents/d-7` —
 * a route that does not exist. `NotificationsScreen` already had the right shape for
 * "no destination" (`n.href ? <Link> : <div>`, unconditionally); the defect was
 * entirely in the fixture's `href` field. These assertions render the real screen
 * against the real fixture data, not a hand-built stand-in.
 */

describe("Test B · a dead notification destination is no longer a clickable link", () => {
  it("renders the document-review notification as a plain row, not a link", async () => {
    renderScreen(<NotificationsScreen />);
    const title = await screen.findByText("A document needs your review");
    expect(title.closest("a")).toBeNull();
  });

  it("still shows the notification's full content with no destination", async () => {
    renderScreen(<NotificationsScreen />);
    await screen.findByText("A document needs your review");
    expect(
      screen.getByText(/we read the auto policy renewal notice/i),
    ).toBeInTheDocument();
  });

  it("produces no anchor anywhere on the page pointing at a document detail path", async () => {
    const { container } = renderScreen(<NotificationsScreen />);
    await screen.findByText("A document needs your review");
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.getAttribute("href")).not.toMatch(/^\/documents\/[^u]/);
    }
  });
});

describe("valid notification links remain intact", () => {
  it("still links the due-soon obligation notifications to their real routes", async () => {
    renderScreen(<NotificationsScreen />);
    const streamly = await screen.findByText("Streamly trial converts in 2 days");
    const link = streamly.closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/obligations/o-5");
    expect(matchesKnownRoute("/obligations/o-5")).toBe(true);
  });

  it("still links the weekly digest to the dashboard", async () => {
    renderScreen(<NotificationsScreen />);
    const digest = await screen.findByText(/your week:/i);
    expect(digest.closest("a")).toHaveAttribute("href", "/dashboard");
  });

  it("still renders the filter bar and mark-all-read action", async () => {
    renderScreen(<NotificationsScreen />);
    await screen.findByText("A document needs your review");
    expect(screen.getByRole("group", { name: /filter notifications/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark all read/i })).toBeInTheDocument();
  });
});

describe("Test D · every remaining generated notification href matches a real route", () => {
  it("no notification currently in the fixtures produces a dead destination", async () => {
    const { container } = renderScreen(<NotificationsScreen />);
    await screen.findByText("A document needs your review");
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (href) expect(matchesKnownRoute(href)).toBe(true);
    }
  });
});

describe("saved read state", () => {
  it("marks all loaded notices through the API and keeps that state after remount", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup(); const first = renderScreen(<NotificationsScreen />);
    await user.click(await screen.findByRole("button", { name: "Mark all read" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument());
    first.unmount(); renderScreen(<NotificationsScreen />);
    await screen.findByText("A document needs your review");
    expect(screen.queryByLabelText("Unread", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unread" }));
    await screen.findByText("You're all caught up");
  });
});


describe("read mutation failure", () => {
  it("keeps notices unread when the server refuses a read-state save", async () => {
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((input, init) => String(input).includes("/notifications/read")
      ? Promise.resolve(new Response(JSON.stringify({ type: "https://autobureau.com/problems/unavailable", title: "Unavailable", status: 503 }), { status: 503, headers: { "content-type": "application/json" } }))
      : base(input, init)));
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup(); renderScreen(<NotificationsScreen />);
    await user.click(await screen.findByRole("button", { name: "Mark all read" }));
    await screen.findByText("Couldn’t save read state");
    expect(screen.getAllByLabelText("Unread", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeEnabled();
  });
});
