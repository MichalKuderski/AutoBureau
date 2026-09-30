import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HouseholdProvider } from "@/providers/household-provider";
import { HOUSEHOLD, VIEWER, DOCUMENTS } from "@/lib/domain/fixtures";
import { DocumentResultPanel, type DocumentResultView } from "./document-result-panel";
import { DocumentWorkPanel } from "./document-work-panel";
import { SourceDocumentDrawer } from "../obligations/[id]/obligation-detail-screen";
import { ToastProvider } from "@/components/ui/toast";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/documents" }));

const doc = "document-a", resultId = "result-a";
const base: DocumentResultView = { documentId: doc, resultId, state: "action-required", resultPeriodStart: "2026-09-01T00:00:00Z",
  currentPeriodStart: "2026-10-01T00:00:00Z", chargedPeriodStart: null, capacity: { used: 3, limit: 10 }, canApply: true, canDiscard: true };
const done = { ...base, state: "applied", chargedPeriodStart: base.currentPeriodStart, canApply: false, canDiscard: false };
const problem = (status: number) => Response.json({ type: "about:blank", title: "Unavailable", status }, { status });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(children: ReactNode, household = HOUSEHOLD.id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } });
  const tree = (node: ReactNode, id = household) => <QueryClientProvider client={client}>
    <HouseholdProvider household={{ ...HOUSEHOLD, id }} viewer={VIEWER}><ToastProvider>{node}</ToastProvider></HouseholdProvider>
  </QueryClientProvider>;
  return { client, tree, ...render(tree(children)) };
}
async function applyReading() {
  fireEvent.click(await screen.findByRole("button", { name: "Apply this month…" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply in October 2026" }));
}
afterEach(() => vi.unstubAllGlobals());

for (const [label, Panel] of [["reading", DocumentResultPanel], ["processing", DocumentWorkPanel]] as const) {
  describe(`${label} failures`, () => {
    it.each([401, 403, 404, 429, 503, "network"] as const)("handles %s without presenting stale protected content", async status => {
      vi.stubGlobal("fetch", vi.fn(async () => { if (status === "network") throw new TypeError("offline"); return problem(status); }));
      const { client } = setup(<Panel documentId={doc} />);
      const kind = label === "reading" ? "result" : "work";
      await waitFor(() => expect(client.getQueryState(["household", HOUSEHOLD.id, `document-${kind}`, doc])?.status).toBe("error"));
      if (status === 403 || status === 404) expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      else if (status === 401) expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
      else expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /apply this month|stop processing/ })).not.toBeInTheDocument();
    });
  });
}

it("announces loading and restores focus after a transient retry", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(Response.json(base)));
  setup(<DocumentResultPanel documentId={doc} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading reading status");
  await act(async () => pending.resolve(problem(503)));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Apply this month…" });
  await waitFor(() => expect(document.activeElement).toContainElement(screen.getByRole("region", { name: "Reading" })));
});

it.each([401, 403, 404])("removes cached result data after background %s", async status => {
  let denied = false;
  vi.stubGlobal("fetch", vi.fn(async () => denied ? problem(status) : Response.json(base)));
  const { client } = setup(<DocumentResultPanel documentId={doc} />);
  await screen.findByRole("button", { name: "Apply this month…" });
  denied = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["household", HOUSEHOLD.id] }); });
  expect(client.getQueryData(["household", HOUSEHOLD.id, "document-result", doc])).toBeNull();
  await waitFor(() => expect(screen.queryByText(/read this document in September/)).not.toBeInTheDocument());
});

it("reconciles a committed write with a lost response without replaying it", async () => {
  let committed = false, posts = 0;
  vi.stubGlobal("fetch", vi.fn(async (_path, options) => {
    if (options.method === "POST") { committed = true; posts++; throw new TypeError("response lost"); }
    return Response.json(committed ? done : base);
  }));
  const { client } = setup(<DocumentResultPanel documentId={doc} />);
  const roots = ["documents", "document", "document-quota", "summary", "obligations", "obligation", "items", "item", "timeline"];
  for (const root of roots) { client.setQueryData([root, HOUSEHOLD.id, "probe"], {}); client.setQueryData([root, "other", "probe"], {}); }
  await applyReading();
  expect(await screen.findByText(/Filed and counted in October/)).toBeInTheDocument();
  await waitFor(() => expect(client.getQueryState(["summary", HOUSEHOLD.id, "probe"])?.isInvalidated).toBe(true));
  expect(posts).toBe(1);
  expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
  for (const root of roots) {
    expect(client.getQueryState([root, HOUSEHOLD.id, "probe"])?.isInvalidated).toBe(true);
    expect(client.getQueryState([root, "other", "probe"])?.isInvalidated).toBe(false);
  }
});

