import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { DocumentWorkPanel, type DocumentWork } from "./document-work-panel";

const id = "5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c";
function serve(initial: DocumentWork, cancel: () => Response) {
  let current = initial;
  const fetchMock = vi.fn(async (path: string) => {
    if (!String(path).endsWith("/cancel")) return Response.json(current);
    const r = cancel(); if (r.ok) current = await r.clone().json() as DocumentWork; return r;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("document processing panel", () => {
  it("stops unstarted work after confirmation and says the file is kept", async () => {
    const fetchMock = serve({ documentId: id, state: "waiting", cancellable: true, reviewAt: null },
      () => Response.json({ documentId: id, state: "stopped", cancellable: false, reviewAt: null }));
    renderScreen(<DocumentWorkPanel documentId={id} />);
    expect(await screen.findByText(/nothing has been counted/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop processing…/i }));
    expect(screen.getByRole("button", { name: /^stop processing$/i })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /^stop processing$/i }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/documents\/.+\/cancel$/), expect.objectContaining({ method: "POST", body: "{}" }));
    expect(await screen.findByText(/still stored with your household/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop processing/i })).not.toBeInTheDocument();
  });
  it("keeping it returns focus to the trigger without a request", async () => {
    const fetchMock = serve({ documentId: id, state: "waiting", cancellable: true, reviewAt: null }, () => Response.json({}));
    renderScreen(<DocumentWorkPanel documentId={id} />);
    await userEvent.click(await screen.findByRole("button", { name: /stop processing…/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep it/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /stop processing…/i })).toHaveFocus());
    expect(fetchMock.mock.calls.some(([p]) => String(p).endsWith("/cancel"))).toBe(false);
  });
  it("offers no stop control for started work and explains a lost race honestly", async () => {
    serve({ documentId: id, state: "working", cancellable: false, reviewAt: null }, () => Response.json({}));
    const { unmount } = renderScreen(<DocumentWorkPanel documentId={id} />);
    expect(await screen.findByText(/can't be stopped part-way/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop processing/i })).not.toBeInTheDocument();
    unmount(); vi.unstubAllGlobals();
    serve({ documentId: id, state: "waiting", cancellable: true, reviewAt: null },
      () => Response.json({ type: "about:blank", title: "Conflict", status: 409, detail: "Processing has already started, so it can't be stopped now." }, { status: 409, headers: { "content-type": "application/problem+json" } }));
    renderScreen(<DocumentWorkPanel documentId={id} />);
    await userEvent.click(await screen.findByRole("button", { name: /stop processing…/i }));
    await userEvent.click(screen.getByRole("button", { name: /^stop processing$/i }));
    expect(await screen.findByText(/already started, so it can't be stopped/i)).toBeInTheDocument();
  });
});
