import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { EMPTY_ONBOARDING } from "@/test/onboarding-fixture";
import { OnboardingDraftProvider } from "../onboarding-provider";
import { DocumentStep } from "./document-step";

// Preview onboarding must not invite real uploads or promise unverified data handling.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

function renderStep() {
  return renderScreen(
    <OnboardingDraftProvider initial={EMPTY_ONBOARDING}>
      <DocumentStep />
    </OnboardingDraftProvider>,
  );
}

describe("P0-10 Test A · no present-tense encryption claim", () => {
  it("does not claim identity numbers are currently stored encrypted", () => {
    renderStep();
    expect(screen.queryByText(/identity numbers are stored encrypted/i)).not.toBeInTheDocument();
  });
});

describe("Preview limits are explicit", () => {
  it("offers a keyboard-accessible link to security and visibility limits", async () => {
    renderStep();
    const link = screen.getByRole("link", { name: "Read about security and what we can't see" });
    expect(link).toHaveAttribute("href", "/security");
    await userEvent.setup().tab();
    expect(link).toHaveFocus();
  });

  it("states the remaining verification and live-AI boundary", () => {
    renderStep();
    expect(screen.getByText(/Live AI reading is disabled/)).toBeInTheDocument();
    expect(screen.getByText(/still need verification/)).toBeInTheDocument();
  });

  it("discourages real sensitive paperwork", () => {
    renderStep();
    expect(screen.getByText(/Do not add real sensitive paperwork/)).toBeInTheDocument();
  });

  it("invents no timeline or already-underway claim", () => {
    renderStep();
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days|already protected/i);
  });
});

describe("Optional onboarding remains usable", () => {
  it("offers exploration without a document and avoids a deletion promise", () => {
    renderStep();
    expect(screen.getByRole("heading", { name: /explore without uploading a document/i })).toBeInTheDocument();
    expect(screen.queryByText(/delete the document and everything we derived from it goes too/i)).not.toBeInTheDocument();
  });

  it("still offers the continue path", () => {
    renderStep();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });
});

/**
 * Blueprint P0-07, on its last surface.
 *
 * `671f0e7` disabled the two `(app)` dropzones and recorded that this screen "has the
 * identical defect (same toast, same discarded argument)" but was out of that task's
 * scope. These tests are the blueprint's own acceptance criterion for P0-07 — "assert
 * the dropzone does not report success without a request" — applied here.
 */
describe("P0-07 · onboarding never reports a document it did not receive", () => {
  it("exposes no file input, so no file can be accepted and discarded", () => {
    const { container } = renderStep();
    expect(container.querySelectorAll('input[type="file"]').length).toBe(0);
  });

  it("says sending is unavailable rather than inviting a send", () => {
    renderStep();
    expect(screen.getByText(/uploads are not available here yet/i)).toBeInTheDocument();
  });

  it("makes no present-tense claim that a document was received or is being read", () => {
    const page = renderStep().container.textContent ?? "";
    expect(page).not.toMatch(/documents? received/i);
    expect(page).not.toMatch(/start reading it now/i);
    expect(page).not.toMatch(/being read/i);
  });

  it("invents no timeline for the missing capability", () => {
    const page = renderStep().container.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days|any day now/i);
  });
});
