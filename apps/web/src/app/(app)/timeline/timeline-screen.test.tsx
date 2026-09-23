import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { TimelineScreen } from "./timeline-screen";

vi.mock("next/navigation", () => ({ usePathname: () => "/timeline", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());
const page = (data: unknown[]) => new Response(JSON.stringify({ data, next_cursor: null }), { headers: { "content-type": "application/json" } });
describe("persisted activity history", () => {
  it("keeps a new household empty and applies its selected filter on the server", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => page([]));
    vi.stubGlobal("fetch", fetcher);
    renderScreen(<TimelineScreen />);
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.queryByText("Medicare — Elena")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Records" }));
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    expect(fetcher.mock.calls.some((args) => String(args[0]).includes("lens=items"))).toBe(true);
  });
  it("renders the saved action with its real destination", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([{ id: "19", at: "2026-09-12T12:00:00Z", kind: "obligation_completed",
      title: "Deadline completed", detail: "Current record: Saved renewal", href: "/obligations/saved" }])));
    renderScreen(<TimelineScreen />);
    expect(await screen.findByRole("link", { name: /Deadline completed/ })).toHaveAttribute("href", "/obligations/saved");
  });
  it("reports a failed read as an error and retries without inventing history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 503, title: "Service unavailable", detail: "Retry later." }), { status: 503 }))
      .mockImplementation(() => page([])));
    renderScreen(<TimelineScreen />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
  });
});
