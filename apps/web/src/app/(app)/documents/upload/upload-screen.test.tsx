import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { UploadScreen } from "./upload-screen";

/**
 * Blueprint P0-07.
 *
 * This screen used to stage a dropped file, toast "N documents received," and route
 * to /documents — full success theatre for a file that was discarded the instant the
 * handler ran, since no storage backend exists. These assertions are about what a
 * user reading this screen could reasonably conclude: not that the dropzone renders,
 * but that nothing on it claims a document went anywhere.
 */

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

describe("Test D · unrelated content on this screen is unaffected", () => {
  it("still renders the forwarding alias and its copy control", async () => {
    renderScreen(<UploadScreen />);
    expect(screen.getByRole("heading", { name: /forward it instead/i })).toBeInTheDocument();
    expect(screen.getByText(/@in\.autobureau\.com/)).toBeInTheDocument();

    const copy = screen.getByRole("button", { name: /copy/i });
    await userEvent.click(copy);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

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
