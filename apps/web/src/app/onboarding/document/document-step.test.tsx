import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { OnboardingProvider } from "../onboarding-provider";
import { DocumentStep } from "./document-step";

/**
 * Blueprint P0-10.
 *
 * "Identity numbers are stored encrypted" was present tense for a control with no
 * implementation anywhere in the repository — no code writes to `item_secrets`. This
 * is the same claim as the dedicated upload screen's, on the one screen where the
 * dropzone underneath it is still the live, interactive path (P0-07 deliberately left
 * onboarding's fake "documents received" toast alone, and this task does not touch it
 * either — only the encryption sentence in the Alert changes here).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

function renderStep() {
  return renderScreen(
    <OnboardingProvider>
      <DocumentStep />
    </OnboardingProvider>,
  );
}

describe("P0-10 Test A · no present-tense encryption claim", () => {
  it("does not claim identity numbers are currently stored encrypted", () => {
    renderStep();
    expect(screen.queryByText(/identity numbers are stored encrypted/i)).not.toBeInTheDocument();
  });
});

describe("P0-10 Test B · the replacement is accurate commitment tense", () => {
  it("states encryption as a plan, not a running control", () => {
    renderStep();
    expect(screen.getByText(/the plan is to encrypt them before they're ever stored/i)).toBeInTheDocument();
    expect(screen.getByText(/that protection isn't built yet/i)).toBeInTheDocument();
  });

  it("still says full identity numbers are never shown — that part was already true", () => {
    renderStep();
    expect(screen.getByText(/identity numbers are\s*\n?\s*never shown in full/i)).toBeInTheDocument();
  });

  it("invents no timeline or already-underway claim", () => {
    renderStep();
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days|already protected/i);
  });
});

describe("P0-10 Test E · unrelated onboarding content is unaffected", () => {
  it("still renders the activation heading and deletion note", () => {
    renderStep();
    expect(screen.getByRole("heading", { name: /send us one document/i })).toBeInTheDocument();
    expect(screen.getByText(/delete the document and everything we derived from it goes too/i)).toBeInTheDocument();
  });

  it("still renders the dropzone as the live, interactive control it already was", () => {
    const { container } = renderStep();
    // P0-10 does not touch upload behavior on this screen — confirmed unchanged: the
    // file input is still present, unlike the P0-07-disabled dedicated upload screen.
    expect(container.querySelectorAll('input[type="file"]').length).toBeGreaterThan(0);
  });

  it("still offers the skip / continue-later path", () => {
    renderStep();
    expect(screen.getByRole("button", { name: /i'll do this later/i })).toBeInTheDocument();
  });
});