it("blocks double clicks and conflicting decisions, retaining the exact key and payload on manual retry", async () => {
  const response = deferred<Response>();
  const posts: RequestInit[] = [];
  let committed = false;
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => {
    if (options.method === "POST") { posts.push(options); if (posts.length === 1) return response.promise; committed = true; return Response.json(done); }
    return Response.json(committed ? done : base);
  }));
  setup(<DocumentResultPanel documentId={doc} />);
  fireEvent.click(await screen.findByRole("button", { name: "Apply this month…" }));
  const button = screen.getByRole("button", { name: "Apply in October 2026" });
  fireEvent.click(button); fireEvent.click(button);
  expect(posts).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Discard reading…" })).not.toBeInTheDocument();
  await act(async () => response.resolve(problem(503)));
  fireEvent.click(await screen.findByRole("button", { name: "Retry same action" }));
  await screen.findByText(/Filed and counted/);
  expect(posts).toHaveLength(2);
  expect(posts[1]?.body).toBe(posts[0]?.body);
  expect((posts[1]?.headers as Record<string, string>)["Idempotency-Key"]).toBe((posts[0]?.headers as Record<string, string>)["Idempotency-Key"]);
});

it("fences late responses and uses a new key for a new household/document intent", async () => {
  const response = deferred<Response>();
  const posts: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => {
    if (options.method === "POST") { posts.push(options); return posts.length === 1 ? response.promise : problem(503); }
    return Response.json(base);
  }));
  const view = setup(<DocumentResultPanel documentId={doc} />);
  await applyReading();
  view.rerender(view.tree(<DocumentResultPanel documentId="document-b" />, "household-b"));
  await applyReading();
  await act(async () => response.resolve(Response.json(done)));
  expect(screen.queryByText(/Filed and counted/)).not.toBeInTheDocument();
  expect((posts[0]?.signal as AbortSignal).aborted).toBe(true);
  expect((posts[1]?.headers as Record<string, string>)["Idempotency-Key"]).not.toBe((posts[0]?.headers as Record<string, string>)["Idempotency-Key"]);
  expect((posts[1]?.headers as Record<string, string>)["X-Household-Id"]).toBe("household-b");
});

it("retains an uncertain intent across unmount and remount", async () => {
  const response = deferred<Response>(); const posts: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => {
    if (options.method === "POST") { posts.push(options); return posts.length === 1 ? response.promise : problem(503); }
    return Response.json(base);
  }));
  const view = setup(<DocumentResultPanel documentId={doc} />);
  await applyReading(); view.rerender(view.tree(null));
  await act(async () => response.resolve(Response.json(done)));
  view.rerender(view.tree(<DocumentResultPanel documentId={doc} />));
  fireEvent.click(await screen.findByRole("button", { name: "Retry same action" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]?.headers).toEqual(posts[0]?.headers);
});

it.each([401, 403, 404, 429, 503, "network"] as const)("source drawer distinguishes %s from missing data and clears protected stale titles", async status => {
  let fail = false;
  const document = DOCUMENTS[0]!;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (!fail) return Response.json(document);
    if (status === "network") throw new TypeError("offline");
    return problem(status);
  }));
  const { client } = setup(<SourceDocumentDrawer documentId={document.id} open onClose={() => {}} />);
  await screen.findByRole("heading", { name: document.title! });
  fail = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["document", HOUSEHOLD.id, document.id] }); });
  await waitFor(() => expect(screen.queryByRole("heading", { name: document.title! })).not.toBeInTheDocument());
  if (status === 403 || status === 404) expect(screen.getByText("That document is unavailable.")).toBeInTheDocument();
  else if (status === 401) expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  else expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  if (typeof status === "number" && [401, 403, 404].includes(status)) expect(client.getQueryData(["document", HOUSEHOLD.id, document.id])).toBeNull();
});

it("allows a new discard intent after an authoritative capacity refusal and fresh read", async () => {
  let refused = false, discarded = false;
  const posts: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options: RequestInit) => {
    if (options.method === "POST") {
      posts.push(options);
      if (path.endsWith("/apply")) {
        refused = true;
        return Response.json({ type: "about:blank", title: "Conflict", status: 409,
          detail: "There's no processing room left this month, so this reading stays held. Nothing was charged." }, { status: 409 });
      }
      discarded = true; return Response.json({ ...base, state: "discarded", canApply: false, canDiscard: false });
    }
    return Response.json(discarded ? { ...base, state: "discarded", canApply: false, canDiscard: false }
      : refused ? { ...base, state: "capacity-unavailable", canApply: false } : base);
  }));
  setup(<DocumentResultPanel documentId={doc} />);
  await applyReading();
  fireEvent.click(await screen.findByRole("button", { name: "Discard reading…" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard reading" }));
  await screen.findByText(/You discarded this reading/);
  expect((posts[1]?.headers as Record<string, string>)["Idempotency-Key"]).not.toBe((posts[0]?.headers as Record<string, string>)["Idempotency-Key"]);
});

it("keeps an idempotency-in-flight 409 fenced", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => options.method === "POST"
    ? Response.json({ type: "about:blank", title: "Conflict", status: 409, detail: "An identical request is still being processed. Retry shortly." }, { status: 409 })
    : Response.json(base)));
  setup(<DocumentResultPanel documentId={doc} />);
  await applyReading();
  await screen.findByRole("button", { name: "Retry same action" });
  expect(screen.queryByRole("button", { name: "Discard reading…" })).not.toBeInTheDocument();
});

