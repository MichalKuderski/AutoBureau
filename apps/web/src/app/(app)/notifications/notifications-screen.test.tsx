import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { matchesKnownRoute } from "@/test/route-manifest";
import { NotificationsScreen } from "./notifications-screen";

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
