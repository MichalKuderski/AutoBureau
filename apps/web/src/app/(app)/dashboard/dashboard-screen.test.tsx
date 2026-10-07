import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { OBLIGATIONS } from "@/lib/domain/fixtures";
import { DashboardScreen } from "./dashboard-screen";

const queries = vi.hoisted(() => ({ summary: vi.fn(), obligations: vi.fn() }));
vi.mock("@/lib/domain/queries", () => ({
  useSummary: queries.summary,
  useObligations: queries.obligations,
  useUpdateObligationStatus: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard" }));

const result = <T,>(data: T) => ({ data, isPending: false, isError: false, error: new Error("unavailable"), refetch: vi.fn(), hasNextPage: false });
const zeroSummary = () => result({ action_needed: 0, upcoming_30d: 0, needs_review: 0, items_tracked: 0,
  coverage: { expected: null, captured: 0 }, next_digest_at: null });
let summary: ReturnType<typeof zeroSummary>;
let action: ReturnType<typeof result<typeof OBLIGATIONS>>;
let upcoming: ReturnType<typeof result<typeof OBLIGATIONS>>;

beforeEach(() => {
  summary = zeroSummary(); action = result([]); upcoming = result([]);
  queries.summary.mockImplementation(() => summary);
  queries.obligations.mockImplementation((_id, filters) => filters.dueWithinDays === 45 ? upcoming : filters.direction ? result([]) : action);
});

describe("dashboard partial-read messaging", () => {
  it("keeps valid zero statistics and the scoped empty list without global reassurance when upcoming fails", () => {
    upcoming.isError = true;
    renderScreen(<DashboardScreen />);
    expect(screen.getByText(/Some dashboard information couldn't be loaded/)).toBeInTheDocument();
    expect(screen.getByText("Next 30 days").closest("a")).toHaveTextContent("0");
    expect(screen.getByText("No saved obligations need action")).toBeInTheDocument();
    const section = screen.getByRole("heading", { name: "Coming up · next 45 days" }).closest("section")!;
    expect(within(section).getByRole("alert")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: /Try again/i }));
    expect(upcoming.refetch).toHaveBeenCalledOnce();
    expect(summary.refetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing needs you|nothing is coming up soon/)).not.toBeInTheDocument();
  });

  it.each(["summary", "action", "upcoming"])("does not announce complete counts while %s is pending", (name) => {
    ({ summary, action, upcoming })[name as "summary" | "action" | "upcoming"].isPending = true;
    renderScreen(<DashboardScreen />);
    expect(screen.getByText("Loading dashboard information.")).toBeInTheDocument();
    expect(screen.queryByText(/0 saved obligations need action\./)).not.toBeInTheDocument();
  });

  it("does not reuse a stale summary as a healthy global description after a summary error", () => {
    summary.isError = true;
    renderScreen(<DashboardScreen />);
    expect(screen.getByText(/Some dashboard information couldn't be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/0 saved obligations need action\./)).not.toBeInTheDocument();
    expect(screen.getByText("No saved deadlines in the next 45 days")).toBeInTheDocument();
  });

  it("restores explicitly bounded summary wording after upcoming recovers", () => {
    upcoming.isError = true;
    const view = renderScreen(<DashboardScreen />);
    upcoming.isError = false;
    view.rerender(<DashboardScreen />);
    expect(screen.queryByText(/Some dashboard information couldn't be loaded/)).not.toBeInTheDocument();
    expect(screen.getByText("0 saved obligations need action. 0 due in the next 30 days.")).toBeInTheDocument();
    expect(screen.getByText("No saved deadlines in the next 45 days")).toBeInTheDocument();
  });

  it("distinguishes the summary's 30-day horizon from the panel's 45-day horizon", () => {
    const obligation = { ...OBLIGATIONS[0]!, id: "synthetic-day-40", title: "Synthetic deadline on day 40",
      status: "upcoming" as const, due_at: new Date(Date.now() + 40 * 86_400_000).toISOString() };
    upcoming.data = [obligation];
    renderScreen(<DashboardScreen />);
    expect(screen.getByText("0 saved obligations need action. 0 due in the next 30 days.")).toBeInTheDocument();
    expect(screen.getByText("Synthetic deadline on day 40")).toBeInTheDocument();
    expect(screen.queryByText("No saved deadlines in the next 45 days")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming up · next 45 days" })).toBeInTheDocument();
    expect(queries.obligations).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dueWithinDays: 45 }), true, expect.any(Function));
  });
});
