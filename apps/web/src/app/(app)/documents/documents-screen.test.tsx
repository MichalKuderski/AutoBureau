import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { DocumentsScreen } from "./documents-screen";

/**
 * Blueprint P0-07.
 *
 * The drawer was worse than the dedicated upload screen: its `onFiles` handler
 * ignored its own argument (`() => setUploadOpen(false)`) and simply closed, with no
 * toast at all. A drawer closing right after "sending" files reads as success even
 * with zero words said — these assertions open the real drawer through the real
 * button and check what is actually inside it and what happens when it closes.
 */

async function openUploadDrawer(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: /add documents/i }));
  await screen.findByRole("dialog", { name: /add documents/i });
}

describe("Test B · the documents drawer is truthful", () => {
  it("opens on a real button and states plainly that upload is unavailable", async () => {
    renderScreen(<DocumentsScreen />);
    await openUploadDrawer();

    const drawer = screen.getByRole("dialog", { name: /add documents/i });
    expect(within(drawer).getByText(/not available yet/i)).toBeInTheDocument();
    expect(within(drawer).getByText(/uploads aren't available yet/i)).toBeInTheDocument();
  });

  it("offers no file picker inside the drawer", async () => {
    const { container } = renderScreen(<DocumentsScreen />);
    await openUploadDrawer();
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it("removed the false accepted-file-types claim from the drawer description", async () => {
    renderScreen(<DocumentsScreen />);
    await openUploadDrawer();
    expect(screen.queryByText(/pdfs, photos, or forwarded email\. up to 25 mb each/i)).not.toBeInTheDocument();
  });

  it("closing the drawer produces no success toast — there was nothing to send", async () => {
    renderScreen(<DocumentsScreen />);
    await openUploadDrawer();

    await userEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByText(/documents? received/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/added|uploaded|saved/i)).not.toBeInTheDocument();
  });
});

describe("Test D · the rest of the documents screen is unaffected", () => {
  it("still lists documents from the domain query", async () => {
    renderScreen(<DocumentsScreen />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /document/i })).toBeInTheDocument();
  });

  it("removed the upload promise from the empty-state copy without touching the forwarding claim", async () => {
    renderScreen(<DocumentsScreen />);
    // The empty state this copy lives in only renders with zero matching rows, so a
    // search guaranteed to match nothing is what actually exercises it — asserting on
    // the fixture list's non-emptiness would make this pass vacuously.
    await userEvent.type(
      screen.getByPlaceholderText(/search documents/i),
      "no-document-will-ever-match-this-string",
    );

    expect(await screen.findByText(/nothing matches that/i)).toBeInTheDocument();
    expect(screen.getByText(/forward a bill or renewal notice/i)).toBeInTheDocument();
    expect(screen.getByText(/uploading isn't available yet/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/upload a folder of pdfs — we'll take it from there/i),
    ).not.toBeInTheDocument();
  });

  it("still renders the filter bar and search", () => {
    renderScreen(<DocumentsScreen />);
    expect(screen.getByPlaceholderText(/search documents/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /filter documents/i })).toBeInTheDocument();
  });

  it("still renders the page header and its own add-documents action", () => {
    renderScreen(<DocumentsScreen />);
    expect(screen.getByRole("heading", { name: /^documents$/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add documents/i })).toBeInTheDocument();
  });
});
