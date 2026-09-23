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

/**
 * Blueprint P0-16 — WCAG 2.1.1.
 *
 * `<tr onClick>` with no `tabIndex`, `role`, or key handler was a pointer-only action:
 * a keyboard user could Tab straight past a row that a mouse user could click. These
 * assertions exercise the same `Table` component the two named product screens render,
 * not a hand-built stand-in, so a regression here is a regression there.
 */
function rowFor(name: string): HTMLTableRowElement {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");
  expect(row, `no <tr> ancestor for "${name}"`).not.toBeNull();
  return row as HTMLTableRowElement;
}

describe("Test A · a non-clickable table takes no keyboard tab stops", () => {
  it("gives ordinary rows no tabIndex", () => {
    render(<Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(rowFor("Passport")).not.toHaveAttribute("tabindex");
  });

  it("still renders identically otherwise", () => {
    render(<Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(rowFor("Passport").className).not.toMatch(/cursor-pointer/);
  });
});

describe("Test B · a clickable row is keyboard focusable", () => {
  it("gives an actionable row tabIndex 0", () => {
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={() => {}} />,
    );
    expect(rowFor("Passport")).toHaveAttribute("tabindex", "0");
  });

  it("can actually receive focus", () => {
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={() => {}} />,
    );
    const row = rowFor("Passport");
    row.focus();
    expect(row).toHaveFocus();
  });
});

describe("Test C · Enter activates the same callback as a pointer click", () => {
  it("calls onRowClick with the focused row's own data", async () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    rowFor("Passport").focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[0]);
  });
});

describe("Test D · Space activates exactly once and does not scroll the page", () => {
  it("calls onRowClick exactly once", async () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    rowFor("Passport").focus();
    await userEvent.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("prevents the key's default page-scroll behavior", () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    const row = rowFor("Passport");
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not fire for an unrelated key", async () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    rowFor("Passport").focus();
    await userEvent.keyboard("{ArrowDown}a{Escape}");
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("Test E · pointer activation is unchanged", () => {
  it("clicking the row still fires onRowClick exactly once", async () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    await userEvent.click(screen.getByText("Passport"));
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[0]);
  });
});

describe("Test H · rows do not cross-trigger each other", () => {
  it("focusing and activating one row leaves the other untouched", async () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    rowFor("Lease").focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });

  it("clicking one row does not activate a sibling row", async () => {
    const onRowClick = vi.fn();
    render(
      <Table caption="Items" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    await userEvent.click(screen.getByText("Lease"));
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });
});
