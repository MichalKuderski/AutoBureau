import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDropzone } from "./upload";

/**
 * Blueprint P0-07.
 *
 * `disabled` exists because no storage backend exists: a file dropped here used to be
 * validated, staged, and then thrown away the moment `onFiles` ran, while the screens
 * around it told the user something had been sent. These assertions are about the
 * primitive itself — that the disabled state is genuinely inert, not merely styled to
 * look that way, and that the ordinary interactive path (still used by onboarding,
 * which P0-07 does not touch) is unchanged.
 */

function pdf(name = "renewal.pdf"): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

describe("disabled — no destination for a file, so no way to offer one", () => {
  it("renders no file input at all", () => {
    const { container } = render(<UploadDropzone disabled />);
    // Not "hidden" or "disabled" inputs — none. A disabled input can still be found by
    // automation and re-enabled; an absent one cannot produce an OS file dialog.
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it("offers no clickable control of any kind", () => {
    render(<UploadDropzone disabled />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("states plainly that upload is not available, without implying a queue or timeline", () => {
    render(<UploadDropzone disabled />);
    expect(screen.getByText(/uploads aren't available yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/queued|processing|under review|coming soon/i)).not.toBeInTheDocument();
  });

  it("never calls onFiles — there is no path left that could reach it", () => {
    const onFiles = vi.fn();
    render(<UploadDropzone disabled onFiles={onFiles} />);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("has nothing to remove or send, because nothing can be staged", () => {
    render(<UploadDropzone disabled />);
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take a photo/i })).not.toBeInTheDocument();
  });
});

describe("enabled (default) — unchanged for the consumer that still uses it", () => {
  it("stages a selected file and reports it through onFiles on send", async () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles} />);

    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await userEvent.upload(input, pdf());

    expect(screen.getByText("renewal.pdf")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: /send 1 document/i });
    await userEvent.click(send);

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "renewal.pdf" })]);
  });

  it("still offers the camera capture control", () => {
    render(<UploadDropzone />);
    expect(screen.getByRole("button", { name: /take a photo instead/i })).toBeInTheDocument();
  });
});
