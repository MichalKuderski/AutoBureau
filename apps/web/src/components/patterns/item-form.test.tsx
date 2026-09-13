import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/render";
import { ItemForm } from "./item-form";

afterEach(() => vi.unstubAllGlobals());
describe("manual item submission", () => {
  it("retains a failed submission and reuses its idempotency key on retry", async () => {
    const onSaved = vi.fn(), onClose = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 503, title: "Service unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "saved", name: "My cover" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    renderScreen(<ItemForm onClose={onClose} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/Item name/), "My cover");
    await userEvent.type(screen.getByLabelText("Amount (optional)"), "125.50");
    await userEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(await screen.findByText("Couldn’t save this item")).toBeInTheDocument();
    expect(screen.getByLabelText(/Item name/)).toHaveValue("My cover");
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save item" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "saved", name: "My cover" }));
    expect(fetcher.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(fetcher.mock.calls[1]![1].headers["Idempotency-Key"]);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ amount_cents: 12550, currency: "USD" });
  });
  it("rejects excessive decimal precision without sending a request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    renderScreen(<ItemForm onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Item name/), "My cover");
    await userEvent.type(screen.getByLabelText("Amount (optional)"), "12.345");
    await userEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(await screen.findByText("Enter an amount with no more than two decimal places.")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
