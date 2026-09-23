import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select, TextInput, Toggle } from "./field";

/**
 * Accessibility wiring, tested at the seam where it actually breaks.
 *
 * The classic production failure is a form whose error message is visible but never
 * announced: sighted users see red, screen-reader users hit submit again and again
 * with no idea why. These assertions exist so that regression is impossible.
 */

describe("TextInput", () => {
  it("associates its label with the control", () => {
    render(<TextInput label="Household name" defaultValue="" />);
    expect(screen.getByLabelText("Household name")).toBeInTheDocument();
  });

  it("announces errors and marks the control invalid", () => {
    render(<TextInput label="Email" error="Enter an address we can reach you at." />);
    const input = screen.getByLabelText("Email");
    const error = screen.getByRole("alert");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(error).toHaveTextContent("Enter an address we can reach you at.");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("links description and error together when both are present", () => {
    render(
      <TextInput label="Timezone" description="Used to schedule reminders." error="Required." />,
    );
    const describedBy = screen.getByLabelText("Timezone").getAttribute("aria-describedby") ?? "";
    // Both ids must be referenced, or one of the two messages is silent.
    expect(describedBy.split(" ").filter(Boolean)).toHaveLength(2);
  });

  it("leaves aria-invalid off when the field is fine", () => {
    render(<TextInput label="Name" />);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("Select", () => {
  it("renders its options and stays labelled", () => {
    render(
      <Select
        label="Timezone"
        options={[
          { value: "America/New_York", label: "Eastern" },
          { value: "America/Denver", label: "Mountain" },
        ]}
      />,
    );
    expect(screen.getByLabelText("Timezone")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

describe("Toggle", () => {
  it("exposes switch semantics and its checked state", () => {
    render(
      <Toggle
        label="Two-step verification"
        description="Ask for a code on new devices."
        checked={false}
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: /two-step verification/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.getAttribute("aria-describedby")).toBeTruthy();
  });
});
