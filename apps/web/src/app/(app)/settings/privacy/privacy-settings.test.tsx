import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { PrivacySettings } from "./privacy-settings";

// Deletion is now a real workflow backed by /households/:id/deletion; every test gets a
// fresh "no request yet" status unless it installs its own responses.
let fetchMock: ReturnType<typeof vi.fn>;
let statusBody: unknown = { request: null, finalReceiptIssuable: false };
let exportBody: unknown = { available: false, latest: null };
beforeEach(() => {
  statusBody = { request: null, finalReceiptIssuable: false };
  exportBody = { available: false, latest: null };
  fetchMock = vi.fn(async (path: string, options: RequestInit = {}) =>
    String(path).includes("/exports") ? Response.json(exportBody)
      : options.method === "POST" ? Response.json(statusBody, { status: 202 }) : Response.json(statusBody));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/**
 * Blueprint P0-04.
 *
 * Export and deletion rendered perfectly and told the truth about nothing: a click
 * fired a toast claiming a job or a schedule had started, and neither had a backend
 * behind it. The question these assertions answer is not whether the controls throw —
 * they never did — but what a user could reasonably conclude from what's on screen
 * after pressing them. Test A and B prove neither claims a success that didn't happen;
 * Test C proves fixing that left the rest of the page alone; Test D proves the fake
 * async machinery is actually gone, not merely unreachable.
 */

describe("Test A · export cannot claim success", () => {
  it("renders the export control disabled with a truthful description where no storage is mounted", async () => {
    renderScreen(<PrivacySettings />);

    const button = screen.getByRole("button", { name: /request export/i });
    expect(button).toBeDisabled();
    expect(await screen.findByText("Not available yet.")).toBeInTheDocument();
  });

  it("prepares a real export where available and repeats only the archive's own completeness verdict", async () => {
    exportBody = { available: true, latest: null };
    renderScreen(<PrivacySettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: /request export/i })).toBeEnabled());
    exportBody = { available: true, latest: { requestId: "5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c", requestedAt: "2026-09-23T12:00:00Z", expiresAt: "2026-09-26T12:00:00Z", state: "ready", complete: false, bytes: 20480 } };
    fetchMock.mockImplementationOnce(async () => Response.json((exportBody as { latest: unknown }).latest));
    await userEvent.click(screen.getByRole("button", { name: /request export/i }));
    expect(await screen.findByText("Your export is ready, with gaps")).toBeInTheDocument();
    expect(screen.getByText(/manifest.json in the download lists each one/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download export/i })).toBeEnabled();
    expect(screen.queryByText(/everything we hold/i)).not.toBeInTheDocument();
  });

  it("produces no toast when activated", async () => {
    renderScreen(<PrivacySettings />);

    // The click a user would make; a disabled control fires no handler at all.
    await userEvent.click(screen.getByRole("button", { name: /request export/i }));

    expect(screen.queryByText(/export started/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we'll email you a download link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
  });

  it("does not claim an email was sent or a file was generated anywhere on the page", () => {
    renderScreen(<PrivacySettings />);

    expect(screen.queryByText(/we'll email you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export.*(started|ready|complete)/i)).not.toBeInTheDocument();
  });
});

describe("Test B · deletion is real, reversible for 14 days, and never claims erasure", () => {
  it("offers deletion behind a typed confirmation and sends nothing until the phrase matches", async () => {
    renderScreen(<PrivacySettings />);
    await userEvent.click(await screen.findByRole("button", { name: /delete household/i }));
    const dialog = screen.getByRole("dialog", { name: /delete this household/i });
    const confirm = within(dialog).getByRole("button", { name: /schedule deletion/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/type delete household to confirm/i), "delete household");
    expect(confirm).toBeDisabled();
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
  });

  it("schedules with the exact phrase and then shows the undo window, not a completion", async () => {
    renderScreen(<PrivacySettings />);
    await userEvent.click(await screen.findByRole("button", { name: /delete household/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/type delete household to confirm/i), "DELETE HOUSEHOLD");
    statusBody = { request: { id: "5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c", state: "grace", requestedAt: "2026-09-23T12:00:00Z", undoUntil: "2026-10-07T12:00:00Z", undoAvailable: true }, finalReceiptIssuable: false };
    await userEvent.click(within(dialog).getByRole("button", { name: /schedule deletion/i }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/deletion$/), expect.objectContaining({ method: "POST", body: JSON.stringify({ confirmation: "DELETE HOUSEHOLD" }) }));
    expect(await screen.findByText("Deletion scheduled")).toBeInTheDocument();
    expect(screen.getByText(/nothing has been erased yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo deletion/i })).toBeEnabled();
    expect(screen.queryByText(/permanently deleted|deletion complete|receipt/i)).not.toBeInTheDocument();
  });

  it("asks for step-up authentication instead of pretending success when the server refuses", async () => {
    fetchMock.mockImplementation(async (_p: string, o: RequestInit = {}) => o.method === "POST"
      ? Response.json({ type: "https://autobureau.com/problems/forbidden", title: "Forbidden", status: 403, detail: "Verify your account security to continue." }, { status: 403 })
      : Response.json(statusBody));
    renderScreen(<PrivacySettings />);
    await userEvent.click(await screen.findByRole("button", { name: /delete household/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/type delete household to confirm/i), "DELETE HOUSEHOLD");
    await userEvent.click(within(dialog).getByRole("button", { name: /schedule deletion/i }));
    expect(await within(dialog).findByText(/sign in again/i)).toBeInTheDocument();
    expect(screen.queryByText("Deletion scheduled")).not.toBeInTheDocument();
  });

  it("describes a started deletion without claiming verified completion", async () => {
    statusBody = { request: { id: "5f0a6c1e-9e2b-4b7a-8c1d-2b1e3f4a5b6c", state: "fenced", requestedAt: "2026-09-01T12:00:00Z", undoUntil: "2026-09-15T12:00:00Z", undoAvailable: false }, finalReceiptIssuable: false };
    renderScreen(<PrivacySettings />);
    expect(await screen.findByText("Deletion in progress")).toBeInTheDocument();
    expect(screen.getByText(/can't give you that confirmation yet/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /undo deletion/i })).not.toBeInTheDocument());
  });
});

describe("Test C · unrelated privacy content remains intact", () => {
  it("still renders the what-we-can-and-can't-see list", () => {
    renderScreen(<PrivacySettings />);

    expect(screen.getByRole("heading", { name: "What we can and can't see" })).toBeInTheDocument();
    expect(screen.getByText(/dates, amounts, and who they belong to/i)).toBeInTheDocument();
    expect(screen.getByText(/can't decrypt them/i)).toBeInTheDocument();
    expect(screen.getByText(/sold, shared, or used to train/i)).toBeInTheDocument();
  });

  it("still renders both card headings and their descriptions", () => {
    renderScreen(<PrivacySettings />);

    expect(screen.getByRole("heading", { name: "Export everything" })).toBeInTheDocument();
    expect(screen.getByText(/original documents plus every record/i)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Delete your household" })).toBeInTheDocument();
    expect(screen.getByText(/documents, registry, reminders, and history/i)).toBeInTheDocument();
  });
});

describe("Test D · export still cannot claim success", () => {
  it("keeps the export control disabled with no pending state", async () => {
    renderScreen(<PrivacySettings />);
    const exportButton = screen.getByRole("button", { name: /request export/i });
    expect(exportButton).toBeDisabled();
    expect(exportButton).not.toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: /delete household/i })).toBeEnabled());
  });
});

/**
 * Blueprint P0-10.
 *
 * The identity-number bullet said passport and account numbers "are encrypted" and
 * that Pellum's own systems "cannot decrypt them" — present tense, for a control
 * with no code behind it anywhere in the repository. ADR-007 is the real design; its
 * own status line says "Accepted; not yet implemented." Test A proves the false
 * present-tense claim is gone. Test B proves the replacement states a commitment
 * without claiming it already runs. Test C proves the surrounding page — export,
 * deletion, the rest of the list — is untouched.
 */

describe("P0-10 Test A · no present-tense encryption claim", () => {
  it("does not claim identity numbers are currently encrypted", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.queryByText(/numbers are encrypted/i)).not.toBeInTheDocument();
  });

  it("does not claim Pellum's systems already cannot decrypt them", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.queryByText(/cannot decrypt them/i)).not.toBeInTheDocument();
  });
});

