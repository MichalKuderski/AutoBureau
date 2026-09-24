import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/render";
import { ReminderStatus } from "./reminder-status";

afterEach(() => vi.unstubAllGlobals());
describe("reminder and delivery status", () => {
  it("says plainly that nothing will be sent while delivery is inactive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ deliveryActive: false, reminders: [] })));
    renderScreen(<ReminderStatus obligationId="5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c" />);
    expect(await screen.findByText(/no reminder will be sent for this deadline/i)).toBeInTheDocument();
    expect(screen.getByText(/no reminders are planned/i)).toBeInTheDocument();
  });
  it("a planned reminder is 'not sent'; 'sent' needs a recorded send time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ deliveryActive: false, reminders: [
      { remindAt: "2026-10-01T09:00:00.000Z", offsetLabel: "7 days before", status: "scheduled", sentAt: null },
      { remindAt: "2026-10-07T09:00:00.000Z", offsetLabel: "1 day before", status: "sent", sentAt: null },
    ] })));
    renderScreen(<ReminderStatus obligationId="5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c" />);
    expect(await screen.findByText(/7 days before: planned for .*, not sent/i)).toBeInTheDocument();
    expect(screen.getByText(/1 day before: planned for .*, not sent/i)).toBeInTheDocument();
    expect(screen.queryByText(/sent oct/i)).not.toBeInTheDocument();
  });
});