it("hides and removes a fresh owner cache when the role changes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(base)));
  const view = setup(<DocumentResultPanel documentId={doc} />);
  view.client.setDefaultOptions({ queries: { staleTime: 30_000, retry: false } });
  await screen.findByRole("button", { name: "Apply this month…" });
  view.rerender(<QueryClientProvider client={view.client}><HouseholdProvider household={{ ...HOUSEHOLD, role: "member" }} viewer={VIEWER}>
    <DocumentResultPanel documentId={doc} />
  </HouseholdProvider></QueryClientProvider>);
  expect(screen.queryByText(/read this document in September/)).not.toBeInTheDocument();
  expect(view.client.getQueryData(["household", HOUSEHOLD.id, "document-result", doc])).toBeUndefined();
});

it.each([401, 403, 404])("conceals protected data after mutation denial %s", async status => {
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => options.method === "POST" ? problem(status) : Response.json(base)));
  const { client } = setup(<DocumentResultPanel documentId={doc} />);
  await applyReading();
  await waitFor(() => expect(screen.queryByText(/read this document in September/)).not.toBeInTheDocument());
  // A denial must not trigger a background GET that restores a protected cache.
  expect(client.getQueryData(["household", HOUSEHOLD.id, "document-result", doc])).toBeNull();
});

it("serializes result/work controls and reconciles cancellation response loss", async () => {
  const response = deferred<Response>(); let stopped = false; let posts = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, options: RequestInit) => {
    if (options.method === "POST") { posts++; stopped = true; return response.promise; }
    return Response.json(path.endsWith("/work") ? { documentId: doc, state: stopped ? "stopped" : "waiting", cancellable: !stopped, reviewAt: null } : base);
  }));
  setup(<><DocumentResultPanel documentId={doc} /><DocumentWorkPanel documentId={doc} /></>);
  fireEvent.click(await screen.findByRole("button", { name: "Stop processing…" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop processing" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Apply this month…" })).not.toBeInTheDocument());
  await act(async () => response.resolve(problem(503)));
  const status = await screen.findByText(/Processing was stopped/);
  await waitFor(() => expect(status).toHaveFocus());
  expect(posts).toBe(1);
});

it("does not describe an in-flight cancellation request as started provider work", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => options.method === "POST"
    ? Response.json({ type: "about:blank", title: "Conflict", status: 409, detail: "An identical request is still being processed. Retry shortly." }, { status: 409 })
    : Response.json({ documentId: doc, state: "waiting", cancellable: true, reviewAt: null })));
  setup(<DocumentWorkPanel documentId={doc} />);
  fireEvent.click(await screen.findByRole("button", { name: "Stop processing…" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop processing" }));
  await screen.findByRole("button", { name: "Retry same action" });
  expect(screen.getByText(/An identical request is still being processed/)).toBeInTheDocument();
  expect(screen.queryByText(/already started/)).not.toBeInTheDocument();
});

it("requires a fresh confirmation for a changed result payload", async () => {
  let current = base; const posts: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path, options: RequestInit) => {
    if (options.method === "POST") { posts.push(options); return problem(503); }
    return Response.json(current);
  }));
  const { client } = setup(<DocumentResultPanel documentId={doc} />);
  fireEvent.click(await screen.findByRole("button", { name: "Apply this month…" }));
  current = { ...base, resultId: "result-b" };
  await act(async () => { await client.invalidateQueries({ queryKey: ["household", HOUSEHOLD.id] }); });
  await waitFor(() => expect(client.getQueryData(["household", HOUSEHOLD.id, "document-result", doc])).toEqual(current));
  fireEvent.click(screen.getByRole("button", { name: "Apply in October 2026" }));
  expect(posts).toHaveLength(0);
  await applyReading();
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]?.body).toBe(JSON.stringify({ resultId: "result-b" }));
});

it("source retry returns focus inside the drawer and keeps filing disabled", async () => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async () => failed ? problem(503) : Response.json(DOCUMENTS[0])));
  setup(<SourceDocumentDrawer open documentId={DOCUMENTS[0]!.id} onClose={() => {}} />);
  const retry = await screen.findByRole("button", { name: "Try again" });
  failed = false; fireEvent.click(retry);
  await screen.findByRole("heading", { name: DOCUMENTS[0]!.title! });
  await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement));
  expect(screen.getByRole("button", { name: "Looks right — file it" })).toBeDisabled();
});