describe("P0-10 Test B · the replacement is accurate commitment tense", () => {
  it("states encryption as a plan, not a running control", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/the plan is to encrypt passport and account numbers/i)).toBeInTheDocument();
  });

  it("says plainly that the protection isn't built yet", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/isn't built yet/i)).toBeInTheDocument();
  });

  it("invents no timeline, and doesn't claim the work is already underway", () => {
    renderScreen(<PrivacySettings />);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/coming soon|next release|within \d+ days|we're currently encrypting|already protected/i);
  });
});

describe("P0-10 Test C · the rest of the privacy page is untouched", () => {
  it("still states what Pellum currently reads and builds", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/documents you send us, so we can find dates/i)).toBeInTheDocument();
    expect(screen.getByText(/the registry we build from them/i)).toBeInTheDocument();
  });

  it("still states the email-inbox and no-training-data limits", () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByText(/your email inbox, unless you connect it/i)).toBeInTheDocument();
    expect(screen.getByText(/sold, shared, or used to train/i)).toBeInTheDocument();
  });

  it("still renders five items in the can/can't list", () => {
    const { container } = renderScreen(<PrivacySettings />);
    expect(screen.getByRole("heading", { name: "What we can and can't see" })).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });

  it("keeps export honestly disabled and deletion behind its own confirmation flow", async () => {
    renderScreen(<PrivacySettings />);
    expect(screen.getByRole("button", { name: /request export/i })).toBeDisabled();
    expect(await screen.findByText("Not available yet.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /delete household/i })).toBeEnabled());
  });
});
