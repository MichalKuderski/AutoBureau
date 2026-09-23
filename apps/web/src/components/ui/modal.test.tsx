import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./modal";
import { TextInput } from "./field";

/**
 * A dialog that contains a text field is the case hand-rolled focus traps get wrong:
 * every keystroke re-renders the caller, and an effect keyed on the caller's inline
 * `onClose` re-runs and drags focus back to the autofocus element. The user types one
 * character and the rest goes nowhere. These tests pin the behaviour rather than the
 * implementation, so any future rewrite of the trap has to keep it.
 */

function Harness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <p>Typed: {value}</p>
      <Modal
        open={open}
        // Deliberately a fresh function identity on every render — this is what every
        // real caller does, and what the trap must tolerate.
        onClose={() => setOpen(false)}
        title="Outcome"
        footer={
          <button type="button" data-autofocus>
            Save
          </button>
        }
      >
        <TextInput label="Cost" value={value} onChange={(e) => setValue(e.target.value)} />
      </Modal>
    </>
  );
}

describe("Modal focus behaviour", () => {
  it("keeps focus in a field while the user types", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const field = screen.getByLabelText("Cost");
    await user.type(field, "168.50");

    expect(field).toHaveValue("168.50");
    expect(field).toHaveFocus();
    expect(screen.getByText("Typed: 168.50")).toBeInTheDocument();
  });

  it("moves focus into the dialog on open and back to the trigger on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
