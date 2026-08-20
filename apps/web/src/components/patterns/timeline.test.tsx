import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { matchesKnownRoute } from "@/test/route-manifest";
import { Timeline } from "./timeline";
import { TIMELINE } from "@/lib/domain/fixtures";
import type { TimelineEntry } from "@/lib/domain/types";

/**
 * Blueprint P0-14.
 *
 * A `document_added` entry used to link to `/documents/{id}` and an `item_added` entry
 * to `/household/{id}` — neither route exists. `Timeline` already had the right shape
 * for "no destination": `entry.href ? <Link> : <div>`, unconditionally. The defect was
 * entirely in the data handed to it, not in this component, so these assertions prove
 * the *fixture* no longer sets those hrefs, using the component's real render path
 * rather than reading the fixture module's fields directly.
 */

const ENTRIES: TimelineEntry[] = [
  {
    id: "t-doc",
    at: "2026-01-01T12:00:00.000Z",
    kind: "document_added",
    title: "Renewal notice — auto policy",
    // No href — the P0-14 fixed state for an entry with no real destination.
  },
  {
    id: "t-obl",
    at: "2026-01-01T09:00:00.000Z",
    kind: "obligation_created",
    title: "Elena's supplemental insurance premium",
    href: "/obligations/o-4",
  },
  {
    id: "t-item",
    at: "2026-01-02T12:00:00.000Z",
    kind: "item_added",
    title: "Medicare — Elena",
    // No href.
  },
];

describe("Test C · dead source destinations render as content, not links", () => {
  it("renders the document-added entry with no link, content intact", () => {
    render(<Timeline entries={ENTRIES} />);
    const title = screen.getByText("Renewal notice — auto policy");
    expect(title.closest("a")).toBeNull();
  });

  it("renders the item-added entry with no link, content intact", () => {
    render(<Timeline entries={ENTRIES} />);
    const title = screen.getByText("Medicare — Elena");
    expect(title.closest("a")).toBeNull();
  });

  it("produces no anchor at all pointing at a document or household detail path", () => {
    const { container } = render(<Timeline entries={ENTRIES} />);
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.getAttribute("href")).not.toMatch(/^\/documents\/[^u]/);
      expect(a.getAttribute("href")).not.toMatch(/^\/household\//);
    }
  });
});

describe("valid source destinations remain intact", () => {
  it("still links the obligation-created entry to its real route", () => {
    render(<Timeline entries={ENTRIES} />);
    const link = screen.getByText("Elena's supplemental insurance premium").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/obligations/o-4");
    expect(matchesKnownRoute("/obligations/o-4")).toBe(true);
  });

  it("still groups entries by day and preserves visual hierarchy", () => {
    render(<Timeline entries={ENTRIES} />);
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });
});

describe("Test D · every remaining generated href matches a real route", () => {
  it("no entry in the current fixture-shaped data produces a dead destination", () => {
    for (const entry of ENTRIES) {
      if (!entry.href) continue;
      expect(matchesKnownRoute(entry.href)).toBe(true);
    }
  });

  it("no entry in the real TIMELINE fixture produces a dead destination", () => {
    // Targets the actual fixture data this task edited, not the hand-built ENTRIES
    // above — this is what fails if `fixtures.ts`'s dead hrefs are ever reintroduced.
    const withHref = TIMELINE.filter((e) => e.href);
    expect(withHref.length).toBeGreaterThan(0);
    for (const entry of withHref) {
      expect(matchesKnownRoute(entry.href!)).toBe(true);
    }
  });

  it("renders the real TIMELINE fixture with no document or household link", () => {
    render(<Timeline entries={TIMELINE} />);
    const doc = screen.getByText("Renewal notice — auto policy");
    const item = screen.getByText("Medicare — Elena");
    expect(doc.closest("a")).toBeNull();
    expect(item.closest("a")).toBeNull();
  });
});
