import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { OnboardingProvider, useOnboarding } from "../onboarding-provider";
import { ReadyStep } from "./ready-step";

/**
 * The census is a draft that is posted nowhere.
 *
 * `OnboardingProvider` is React state; no route under `app/v1` accepts a census, and
 * `seedFromCensus` feeds this screen and nothing else. Everything the reader sees here is
 * therefore gone on reload — while the household and session created at sign-up are real
 * and permanent.
 *
 * The screen used to state the opposite in the present tense: items were "in your
 * registry", deadlines were being "hunted for", members were being "tracked". These tests
 * pin the correction, and they are deliberately written against the *claim* rather than
 * the wording — a future rewrite may say it differently, but it may not say the system
 * holds state it does not hold. When the persistence half of P1-02 lands, these
 * expectations are what should be revisited, and only then.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

/** Drives the draft through the provider's own API — no state is faked. */
function Seed({ ticks, member }: { ticks: string[]; member?: string }) {
  const { toggleSelection, addMember } = useOnboarding();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    ticks.forEach(toggleSelection);
    if (member !== undefined) addMember({ displayName: member, kind: "dependent" });
  }, [ticks, member, toggleSelection, addMember]);
  return null;
}

function renderReady(ticks: string[] = [], member?: string) {
  return renderScreen(
    <OnboardingProvider>
      <Seed ticks={ticks} {...(member === undefined ? {} : { member })} />
      <ReadyStep />
    </OnboardingProvider>,
  );
}

/** Prompt ids the census actually offers, so the seed produces real items. */
const TICKS = ["medicare", "supplemental", "vehicle"];

describe("onboarding hand-over · never claims durable state it does not have", () => {
  it("does not tell the reader their answers are in a registry", () => {
    const page = renderReady(TICKS, "Mom").container.textContent ?? "";
    expect(page).not.toMatch(/in your registry/i);
    expect(page).not.toMatch(/in mom's registry/i);
  });

  it("does not claim anything is being tracked, watched, or hunted for", () => {
    const page = renderReady(TICKS, "Mom").container.textContent ?? "";
    expect(page).not.toMatch(/we're hunting|we are hunting/i);
    expect(page).not.toMatch(/\btracking for\b/i);
    expect(page).not.toMatch(/we watch the dates/i);
  });

  it("says plainly that the summary is not saved", () => {
    renderReady(TICKS, "Mom");
    expect(screen.getByText(/this summary isn't saved/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing records\s+them yet/i)).toBeInTheDocument();
  });

  it("still tells the truth about what IS durable — the household exists", () => {
    const page = renderReady(TICKS, "Mom").container.textContent ?? "";
    expect(page).toMatch(/your household is created/i);
  });
});

describe("onboarding hand-over · keeps the provisionality it already had", () => {
  it("shows flagged deadlines without attaching a date to any of them", () => {
    renderReady(TICKS, "Mom");
    expect(screen.getByText(/deadlines you flagged/i)).toBeInTheDocument();
    expect(screen.getAllByText(/date unknown/i).length).toBeGreaterThan(0);
  });

  it("attributes the items to the reader's own answers, not to the system's knowledge", () => {
    renderReady(TICKS, "Mom");
    expect(screen.getByText(/you told us these exist/i)).toBeInTheDocument();
  });
});

describe("onboarding hand-over · the empty path", () => {
  it("offers no document action, because that control cannot accept one (P0-07)", () => {
    renderReady();
    expect(screen.queryByRole("link", { name: /add a document/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sending documents isn't available yet/i)).toBeInTheDocument();
  });

  it("does not claim a document is being read — none can be", () => {
    const page = renderReady(TICKS, "Mom").container.textContent ?? "";
    expect(page).not.toMatch(/being read now/i);
  });

  it("still routes onward to the household", () => {
    renderReady();
    expect(screen.getByRole("link", { name: /go to your household/i })).toBeInTheDocument();
  });
});
