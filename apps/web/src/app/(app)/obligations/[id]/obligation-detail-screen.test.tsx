import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { OBLIGATIONS } from "@/lib/domain/fixtures";
import { ObligationDetailScreen } from "./obligation-detail-screen";

/**
 * The detail screen carries two promises the rest of the product rests on: that a
 * fact can always be traced to the document behind it, and that marking something
 * done actually closes it. Both are asserted here through the real provider stack.
 */

const AI_SOURCED = OBLIGATIONS.find((o) => o.id === "o-1")!;
const SYSTEM_SOURCED = OBLIGATIONS.find((o) => o.id === "o-6")!;

describe("ObligationDetailScreen", () => {
  it("shows the obligation with the document it was read from", async () => {
    renderScreen(<ObligationDetailScreen id={AI_SOURCED.id} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: AI_SOURCED.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(/found this in a document/i)).toBeInTheDocument();
    expect(screen.getByText(AI_SOURCED.provenance!.document_title)).toBeInTheDocument();
    expect(screen.getByText(/94% confidence/)).toBeInTheDocument();
  });

  it("says plainly when there is no source document rather than implying one", async () => {
    renderScreen(<ObligationDetailScreen id={SYSTEM_SOURCED.id} />);

    expect(await screen.findByText(/no source document behind this one/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /see the document/i })).not.toBeInTheDocument();
  });

  it("offers a way back instead of dead-ending on an unknown id", async () => {
    renderScreen(<ObligationDetailScreen id="does-not-exist" />);

    expect(await screen.findByText(/couldn't find that obligation/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to obligations/i })).toBeInTheDocument();
  });

  it("captures an outcome when completing, and closes the obligation", async () => {
    const user = userEvent.setup();
    renderScreen(<ObligationDetailScreen id={AI_SOURCED.id} />);

    await user.click(await screen.findByRole("button", { name: /mark as done/i }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/what did it cost/i), "164");
    await user.click(within(dialog).getByRole("button", { name: /save and close/i }));

    // The optimistic update has to reach the detail cache, not just the lists — this
    // is the assertion that catches a completion that "works" everywhere but here.
    expect(await screen.findByText("Handled")).toBeInTheDocument();
    expect(screen.getByText(/closed out at \$164/i)).toBeInTheDocument();
  });

  it("refuses a cost it would have to round, and says what to type instead", async () => {
    const user = userEvent.setup();
    renderScreen(<ObligationDetailScreen id={AI_SOURCED.id} />);

    await user.click(await screen.findByRole("button", { name: /mark as done/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/what did it cost/i), "12.345");
    await user.click(within(dialog).getByRole("button", { name: /save and close/i }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/168 or 168.50/);
    expect(screen.queryByText("Handled")).not.toBeInTheDocument();
  });

  it("lets a viewer read everything and change nothing", async () => {
    renderScreen(<ObligationDetailScreen id={AI_SOURCED.id} />, { household: { role: "viewer" } });

    expect(await screen.findByText(/changing it needs write access/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark as done/i })).not.toBeInTheDocument();
  });
});
