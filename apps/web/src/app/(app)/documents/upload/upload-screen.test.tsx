import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { UploadScreen } from "./upload-screen";

/**
 * Blueprint P0-07 and P0-08.
 *
 * P0-07: this screen used to stage a dropped file, toast "N documents received," and
 * route to /documents — full success theatre for a file that was discarded the instant
 * the handler ran, since no storage backend exists.
 *
 * P0-08: the forwarding address next to it was worse in one respect — it was not
 * discarded, it was invented. `h-${household.id.slice(0, 6)}@in.autobureau.com` was
 * computed client-side from data that has nothing to do with mail routing, and the
 * page told users to forward household bills to it. The fixture's `emailAlias` happens
 * to look like that same pattern (`h-4kq7x@in.autobureau.com`), so several assertions
 * below deliberately use a household override with a visibly different shape — the
 * point is that the screen renders whatever `emailAlias` says, not that it happens to
 * produce a plausible-looking string.
 */

const writeText = vi.fn();

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  writeText.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Test A · dedicated upload does not claim success", () => {
  it("offers no working file picker", () => {
    const { container } = renderScreen(<UploadScreen />);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it("states the upload card is not available, truthfully", () => {
    renderScreen(<UploadScreen />);
    expect(screen.getByRole("heading", { name: /upload or photograph/i })).toBeInTheDocument();
    expect(screen.getByText(/uploads aren't available yet/i)).toBeInTheDocument();
  });

  it("removed the false capability claim from the card description", () => {
    renderScreen(<UploadScreen />);
    expect(screen.queryByText(/pdfs, photos, or a forwarded email saved to your device/i)).not.toBeInTheDocument();
  });

  it("produces no toast and no navigation, because there is no control left to trigger either", async () => {
    renderScreen(<UploadScreen />);
    expect(screen.queryByText(/documents? received/i)).not.toBeInTheDocument();
    // Nothing async runs on mount that could surface a delayed success message.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText(/documents? received/i)).not.toBeInTheDocument();
  });
});

describe("P0-08 Test A · the canonical alias renders", () => {
  it("displays exactly household.emailAlias, not a derived string", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: "real@example.test" } });
    expect(screen.getByRole("heading", { name: /forward it instead/i })).toBeInTheDocument();
    expect(screen.getByText("real@example.test")).toBeInTheDocument();
  });

  it("copies exactly that value and shows the existing success toast", async () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: "real@example.test" } });
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("real@example.test");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("keeps the forwarding instructions once a real destination exists", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: "real@example.test" } });
    expect(screen.getByText(/forward a bill or renewal notice from any inbox/i)).toBeInTheDocument();
  });
});

describe("P0-08 Test B · no fabricated fallback, ever", () => {
  it("does not derive an address from the household id, whatever the id is", () => {
    renderScreen(<UploadScreen />, {
      household: { id: "9f8e7d6c-0000-0000-0000-000000000000", emailAlias: "real@example.test" },
    });
    // The old formula: `h-${id.slice(0, 6)}@in.autobureau.com`. If it were still
    // running, this id would produce "h-9f8e7d@in.autobureau.com" somewhere on the page.
    expect(screen.queryByText(/h-9f8e7d@in\.autobureau\.com/)).not.toBeInTheDocument();
    expect(screen.getByText("real@example.test")).toBeInTheDocument();
  });

  it("renders only the canonical value even when it happens to resemble the old pattern", () => {
    // The fixture's default emailAlias ("h-4kq7x@in.autobureau.com") happens to match
    // the shape the removed formula produced. Pairing it with a household id whose
    // first six characters differ proves the string on screen tracks emailAlias, not id.
    renderScreen(<UploadScreen />, { household: { id: "zzzzzz00-0000-0000-0000-000000000000" } });
    expect(screen.getByText("h-4kq7x@in.autobureau.com")).toBeInTheDocument();
    expect(screen.queryByText(/h-zzzzzz@in\.autobureau\.com/)).not.toBeInTheDocument();
  });
});

