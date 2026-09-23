import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/notifications",
}));

// A page-level state must not skip from the page's h1 to an h3; a sectioned one nests.
describe("state heading levels", () => {
  it("defaults to a section-level heading and can stand directly under the page title", () => {
    const { rerender } = render(<EmptyState title="Nothing yet" />);
    expect(screen.getByRole("heading", { name: "Nothing yet", level: 3 })).toBeTruthy();
    rerender(<EmptyState title="Nothing yet" headingLevel={2} />);
    expect(screen.getByRole("heading", { name: "Nothing yet", level: 2 })).toBeTruthy();
    rerender(<ErrorState title="Could not load" headingLevel={2} />);
    expect(screen.getByRole("heading", { name: "Could not load", level: 2 })).toBeTruthy();
  });
});
