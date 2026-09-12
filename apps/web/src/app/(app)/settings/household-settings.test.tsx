import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { HouseholdSettings } from "./household-settings";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./member-settings", () => ({ MemberSettings: () => <section><h2>People</h2></section> }));
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

describe("household settings and forwarding address", () => {
  it("persists the household name and refreshes its server context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ name: "Saved household" }));
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<HouseholdSettings />);
    expect(screen.getByRole("textbox", { name: "Household name" })).toBeInTheDocument();
    // Timezone belongs to the account profile, not the household record.
    expect(screen.queryByLabelText("Timezone")).not.toBeInTheDocument();

    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/v1\/households\//), expect.objectContaining({ method: "PATCH" }));
    expect(screen.getByRole("textbox", { name: "Household name" })).toHaveValue("Saved household");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not report success when persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderScreen(<HouseholdSettings />);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Couldn’t save your household")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not offer household edits to a viewer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<HouseholdSettings />, { household: { role: "viewer" } });
    expect(screen.getByRole("textbox", { name: "Household name" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies the assigned address only after clipboard success", async () => {
    const user = userEvent.setup();
    const copyText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderScreen(<HouseholdSettings />, { household: { emailAlias: "assigned@example.test" } });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith("assigned@example.test");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    copyText.mockRestore();
  });

  it("does not invent an address for a household without one", () => {
    renderScreen(<HouseholdSettings />, { household: { emailAlias: null } });
    expect(screen.getByText("No forwarding address yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("reports a failed clipboard operation without a success claim", async () => {
    const user = userEvent.setup();
    const copyText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));
    renderScreen(<HouseholdSettings />, { household: { emailAlias: "assigned@example.test" } });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Couldn’t copy the address")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    copyText.mockRestore();
  });

  it("still renders the People card and its members", () => {
    renderScreen(<HouseholdSettings />);
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
  });
});
