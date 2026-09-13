import { afterEach, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { ObligationsScreen } from "./obligations-screen";
afterEach(() => vi.unstubAllGlobals());
const empty = () => new Response(JSON.stringify({ data: [], next_cursor: null }), { headers: { "content-type": "application/json" } });
it("cancels deadline creation without a write and returns keyboard focus to its trigger", async () => {
  const fetcher = vi.fn().mockImplementation(empty); vi.stubGlobal("fetch", fetcher);
  renderScreen(<ObligationsScreen />);
  const trigger = screen.getByRole("button", { name: "Add deadline" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Add deadline" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every((call) => !call[1]?.method || call[1].method === "GET")).toBe(true);
});
it("does not offer deadline creation to a viewer", () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(empty));
  renderScreen(<ObligationsScreen />, { household: { role: "viewer" } });
  expect(screen.queryByRole("button", { name: "Add deadline" })).not.toBeInTheDocument();
});
