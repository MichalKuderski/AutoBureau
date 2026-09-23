import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { EMPTY_ONBOARDING, POPULATED_ONBOARDING } from "@/test/onboarding-fixture";
import { OnboardingDraftProvider } from "../onboarding-provider";
import { ReadyStep } from "./ready-step";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });
function ready(populated = true) {
  return renderScreen(<OnboardingDraftProvider initial={populated ? POPULATED_ONBOARDING : EMPTY_ONBOARDING}><ReadyStep /></OnboardingDraftProvider>);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("saved census handover", () => {
  it("states the persisted count while keeping uncited deadlines dateless", () => {
    ready();
    expect(screen.getByText("Your census answers are saved")).toBeInTheDocument();
    expect(screen.getByText(/3 records are saved/)).toBeInTheDocument();
    expect(screen.getByText(/No dated obligations or reminders were created/)).toBeInTheDocument();
    expect(screen.getAllByText("Date unknown")).toHaveLength(3);
    expect(screen.getByText(/remain unverified/)).toBeInTheDocument();
    expect(screen.queryByText(/hunting|we watch the dates|being read now/i)).not.toBeInTheDocument();
  });
  it("keeps an empty setup usable and makes no document processing promise", () => {
    ready(false);
    expect(screen.getByText(/add records by hand/)).toBeInTheDocument();
    expect(screen.getByText(/Sending documents isn't available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add a document/i })).not.toBeInTheDocument();
  });
  it("stays on the step when completion fails, then navigates only after a successful retry", async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => json({ status: 503, title: "Service unavailable" }, 503))
      .mockImplementationOnce(() => json({ ...POPULATED_ONBOARDING, complete: true }));
    vi.stubGlobal("fetch", fetcher);
    ready();
    await userEvent.click(screen.getByRole("button", { name: /save and open your household/i }));
    expect(await screen.findByText("Couldn’t finish your setup")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /save and open your household/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({ stage: "complete", selections: POPULATED_ONBOARDING.selections });
  });
});
