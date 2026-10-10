import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { HouseholdProvider } from "@/providers/household-provider";
import { HOUSEHOLD, VIEWER } from "@/lib/domain/fixtures";
import { queryKeys } from "@/lib/domain/queries";
import { DashboardScreen } from "./dashboard-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard" }));
afterEach(() => vi.unstubAllGlobals());

const summary = (tracked = 7) => ({ action_needed: 0, upcoming_30d: 0, needs_review: 0,
  items_tracked: tracked, coverage: { expected: null, captured: 0 }, next_digest_at: null });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
type Call = { path: string; household: string; signal: AbortSignal };
function transport(reply: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  let active = 0, peak = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit) => {
    const call = { path: String(input), household: new Headers(init.headers).get("X-Household-Id")!, signal: init.signal as AbortSignal };
    calls.push(call); active++; peak = Math.max(peak, active);
    try {
      // Hold each real apiFetch transport across effects/observer subscriptions.
      await new Promise((resolve) => setTimeout(resolve, 15));
      return await reply(call);
    } finally { active--; }
  }));
  return { calls, peak: () => peak };
}
const success = (call: Call) => response(call.path === "/v1/dashboard" ? summary() : { data: [], next_cursor: null });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: {
    staleTime: 30_000, gcTime: 0, refetchOnWindowFocus: false, retry: 2, retryDelay: 0,
  } } });
  const tree = (id: string) => <QueryClientProvider client={client}>
    <HouseholdProvider household={{ ...HOUSEHOLD, id }} viewer={VIEWER}>
      <ToastProvider><DashboardScreen /></ToastProvider>
    </HouseholdProvider>
  </QueryClientProvider>;
  const view = render(tree("tenant-a"));
  return { client, ...view, navigate: (id: string) => view.rerender(tree(id)),
    dispose: () => { view.unmount(); client.clear(); } };
}
async function loaded(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByText("No saved obligations need action")).toBeInTheDocument();
  expect(screen.getByText("No saved deadlines in the next 45 days")).toBeInTheDocument();
  expect(screen.getByText("Tracked").closest("a")).toHaveTextContent("7");
}

it("serializes the complete dashboard's observers on initial load and refetch", async () => {
  const wire = transport(success), view = setup();
  try {
    await loaded(view.client);
    expect(wire.calls).toHaveLength(4);
    expect(wire.peak()).toBe(1);
    await act(async () => { await view.client.refetchQueries({ type: "active" }); });
    await loaded(view.client);
    expect(wire.calls).toHaveLength(8);
    expect(wire.peak()).toBe(1);
    expect(wire.calls.every(call => call.household === "tenant-a")).toBe(true);
  } finally { view.dispose(); }
});

it("keeps other panels readable during summary retries and serializes the statistics-row Retry", async () => {
  let failing = true;
  const wire = transport(call => call.path === "/v1/dashboard" && failing
    ? response({ type: "https://example.test/unavailable", title: "Unavailable", status: 503 }, 503) : success(call));
  const view = setup();
  try {
    await waitFor(() => expect(view.client.getQueryState(queryKeys.summary("tenant-a"))?.status).toBe("error"));
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    expect(wire.calls.filter(call => call.path === "/v1/dashboard")).toHaveLength(3);
    expect(screen.getByText("No saved obligations need action")).toBeInTheDocument();
    expect(screen.getByText("No saved deadlines in the next 45 days")).toBeInTheDocument();
    expect(wire.peak()).toBe(1);
    failing = false;
    // Start other panel reads while the actual statistics-row error UI retries.
    await act(async () => {
      const others = view.client.refetchQueries({ predicate: query => query.queryKey[0] !== queryKeys.summary("tenant-a")[0] });
      fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: /Try again/i }));
      await others;
    });
    await loaded(view.client);
    expect(wire.calls.filter(call => call.path === "/v1/dashboard")).toHaveLength(4);
    expect(wire.peak()).toBe(1);
  } finally { view.dispose(); }
});

it("cancels queued reads on household navigation without releasing an unsettled transport or showing old data", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const wire = transport(async call => {
    if (call.household === "tenant-a") await held;
    return call.path === "/v1/dashboard" ? response(summary(call.household === "tenant-a" ? 99 : 7)) : success(call);
  });
  const view = setup();
  try {
    await waitFor(() => expect(wire.calls.length).toBeGreaterThan(0));
    expect(wire.calls).toHaveLength(1);
    view.navigate("tenant-b");
    expect(wire.calls[0]!.signal.aborted).toBe(true);
    expect(wire.calls).toHaveLength(1);
    await act(async () => { release(); });
    await loaded(view.client);
    expect(wire.calls.filter(call => call.household === "tenant-a")).toHaveLength(1);
    expect(wire.calls.filter(call => call.household === "tenant-b")).toHaveLength(4);
    expect(view.client.getQueryData(queryKeys.summary("tenant-a"))).toBeUndefined();
    expect(screen.getByText("Tracked").closest("a")).not.toHaveTextContent("99");
    expect(wire.peak()).toBe(1);
  } finally { release(); view.dispose(); }
});
