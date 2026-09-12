import { afterEach, beforeEach, vi } from "vitest";
import * as fixtures from "@/lib/domain/fixtures";

/** Opt-in UI transport fixture. It is never imported by production code. */
export function domainFixtureFetch() {
  const obligations = structuredClone(fixtures.OBLIGATIONS);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://app.example.test");
    if (url.pathname === "/v1/households/current") return json({ id: "h-1", name: "Reyes Household", role: "owner" });
    if (url.pathname === "/v1/dashboard") return json(fixtures.SUMMARY);
    const [, , resource, id] = url.pathname.split("/");
    const records = resource === "obligations" ? obligations : resource === "documents" ? fixtures.DOCUMENTS : resource === "items" ? fixtures.ITEMS : null;
    if (!records) throw new Error(`No UI fixture for ${url.pathname}`);
    if (id) {
      const row = records.find((record) => record.id === id);
      if (!row) return json({ type: "https://autobureau.com/problems/not-found", title: "Not found", status: 404 }, 404);
      if (init?.method === "PATCH" && resource === "obligations") Object.assign(row, JSON.parse(String(init.body)));
      return json(row);
    }
    const status = url.searchParams.getAll("status"), q = url.searchParams.get("q")?.toLowerCase();
    const data = records.filter((row) => {
      if (status.length && !status.includes(row.status)) return false;
      if (q && !["title", "name", "vendor_name", "item_name"].some((key) => String((row as unknown as Record<string, unknown>)[key] ?? "").toLowerCase().includes(q))) return false;
      for (const key of ["member_id", "direction", "kind", "doc_type"]) {
        if (url.searchParams.has(key) && (row as unknown as Record<string, unknown>)[key] !== url.searchParams.get(key)) return false;
      }
      return true;
    });
    return json({ data, next_cursor: null });
  });
}

export function installDomainHttpFixtures() {
  beforeEach(() => vi.stubGlobal("fetch", domainFixtureFetch()));
  afterEach(() => vi.unstubAllGlobals());
}
