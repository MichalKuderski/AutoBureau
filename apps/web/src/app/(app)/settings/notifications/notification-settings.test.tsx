import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultNotificationPreferences, defaultNotificationSchedule } from "@autobureau/contracts";
import { renderScreen } from "@/test/render";
import { NotificationSettings } from "./notification-settings";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/settings/notifications" }));
let saved: ReturnType<typeof initial>, fail = false;
const initial = () => ({ preferences: defaultNotificationPreferences(), schedule: defaultNotificationSchedule(), timezone: "America/Denver" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => {
  saved = initial(); fail = false;
  transport = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      if (fail) return json({ type: "https://autobureau.com/problems/unavailable", title: "Unavailable", status: 503, detail: "Try again." }, 503);
      saved = { ...saved, ...JSON.parse(String(init.body)) };
    }
    return json(saved);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => vi.unstubAllGlobals());
describe("persistent notification settings", () => {
  it("loads specified defaults, locks security and never opts into urgent overrides", async () => {
    renderScreen(<NotificationSettings />);
    expect(await screen.findByRole("checkbox", { name: "Deadline reminders via Email" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Documents needing a look via Email" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Documents needing a look via Push" })).toBeChecked();
    for (const channel of ["Email", "Push", "In app"]) {
      const control = screen.getByRole("checkbox", { name: `Security notices via ${channel}` });
      expect(control).toBeChecked(); expect(control).toBeDisabled();
    }
    expect(screen.getByRole("switch", { name: "Let urgent deadlines through" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Until", { exact: false })).toHaveValue("08:00");
    expect(screen.getByText(/not active yet/)).toBeInTheDocument();
  });
  it("saves changed matrix and schedule and reloads the persisted values", async () => {
    const user = userEvent.setup(); const first = renderScreen(<NotificationSettings />);
    await user.click(await screen.findByRole("checkbox", { name: "Deadline reminders via Email" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "2");
    await user.click(screen.getByRole("switch", { name: "Let urgent deadlines through" }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByText("Preferences saved");
    expect(saved.schedule).toMatchObject({ digest_day: 2, urgent_override: true });
    expect(saved.preferences.find((row) => row.kind === "obligation.due_soon" && row.channel === "email")?.enabled).toBe(false);
    first.unmount(); renderScreen(<NotificationSettings />);
    expect(await screen.findByRole("checkbox", { name: "Deadline reminders via Email" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("2");
  });
  it("retains failed edits and only shows success after a successful retry", async () => {
    const user = userEvent.setup(); renderScreen(<NotificationSettings />);
    await user.click(await screen.findByRole("checkbox", { name: "Deadline reminders via Email" })); fail = true;
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByText("Couldn’t save preferences");
    expect(screen.queryByText("Preferences saved")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Deadline reminders via Email" })).not.toBeChecked(); fail = false;
    await user.click(screen.getByRole("button", { name: "Save preferences" })); await screen.findByText("Preferences saved");
  });
  it("disables owner-only mutations for a viewer", async () => {
    renderScreen(<NotificationSettings />, { household: { role: "viewer" } });
    await screen.findByText("Owner access required");
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Deadline reminders via Email" })).toBeDisabled();
  });
  it("shows read failures without inventing defaults or offering a save", async () => {
    transport.mockResolvedValue(json({ type: "https://autobureau.com/problems/unavailable", title: "Unavailable", status: 503 }, 503));
    renderScreen(<NotificationSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument();
  });
});
