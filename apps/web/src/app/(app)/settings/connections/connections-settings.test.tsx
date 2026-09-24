import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { ConnectionsSettings } from "./connections-settings";

const connection = { id: "5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c", state: "login-required", statusChangedAt: "2026-09-23T12:00:00Z", lastOutcome: "login-required",
  refreshRequested: false, historyAfterRemoval: "delete", accounts: [{ id: "6a0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c", name: "PUBLIC Checking", kind: "depository", currentCents: 12345, availableCents: 12000 }] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (path: string, options: RequestInit = {}) => {
    if (String(path).endsWith("/unlink")) { const body = JSON.parse(String(options.body)); return Response.json({ linkAvailable: false, connections: [{ ...connection, state: "unlinking", historyAfterRemoval: body.history }] }); }
    return Response.json({ linkAvailable: false, connections: [connection] });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("connected accounts", () => {
  it("explains read-only consent and keeps linking honestly unavailable", async () => {
    renderScreen(<ConnectionsSettings />);
    expect(screen.getByText(/pellum can never move money/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect an account/i })).toBeDisabled();
    expect(await screen.findByText("PUBLIC Checking")).toBeInTheDocument();
    expect(screen.getByText(/needs you to sign in again/i)).toBeInTheDocument();
  });
  it("disconnect defaults to deleting imported history and says so", async () => {
    renderScreen(<ConnectionsSettings />);
    await userEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    const dialog = screen.getByRole("dialog", { name: /disconnect this account/i });
    expect(within(dialog).getByRole("radio", { name: /delete it/i })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: /^disconnect$/i }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/unlink$/), expect.objectContaining({ method: "POST", body: JSON.stringify({ history: "delete" }) }));
    expect(await screen.findByText(/imported history will be deleted once the provider confirms/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("keeps history when the owner chooses to", async () => {
    renderScreen(<ConnectionsSettings />);
    await userEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /keep it/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^disconnect$/i }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/unlink$/), expect.objectContaining({ body: JSON.stringify({ history: "retain" }) }));
    expect(await screen.findByText(/imported history will be kept/i)).toBeInTheDocument();
  });
  it("asks for step-up authentication when the server refuses", async () => {
    fetchMock.mockImplementation(async (path: string) => String(path).endsWith("/unlink")
      ? Response.json({ type: "https://autobureau.com/problems/forbidden", title: "Forbidden", status: 403 }, { status: 403 })
      : Response.json({ linkAvailable: false, connections: [connection] }));
    renderScreen(<ConnectionsSettings />);
    await userEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^disconnect$/i }));
    expect(await within(screen.getByRole("dialog")).findByText(/sign in again/i)).toBeInTheDocument();
  });
});
