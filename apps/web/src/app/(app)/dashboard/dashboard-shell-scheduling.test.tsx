import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/providers/theme-provider";
import { HouseholdProvider, type ActiveHousehold } from "@/providers/household-provider";
import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/patterns/command-palette";
import { BillingSettings } from "../settings/billing/billing-settings";
import { HOUSEHOLD, VIEWER } from "@/lib/domain/fixtures";
import { DashboardScreen } from "./dashboard-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard" }));
afterEach(() => vi.unstubAllGlobals());
const billing = { tier: "free", state: "none", cadence: null, paidThrough: null, premiumUntil: null,
  testMode: false, subscribed: false, checkoutOpen: false, paymentUpdateAvailable: false, checkoutAvailable: false };
const response = (body: unknown, status = 200) => Response.json(body, { status });
type Call = { path: string; household: string; signal: AbortSignal; method: string };
const success = (call: Call) => response(call.path.endsWith("/billing") ? billing : call.path === "/v1/dashboard"
  ? { action_needed: 0, upcoming_30d: 0, needs_review: 0, items_tracked: 7, coverage: { expected: null, captured: 0 }, next_digest_at: null }
  : { data: [], next_cursor: null });
function wire(reply: (call: Call) => Response | Promise<Response> = success) {
  let active = 0, peak = 0;
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit) => {
    const call = { path: String(input), household: new Headers(init.headers).get("X-Household-Id")!, signal: init.signal as AbortSignal, method: init.method ?? "GET" };
    calls.push(call); active++; peak = Math.max(active, peak);
    try { await new Promise(r => setTimeout(r, 15)); return await reply(call); }
    finally { active--; }
  }));
  return { calls, peak: () => peak };
}
function setup(settings = false, role: ActiveHousehold["role"] = "owner") {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 0, retry: 2, retryDelay: 0, refetchOnWindowFocus: false } } });
  const tree = (id: string, currentRole = role) => <QueryClientProvider client={client}><ThemeProvider>
    <HouseholdProvider household={{ ...HOUSEHOLD, id, role: currentRole }} viewer={VIEWER}><ToastProvider>
      <AppShell><DashboardScreen />{settings ? <BillingSettings /> : null}</AppShell><CommandPalette />
    </ToastProvider></HouseholdProvider></ThemeProvider></QueryClientProvider>;
  const view = render(tree("tenant-a"));
  return { client, ...view, navigate: (id: string, currentRole = role) => view.rerender(tree(id, currentRole)),
    dispose: () => { view.unmount(); client.clear(); } };
}
async function settled(client: QueryClient) { await waitFor(() => expect(client.isFetching()).toBe(0)); }

it("serializes the mounted shell, all summary observers, billing observers and interactive search", async () => {
  const transport = wire(), view = setup(true);
  try {
    await settled(view.client);
    expect(transport.calls).toHaveLength(5);
    expect(transport.calls.filter(c => c.path.endsWith("/billing"))).toHaveLength(1);
    // Settings and shell subscribe to the identical billing key. Neither observer may
    // replace its query function with an unscheduled transport during a refetch.
    act(() => { void view.client.refetchQueries(); window.dispatchEvent(new CustomEvent("autobureau:open-command-palette")); });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "passport" } });
    await settled(view.client);
    expect(transport.calls).toHaveLength(11);
    expect(transport.calls.some(c => c.path.includes("q=passport"))).toBe(true);
    expect(transport.peak()).toBe(1);
    expect(transport.calls.every(c => c.household === "tenant-a" && c.method === "GET")).toBe(true);
  } finally { view.dispose(); }
});

