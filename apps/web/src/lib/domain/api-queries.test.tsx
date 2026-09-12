import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { domainFixtureFetch } from "@/test/domain-http-fixtures";
import { CollectionMore } from "@/components/patterns/collection-more";
import { ObligationDetailScreen } from "@/app/(app)/obligations/[id]/obligation-detail-screen";
import { DashboardScreen } from "@/app/(app)/dashboard/dashboard-screen";
import { useItems } from "./queries";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const unavailable = () => json({ type: "https://autobureau.com/problems/unavailable", title: "Service unavailable", status: 503, detail: "Please retry." }, 503);
function ItemsProbe({ household = "h-1" }: { household?: string }) {
  const query = useItems(household, { search: "Cover & care", memberId: "m-1" });
  return <><p>{query.isPending ? "Loading records" : query.isError ? "Records failed" : `${query.data.length} records`}</p>
    <ul>{query.data.map((item) => <li key={item.id}>{item.name}</li>)}</ul><CollectionMore query={query} /></>;
}

describe("screens use the tenant API and its actual result", () => {
  it("an empty server page stays empty and filter parameters are encoded on the request", async () => {
    const fetcher = vi.fn().mockImplementation(() => json({ data: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetcher);
    renderScreen(<ItemsProbe />);
    expect(await screen.findByText("0 records")).toBeInTheDocument();
    const [path, options] = fetcher.mock.calls[0]!;
    const url = new URL(path, "https://app.example.test");
    expect(url.searchParams.get("q")).toBe("Cover & care");
    expect(url.searchParams.get("member_id")).toBe("m-1");
    expect(options.headers["X-Household-Id"]).toBe("h-1");
    expect(screen.queryByText(/passport/i)).not.toBeInTheDocument();
  });
  it("keeps the first page visible when continuation fails, then retries the same cursor", async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => json({ data: [{ id: "one", name: "Saved cover" }], next_cursor: "opaque-next" }))
      .mockImplementationOnce(unavailable).mockImplementationOnce(() => json({ data: [{ id: "two", name: "Another cover" }], next_cursor: null }));
    vi.stubGlobal("fetch", fetcher);
    renderScreen(<ItemsProbe />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Couldn’t load the next page")).toBeInTheDocument();
    expect(screen.getByText("Saved cover")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("2 records")).toBeInTheDocument();
    expect(fetcher.mock.calls[1]![0]).toEqual(fetcher.mock.calls[2]![0]);
    expect(String(fetcher.mock.calls[2]![0])).toContain("cursor=opaque-next");
  });
  it("shows an initial network failure as an error, never an empty household", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(unavailable));
    renderScreen(<ItemsProbe />);
    expect(await screen.findByText("Records failed")).toBeInTheDocument();
    expect(screen.queryByText("0 records")).not.toBeInTheDocument();
  });
  it("retains an outcome after a failed save and closes only after server confirmation", async () => {
    const fixture = domainFixtureFetch();
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH" && fail) return unavailable();
      return fixture(input, init);
    }));
    renderScreen(<ObligationDetailScreen id="o-1" />);
    await userEvent.click(await screen.findByRole("button", { name: /mark as done/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/what did it cost/i), "164");
    await userEvent.click(within(dialog).getByRole("button", { name: /save and close/i }));
    expect(await within(dialog).findByText("Couldn’t save this completion")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/what did it cost/i)).toHaveValue("164");
    expect(screen.queryByText("Handled")).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(within(dialog).getByRole("button", { name: /save and close/i }));
    expect(await screen.findByText("Handled")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("does not invent a coverage percentage, digest date or upcoming reassurance on errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/v1/dashboard") return json({ action_needed: 0, upcoming_30d: 0, needs_review: 0, items_tracked: 0,
        coverage: { captured: 0, expected: null }, value_found_cents: null, next_digest_at: null });
      return unavailable();
    }));
    renderScreen(<DashboardScreen />);
    expect(await screen.findByText("Building your ledger")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/next weekly summary/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No saved deadlines in the next 45 days")).not.toBeInTheDocument();
  });
});
