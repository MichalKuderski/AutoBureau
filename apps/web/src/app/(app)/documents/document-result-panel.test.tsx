import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { DocumentResultPanel, type DocumentResultView } from "./document-result-panel";

const doc = "5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c", resultId = "6a0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c";
const base: DocumentResultView = { documentId: doc, resultId, state: "action-required", resultPeriodStart: "2026-09-01T00:00:00.000Z",
  currentPeriodStart: "2026-10-01T00:00:00.000Z", chargedPeriodStart: null, capacity: { used: 3, limit: 10 }, canApply: true, canDiscard: true };
function serve(initial: DocumentResultView | number, action?: (kind: string) => Response) {
  let current = initial;
  const fetchMock = vi.fn(async (path: string) => {
    const kind = String(path).match(/\/result\/(apply|discard)$/)?.[1];
    if (kind && action) { const r = action(kind); if (r.ok) current = await r.clone().json() as DocumentResultView; return r; }
    return typeof current === "number"
      ? Response.json({ type: "about:blank", title: "Forbidden", status: current }, { status: current, headers: { "content-type": "application/problem+json" } })
      : Response.json(current);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("old-period result panel (PRD §21.3)", () => {
  it("explains the held reading and applies it this month only after explicit confirmation", async () => {
    const fetchMock = serve(base, () => Response.json({ ...base, state: "applied", chargedPeriodStart: base.currentPeriodStart, canApply: false, canDiscard: false }));
    renderScreen(<DocumentResultPanel documentId={doc} />);
    expect(await screen.findByText(/action required/i)).toBeInTheDocument();
    expect(screen.getByText(/read this document in september 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/uses 1 of your 10 documents for october 2026 \(3 used so far\)/i)).toBeInTheDocument();
    expect(screen.getByText(/we won't read it again/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /apply this month…/i }));
    expect(fetchMock.mock.calls.some(([p]) => String(p).endsWith("/apply"))).toBe(false);
    expect(screen.getByRole("group", { name: /confirm applying/i })).toHaveTextContent(/count as 1 of your 10 documents for october 2026/i);
    await userEvent.click(screen.getByRole("button", { name: /apply in october 2026/i }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/result\/apply$/), expect.objectContaining({ method: "POST", body: JSON.stringify({ resultId }) }));
    const done = await screen.findByText(/filed and counted in october 2026/i);
    await waitFor(() => expect(done).toHaveFocus());
  });
  it("without room this month offers only discard, and says the original is kept", async () => {
    serve({ ...base, state: "capacity-unavailable", canApply: false, capacity: { used: 10, limit: 10 } });
    renderScreen(<DocumentResultPanel documentId={doc} />);
    expect(await screen.findByText(/no room this month/i)).toBeInTheDocument();
    expect(screen.getByText(/not filed and not counted/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard reading…/i })).toBeInTheDocument();
  });
  it("discard is confirmed, cancel returns focus, and the result states the original is kept", async () => {
    serve(base, () => Response.json({ ...base, state: "discarded", canApply: false, canDiscard: false }));
    renderScreen(<DocumentResultPanel documentId={doc} />);
    await userEvent.click(await screen.findByRole("button", { name: /discard reading…/i }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /discard reading…/i })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: /discard reading…/i }));
    await userEvent.click(screen.getByRole("button", { name: /^discard reading$/i }));
    expect(await screen.findByText(/wasn't filed or counted, and your original document is still stored/i)).toBeInTheDocument();
  });
  it("shows the server's refusal and renders nothing for non-owners", async () => {
    serve(base, () => Response.json({ type: "about:blank", title: "Conflict", status: 409, detail: "There's no processing room left this month, so this reading stays held. Nothing was charged." }, { status: 409, headers: { "content-type": "application/problem+json" } }));
    const { unmount } = renderScreen(<DocumentResultPanel documentId={doc} />);
    await userEvent.click(await screen.findByRole("button", { name: /apply this month…/i }));
    await userEvent.click(screen.getByRole("button", { name: /apply in october 2026/i }));
    expect(await screen.findByText(/no processing room left this month/i)).toBeInTheDocument();
    unmount(); vi.unstubAllGlobals();
    serve(403);
    const { container } = renderScreen(<DocumentResultPanel documentId={doc} />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});
