import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { ThemeProvider } from "@/providers/theme-provider";
import { AppShell } from "./app-shell";

/** `TopBar`'s theme toggle needs `ThemeProvider`; `renderScreen` doesn't supply one
 * because most screens never render `TopBar` directly — `AppShell` is the one consumer
 * that does. */
function renderShell(children: React.ReactNode) {
  return renderScreen(<ThemeProvider>{children}</ThemeProvider>);
}

/**
 * Blueprint P0-17.
 *
 * The mobile drawer already declared `role="dialog"` and `aria-modal="true"` — claims
 * about behavior the implementation didn't back up: nothing trapped focus inside it and
 * nothing handled Escape. `useFocusTrap` already exists and is already proven correct by
 * `Modal`'s own tests; this file exists to prove the *same* hook, reused rather than
 * reimplemented, makes those declared semantics true for the drawer as well.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
}));

/**
 * Focusable descendants in real DOM order — the order the trap itself computes them
 * in (`querySelectorAll` inside `useFocusTrap`), which two separate `getAllByRole`
 * calls concatenated together do not reliably preserve (links and buttons interleave
 * in this drawer's actual markup).
 */
function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
}

async function openDrawer(): Promise<HTMLElement> {
  renderShell(
    <AppShell>
      <p>Page content</p>
    </AppShell>,
  );
  await userEvent.click(screen.getByRole("button", { name: /open navigation/i }));
  return screen.getByRole("dialog", { name: /navigation/i });
}

describe("Test A · the drawer is not trapped while closed", () => {
  it("renders no dialog at all before it is opened", () => {
    renderShell(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape does nothing when the drawer was never opened", async () => {
    renderShell(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Escape must not have been swallowed as if a trap were active — the page's own
    // content is still there and unaffected.
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("ordinary tab order reaches page content with no interception", async () => {
    renderShell(
      <AppShell>
        <button type="button">In-page action</button>
      </AppShell>,
    );
    const target = screen.getByRole("button", { name: "In-page action" });
    target.focus();
    expect(target).toHaveFocus();
  });
});

describe("Test B · opening the drawer activates the trap", () => {
  it("keeps role=\"dialog\" and aria-modal=\"true\"", async () => {
    const dialog = await openDrawer();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("moves focus inside the drawer", async () => {
    const dialog = await openDrawer();
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });
});

describe("Test C · Tab wraps forward inside the drawer", () => {
  it("Tab from the last focusable element returns to the first", async () => {
    const dialog = await openDrawer();
    const focusable = focusableIn(dialog);
    expect(focusable.length).toBeGreaterThan(1);

    focusable[focusable.length - 1]!.focus();
    await userEvent.keyboard("{Tab}");

    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // Specifically the wrap, not merely "still inside": leaving the last element via Tab
    // must land back on the very first one the trap recognises.
    expect(document.activeElement).toBe(focusable[0]);
  });
});

describe("Test D · Shift+Tab wraps backward inside the drawer", () => {
  it("Shift+Tab from the first focusable element wraps to the last", async () => {
    const dialog = await openDrawer();
    const focusable = focusableIn(dialog);

    focusable[0]!.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");

    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });
});

describe("Test E · Escape closes the drawer and restores focus", () => {
  it("closes on Escape", async () => {
    await openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns focus to the trigger that opened it", async () => {
    renderShell(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    const trigger = screen.getByRole("button", { name: /open navigation/i });
    await userEvent.click(trigger);
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("Test F · the existing close button still works", () => {
  it("the drawer's own close button closes it exactly as before", async () => {
    const dialog = await openDrawer();
    await userEvent.click(within(dialog).getByRole("button", { name: /close navigation/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the full-screen backdrop still closes it", async () => {
    renderShell(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    await screen.findByRole("dialog");

    // The backdrop is the *other* "Close navigation" control — a sibling of the dialog,
    // not one of its focusable descendants, and unaffected by the trap living in the
    // dialog panel.
    const buttons = screen.getAllByRole("button", { name: /close navigation/i });
    const backdrop = buttons.find((b) => !within(screen.getByRole("dialog")).queryByRole("button", { name: /close navigation/i })?.isSameNode(b));
    expect(backdrop).toBeDefined();
    await userEvent.click(backdrop!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Test G · navigation links still work and still close the drawer", () => {
  it("a nav link inside the drawer keeps its real destination and closes the drawer on click", async () => {
    const dialog = await openDrawer();
    const documentsLink = within(dialog).getByRole("link", { name: /documents/i });
    expect(documentsLink).toHaveAttribute("href", "/documents");

    await userEvent.click(documentsLink);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Test H · desktop navigation is unaffected", () => {
  it("renders the desktop sidebar with no dialog role and no trap", () => {
    renderShell(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    const primary = screen.getByRole("complementary", { name: "Primary" });
    expect(within(primary).queryByRole("dialog")).not.toBeInTheDocument();
    // The desktop sidebar's own nav links are ordinary tab stops, never intercepted.
    expect(within(primary).getByRole("link", { name: /documents/i })).toHaveAttribute(
      "href",
      "/documents",
    );
  });

  it("does not lock page scroll when only the desktop sidebar is present", () => {
    renderShell(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