describe("P0-08 Test C · a missing alias is stated truthfully", () => {
  it("renders no email-like forwarding address", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: null } });
    expect(screen.queryByText(/@in\.autobureau\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("offers no Copy button for a nonexistent address", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: null } });
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("states plainly that the address is not available", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: null } });
    expect(screen.getByText(/forwarding address not available yet/i)).toBeInTheDocument();
    expect(screen.getByText(/not set up for this household yet/i)).toBeInTheDocument();
  });

  it("does not instruct the user to forward mail anywhere", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: null } });
    expect(screen.queryByText(/forward a bill or renewal notice from any inbox/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/set up a rule in your mail app/i)).not.toBeInTheDocument();
  });

  it("does not invent an activation promise", () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: null } });
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|activate.*shortly|being prepared|contact support/i);
  });
});

describe("P0-08 Test D · copy never fires without a real address", () => {
  it("performs no clipboard write when there is nothing to copy", async () => {
    renderScreen(<UploadScreen />, { household: { emailAlias: null } });
    // There is no Copy button in this state (Test C), so nothing to click — the
    // assertion that matters is that mounting and interacting with the rest of the
    // page never reaches the clipboard.
    await userEvent.click(screen.getByRole("heading", { name: /add documents/i, level: 1 }));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("P0-08 Test E · P0-07's upload-unavailable state is undisturbed", () => {
  it("still offers no file picker, with a present or an absent alias alike", () => {
    for (const emailAlias of ["real@example.test", null] as const) {
      const { container, unmount } = renderScreen(<UploadScreen />, { household: { emailAlias } });
      expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
      expect(screen.getByText(/uploads aren't available yet/i)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("Test D · unrelated content on this screen is unaffected", () => {
  it("still renders the data-handling policy and the useful-documents list", () => {
    renderScreen(<UploadScreen />);
    expect(screen.getByText(/what we do with what you send/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what's most useful/i })).toBeInTheDocument();
    expect(screen.getByText(/insurance policies and renewal notices/i)).toBeInTheDocument();
  });

  it("still renders the page header", () => {
    renderScreen(<UploadScreen />);
    expect(screen.getByRole("heading", { name: /add documents/i, level: 1 })).toBeInTheDocument();
  });
});

/**
 * Blueprint P0-10. "Identity numbers are stored encrypted" was present tense for a
 * control with no implementation anywhere in the repository — no code writes to
 * `item_secrets`. These assertions sit in this file rather than a new one because the
 * claim lives in the same "What we do with what you send" Alert P0-07 already touched,
 * and because the fix must not regress P0-07's disabled-upload state alongside it.
 */

describe("P0-10 Test A · no present-tense encryption claim", () => {
  it("does not claim identity numbers are currently stored encrypted", () => {
    renderScreen(<UploadScreen />);
    expect(screen.queryByText(/numbers are stored\s*\n?\s*encrypted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/identity numbers are stored encrypted/i)).not.toBeInTheDocument();
  });
});

describe("P0-10 Test B · the replacement is accurate commitment tense", () => {
  it("states encryption as a plan, not a running control", () => {
    renderScreen(<UploadScreen />);
    expect(screen.getByText(/the plan is to encrypt them before they're ever stored/i)).toBeInTheDocument();
    expect(screen.getByText(/that protection isn't built yet/i)).toBeInTheDocument();
  });

  it("still says full identity numbers are never shown — that part was already true", () => {
    renderScreen(<UploadScreen />);
    expect(screen.getByText(/identity numbers are\s*\n?\s*never shown in full/i)).toBeInTheDocument();
  });

  it("invents no timeline or already-underway claim", () => {
    renderScreen(<UploadScreen />);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days|already protected/i);
  });
});

describe("P0-10 Test D · P0-07's disabled-upload state is unaffected", () => {
  it("still offers no file picker and still says uploads aren't available", () => {
    const { container } = renderScreen(<UploadScreen />);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(screen.getByText(/uploads aren't available yet/i)).toBeInTheDocument();
  });
});
