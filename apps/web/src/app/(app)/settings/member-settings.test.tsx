import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { MemberSettings } from "./member-settings";
import type { MemberView } from "@autobureau/contracts";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const person: MemberView = { id: "11111111-1111-4111-8111-111111111111", household_id: "22222222-2222-4222-8222-222222222222", user_id: null,
  display_name: "Parent", kind: "dependent", date_of_birth: null, archived_at: null };
let records: MemberView[];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  records = [{ ...person }];
  fetchMock = vi.fn(async (path: string, options: RequestInit) => {
    if (options.method === "GET") return Response.json({ data: records.filter((p) => Boolean(p.archived_at) === path.includes("archived=true")), next_cursor: null });
    if (options.method === "DELETE") { records = records.map((p) => ({ ...p, archived_at: new Date().toISOString() })); return new Response(null, { status: 204 }); }
    if (path.endsWith("/restore")) { records = records.map((p) => ({ ...p, archived_at: null })); return Response.json(records[0]); }
    const body = JSON.parse(String(options.body));
    const saved = { ...person, ...body, id: options.method === "POST" ? "33333333-3333-4333-8333-333333333333" : person.id };
    records = options.method === "POST" ? [...records, saved] : [saved];
    return Response.json(saved, { status: options.method === "POST" ? 201 : 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
describe("people management UI", () => {
  it("creates a person through the API and displays the persisted result", async () => {
    const user = userEvent.setup();
    renderScreen(<MemberSettings />);
    await user.click(screen.getByRole("button", { name: "Add someone" }));
    const modal = screen.getByRole("dialog");
    await user.type(within(modal).getByRole("textbox", { name: "Name" }), "Alex");
    await user.click(within(modal).getByRole("button", { name: "Add person" }));
    expect(await screen.findByText("Person added")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Edit Alex" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/members$/), expect.objectContaining({ method: "POST", body: expect.stringContaining('"display_name":"Alex"') }));
  });
  it("requires archive confirmation, preserves cancellation, and supports restore", async () => {
    const user = userEvent.setup();
    renderScreen(<MemberSettings />);
    await user.click(await screen.findByRole("button", { name: "Archive Parent" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("does not delete records or cancel deadlines");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, options]) => options.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Archive Parent" }));
    await user.click(screen.getByRole("button", { name: "Archive person" }));
    expect(await screen.findByText("Person archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show archived people" }));
    await user.click(await screen.findByRole("button", { name: "Restore Parent" }));
    expect(await screen.findByText("Person restored")).toBeInTheDocument();
  });
  it("shows capacity failures without losing the form or claiming success", async () => {
    const user = userEvent.setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path, options) => options.method === "POST" ? Promise.resolve(Response.json({ type: "https://autobureau.com/problems/cap-exceeded", title: "Plan limit", detail: "Your plan is full.", status: 402 }, { status: 402 })) : original(path, options));
    renderScreen(<MemberSettings />);
    await user.click(screen.getByRole("button", { name: "Add someone" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Alex");
    await user.click(screen.getByRole("button", { name: "Add person" }));
    expect(await screen.findByText("Your plan is full.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Alex");
    expect(screen.queryByText("Person added")).not.toBeInTheDocument();
  });
  it("allows a viewer to read but does not offer management controls", async () => {
    renderScreen(<MemberSettings />, { household: { role: "viewer" } });
    expect(await screen.findByText("Parent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add someone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Parent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Parent" })).not.toBeInTheDocument();
  });
});
