import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { ObligationForm } from "./obligation-form";
import { OBLIGATIONS } from "@/lib/domain/fixtures";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());
function setup(post = vi.fn().mockResolvedValue(json({ id: "saved", title: "Confirmed renewal" }, 201))) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? post(init) : json({ data: [], next_cursor: null }));
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn(), close = vi.fn();
  renderScreen(<ObligationForm onClose={close} onSaved={saved} />, { household: { timezone: "America/Denver", members: [] } });
  return { post, saved, close };
}
async function fill(date: string, time: string) {
  await userEvent.type(screen.getByLabelText(/Deadline title/), "Confirmed renewal");
  fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: date } });
  fireEvent.change(screen.getByLabelText(/Due time/), { target: { value: time } });
}
describe("manual deadline form", () => {
  it("retains a failed save and retries the same exact instant and idempotency key", async () => {
    const post = vi.fn().mockResolvedValueOnce(json({ status: 503, title: "Service unavailable" }, 503)).mockResolvedValueOnce(json({ id: "saved" }, 201));
    const { saved, close } = setup(post);
    await fill("2026-09-20", "17:00");
    await userEvent.type(screen.getByLabelText("Amount in USD (optional)"), "125.50");
    await userEvent.click(screen.getByRole("button", { name: "Save deadline" }));
    expect(await screen.findByText("Couldn’t save this deadline")).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Due date/)).toHaveValue("2026-09-20");
    await userEvent.click(screen.getByRole("button", { name: "Save deadline" }));
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith({ id: "saved" }));
    expect(post.mock.calls[0]![0].headers["Idempotency-Key"]).toBe(post.mock.calls[1]![0].headers["Idempotency-Key"]);
    expect(JSON.parse(post.mock.calls[0]![0].body)).toMatchObject({ due_at: "2026-09-20T23:00:00Z", amount_cents: 12550 });
  });
  it("refuses a nonexistent spring clock without sending it", async () => {
    const { post } = setup(); await fill("2026-03-08", "02:30");
    await userEvent.click(screen.getByRole("button", { name: "Save deadline" }));
    expect(await screen.findByText(/date and time do not exist/)).toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
  });
  it("requires an explicit occurrence for the repeated fall clock", async () => {
    const { post } = setup(); await fill("2026-11-01", "01:30");
    await userEvent.click(screen.getByRole("button", { name: "Save deadline" }));
    expect(await screen.findByText(/clock time happens twice/)).toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("Which occurrence?"), "2026-11-01T08:30:00Z");
    await userEvent.click(screen.getByRole("button", { name: "Save deadline" }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(JSON.parse(post.mock.calls[0]![0].body).due_at).toBe("2026-11-01T08:30:00Z");
  });
  it("preserves the exact saved instant and currency when editing other fields", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH" ? json({ id: "saved" }) : json({ data: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetcher);
    const saved = vi.fn();
    renderScreen(<ObligationForm onClose={vi.fn()} onSaved={saved} obligation={{ ...OBLIGATIONS[0]!, id: "00000000-0000-4000-8000-000000000001",
      item_id: null, member_id: null, due_at: "2026-11-01T08:30:00.123Z", amount_cents: 12550, currency: "EUR" }} />, { household: { timezone: "America/Denver", members: [] } });
    expect(screen.getByLabelText("Which occurrence?")).toHaveValue("2026-11-01T08:30:00Z");
    await userEvent.clear(screen.getByLabelText(/Deadline title/)); await userEvent.type(screen.getByLabelText(/Deadline title/), "Edited title");
    await userEvent.click(screen.getByRole("button", { name: "Save deadline" }));
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const call = fetcher.mock.calls.find((entry) => entry[1]?.method === "PATCH")!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ due_at: "2026-11-01T08:30:00.123Z", currency: "EUR", amount_cents: 12550, title: "Edited title" });
  });
});
