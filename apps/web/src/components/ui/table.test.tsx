import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table, type Column } from "./table";

interface Row {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", name: "Passport", status: "expiring" },
  { id: "2", name: "Lease", status: "active" },
];

const columns: Column<Row>[] = [
  { id: "name", header: "Item", cell: (r) => r.name, sortable: true },
  { id: "status", header: "Status", cell: (r) => r.status },
];

describe("Table", () => {
  it("renders real table semantics with a caption", () => {
    render(<Table caption="Items tracked" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    // Named lookup only succeeds if the caption is wired as the accessible name —
    // which is what lets a screen-reader user identify the table they landed in.
    expect(screen.getByRole("table", { name: "Items tracked" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data rows
  });

  it("reports sort state through aria-sort", () => {
    render(
      <Table
        caption="Items"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: "name", direction: "asc" }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /item/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /status/i })).not.toHaveAttribute("aria-sort");
  });

  it("toggles direction when an already-sorted column is activated", async () => {
    const onSortChange = vi.fn();
    render(
      <Table
        caption="Items"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: "name", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /item/i }));
    expect(onSortChange).toHaveBeenCalledWith("name", "desc");
  });

  it("renders the empty slot instead of an empty grid", () => {
    render(
      <Table
        caption="Items"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<p>Nothing tracked yet</p>}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing tracked yet")).toBeInTheDocument();
  });
});