it("exposes a background billing failure and allows one explicit scheduled retry while other panels remain", async () => {
  let failing = true;
  const transport = wire(c => c.path.endsWith("/billing") && failing
    ? response({ type: "https://example.test/unavailable", title: "Unavailable", status: 500 }, 500) : success(c));
  const view = setup();
  try {
    expect(await screen.findByText("Billing status unavailable")).toBeInTheDocument();
    await settled(view.client);
    expect(transport.calls.filter(c => c.path.endsWith("/billing"))).toHaveLength(1); // no automatic billing retry
    expect(screen.getByText("No saved obligations need action")).toBeInTheDocument();
    expect(screen.getByText("No saved deadlines in the next 45 days")).toBeInTheDocument();
    expect(screen.queryByText(/Premium is on|Premium stays on/)).not.toBeInTheDocument();
    failing = false;
    act(() => {
      void view.client.refetchQueries({ predicate: q => q.queryKey.at(-1) !== "billing" });
      fireEvent.click(screen.getByRole("button", { name: "Retry billing status" }));
      fireEvent.click(screen.getByRole("button", { name: /Retry billing status/ }));
    });
    await settled(view.client);
    expect(screen.queryByText("Billing status unavailable")).not.toBeInTheDocument();
    expect(transport.calls.filter(c => c.path.endsWith("/billing"))).toHaveLength(2);
    expect(transport.peak()).toBe(1);
  } finally { view.dispose(); }
});

it("cancels old-household queued work without releasing an unsettled billing transport", async () => {
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  const transport = wire(async c => { if (c.household === "tenant-a") await held; return success(c); });
  const view = setup();
  try {
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    // AppShell's billing banner is the first mounted query, held while the panels queue.
    expect(transport.calls[0]!.path).toMatch(/\/billing$/);
    view.navigate("tenant-b");
    expect(transport.calls[0]!.signal.aborted).toBe(true);
    expect(transport.calls).toHaveLength(1);
    await act(async () => { release(); });
    await settled(view.client);
    expect(transport.calls.filter(c => c.household === "tenant-a")).toHaveLength(1);
    expect(transport.calls.filter(c => c.household === "tenant-b")).toHaveLength(5);
    expect(view.client.getQueryData(["household", "tenant-a", "billing"])).toBeUndefined();
    expect(transport.peak()).toBe(1);
  } finally { release(); view.dispose(); }
});

it.each(["member", "viewer"] as const)("does not fetch billing for a %s", async role => {
  const transport = wire(), view = setup(false, role);
  try {
    await settled(view.client);
    expect(transport.calls).toHaveLength(4);
    expect(transport.calls.some(c => c.path.endsWith("/billing"))).toBe(false);
    expect(screen.queryByText("Billing status unavailable")).not.toBeInTheDocument();
  } finally { view.dispose(); }
});

it("hides cached owner billing details after a role change", async () => {
  const transport = wire(c => c.path.endsWith("/billing")
    ? response({ ...billing, state: "grace", tier: "premium", premiumUntil: "2026-10-31T00:00:00Z" }) : success(c));
  const view = setup();
  try {
    expect(await screen.findByText("Payment problem")).toBeInTheDocument();
    await settled(view.client);
    view.navigate("tenant-a", "member");
    expect(screen.queryByText("Payment problem")).not.toBeInTheDocument();
    expect(screen.queryByText(/Premium stays on/)).not.toBeInTheDocument();
    expect(transport.calls.filter(c => c.path.endsWith("/billing"))).toHaveLength(1);
  } finally { view.dispose(); }
});

it.each([401, 403, 500])("suppresses stale billing and actions when a refetch returns %i", async status => {
  let fail = false;
  const transport = wire(c => !c.path.endsWith("/billing") ? success(c) : fail
    ? response({ type: "https://example.test/refused", title: "Refused", status }, status)
    : response({ ...billing, state: "grace", tier: "premium", premiumUntil: "2026-10-31T00:00:00Z", subscribed: true, paymentUpdateAvailable: true }));
  const view = setup(true);
  try {
    await waitFor(() => expect(screen.getAllByText("Payment problem")).toHaveLength(2));
    await settled(view.client);
    fail = true;
    await act(async () => { await view.client.refetchQueries({ queryKey: ["household", "tenant-a", "billing"] }); });
    await waitFor(() => expect(screen.queryAllByText("Payment problem")).toHaveLength(0));
    expect(screen.queryByText(/Premium stays on/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update payment|cancel subscription/i })).not.toBeInTheDocument();
    if (status === 401) expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    else expect(screen.getByText("Billing status unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry billing status" }) !== null).toBe(status === 500);
    expect(transport.peak()).toBe(1);
  } finally { view.dispose(); }
});
