import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchInput } from "./filter-bar";

describe("SearchInput", () => {
  it("is reachable by its accessible name, not only its placeholder", () => {
    const onChange = vi.fn();
    render(<SearchInput label="Search documents" value="" onChange={onChange} placeholder="Search documents…" />);
    const input = screen.getByRole("searchbox", { name: "Search documents" });
    fireEvent.change(input, { target: { value: "lease" } });
    expect(onChange).toHaveBeenCalledWith("lease");
  });
});
