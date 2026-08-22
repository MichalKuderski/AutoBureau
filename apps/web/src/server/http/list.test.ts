// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PAGE_LIMIT_DEFAULT, decodeCursor } from "@autobureau/contracts";
import { ListQueryError, listQuery, pageOf } from "./list";
import { RouteResponse, accepted, created, noContent } from "./route";
import { fieldErrorsFrom, validationProblem } from "./problem";

/**
 * The `/v1` collection and mutation conventions, at the layer endpoints actually use
 * (ADR-011). `packages/contracts/tests/http.test.ts` pins the wire shapes; this pins the
 * parser and the response helpers that put them on the wire.
 */

const FILTERS = z.object({
  status: z.union([z.string(), z.array(z.string())]).optional(),
  member_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

const OPTIONS = { resource: "obligations", filters: FILTERS, sort: "created_at DESC, id DESC" };
const query = (search: string) => listQuery(new URL(`https://x.test/v1/obligations${search}`), OPTIONS);

const capture = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (cause) {
    return cause;
  }
  throw new Error("expected a throw");
};

describe("Test E · filters are whitelisted per endpoint", () => {
  it("parses a declared scalar filter", () => {
    expect(query("?status=upcoming").filters).toEqual({ status: "upcoming" });
  });

  it("collects a repeated parameter into an array", () => {
    expect(query("?status=upcoming&status=done").filters.status).toEqual(["upcoming", "done"]);
  });

  it("does not comma-split, so a value may contain a comma", () => {
    expect(query("?q=" + encodeURIComponent("Reyes, Dana")).filters.q).toBe("Reyes, Dana");
  });

  it("rejects an undeclared parameter instead of ignoring it", () => {
    const error = capture(() => query("?statuss=done"));
    expect(error).toBeInstanceOf(ListQueryError);
    expect((error as ListQueryError).message).toContain("statuss");
  });

  it("rejects a declared filter whose value does not validate", () => {
    const error = capture(() => query("?member_id=not-a-uuid")) as ListQueryError;
    expect(error.issues).toBeDefined();
  });

  it("treats cursor and limit as reserved, not as unknown filters", () => {
    expect(() => query("?limit=10&cursor=")).not.toThrow();
  });
});

describe("page limits at the boundary", () => {
  it("defaults when absent", () => {
    expect(query("").limit).toBe(PAGE_LIMIT_DEFAULT);
  });

  it("accepts a value in range and refuses one outside it", () => {
    expect(query("?limit=100").limit).toBe(100);
    expect(capture(() => query("?limit=101"))).toBeInstanceOf(ListQueryError);
    expect(capture(() => query("?limit=0"))).toBeInstanceOf(ListQueryError);
  });
});

describe("Test C · a cursor round-trips through a real request", () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `id-${i}`, created_at: `2026-08-2${i}` }));
  const keysetOf = (row: (typeof rows)[number]) => [row.created_at, row.id];

  it("issues a cursor only when another page exists", () => {
    const first = query("?limit=3");
    // Four rows fetched for a limit of three: the extra row is the "is there more" answer.
    const page = pageOf(rows, first, keysetOf);
    expect(page.data).toHaveLength(3);
    expect(page.next_cursor).not.toBeNull();

    const last = pageOf(rows.slice(0, 3), first, keysetOf);
    expect(last.next_cursor).toBeNull();
  });

  it("the issued cursor decodes to the last row of the page it was issued with", () => {
    const first = query("?limit=3");
    const page = pageOf(rows, first, keysetOf);
    expect(decodeCursor(page.next_cursor!, first.fingerprint)).toEqual(["2026-08-22", "id-2"]);
  });

  it("resuming with that cursor is accepted by the same query", () => {
    const first = query("?status=upcoming&limit=3");
    const cursor = pageOf(rows, first, keysetOf).next_cursor!;
    const second = query(`?status=upcoming&limit=3&cursor=${cursor}`);
    expect(second.after).toEqual(["2026-08-22", "id-2"]);
  });

  it("parameter order does not invalidate a cursor", () => {
    const first = query("?status=upcoming&q=x&limit=3");
    const cursor = pageOf(rows, first, keysetOf).next_cursor!;
    expect(() => query(`?q=x&status=upcoming&limit=3&cursor=${cursor}`)).not.toThrow();
  });
});

describe("Test D · a cursor from a different query is refused", () => {
  const rows = [{ id: "a", created_at: "2026-08-20" }, { id: "b", created_at: "2026-08-21" }];
  const keysetOf = (row: (typeof rows)[number]) => [row.created_at, row.id];

  it("refuses a cursor when the filters changed", () => {
    const first = query("?status=upcoming&limit=1");
    const cursor = pageOf(rows, first, keysetOf).next_cursor!;
    const error = capture(() => query(`?status=done&limit=1&cursor=${cursor}`)) as ListQueryError;
    expect(error.reason).toBe("cursor");
  });

  it("refuses a malformed cursor", () => {
    expect((capture(() => query("?cursor=%20%20not-a-cursor")) as ListQueryError).reason).toBe("cursor");
  });

  it("says nothing about the data in either case", () => {
    const first = query("?status=upcoming&limit=1");
    const cursor = pageOf(rows, first, keysetOf).next_cursor!;
    const mismatched = capture(() => query(`?status=done&limit=1&cursor=${cursor}`)) as ListQueryError;
    expect(mismatched.message).not.toContain("id-");
    expect(mismatched.message).not.toContain("2026");
  });

  it("an empty cursor parameter means the first page, not an error", () => {
    expect(query("?cursor=").after).toBeNull();
  });
});

describe("Test B · an empty collection uses the same envelope", () => {
  it("returns data: [] and a null cursor", () => {
    expect(pageOf([], query(""), () => ["x"])).toEqual({ data: [], next_cursor: null });
  });
});

describe("Test H · validation errors bind to fields", () => {
  const Body = z.object({
    title: z.string().min(1),
    contacts: z.array(z.object({ email: z.string().email() })),
  });

  it("reports a client-addressable path for a nested array field", () => {
    const parsed = Body.safeParse({ title: "x", contacts: [{ email: "nope" }] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldErrorsFrom(parsed.error)).toEqual([
      { path: "contacts[0].email", message: expect.any(String) },
    ]);
  });

  it("reports an empty path for a body that is not an object at all", () => {
    const parsed = Body.safeParse("nope");
    if (parsed.success) return;
    expect(fieldErrorsFrom(parsed.error)[0]?.path).toBe("");
  });

  it("produces a 400 problem+json carrying those errors", async () => {
    const parsed = Body.safeParse({ title: "", contacts: [] });
    if (parsed.success) return;
    const response = validationProblem(parsed.error);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.type).toBe("https://autobureau.com/problems/validation");
    expect(body.errors[0].path).toBe("title");
  });

  it("echoes no submitted value back into the problem body", async () => {
    const parsed = Body.safeParse({ title: "", contacts: [{ email: "passport@secret.test" }] });
    if (parsed.success) return;
    const body = await validationProblem(parsed.error).json();
    expect(JSON.stringify(body)).not.toContain("passport@secret.test");
  });
});

describe("Test K · mutation status conventions", () => {
  it("created is 201 and may carry a Location", () => {
    const result = created({ id: "o-1" }, "/v1/obligations/o-1");
    expect(result).toBeInstanceOf(RouteResponse);
    expect(result.status).toBe(201);
    expect(result.headers["location"]).toBe("/v1/obligations/o-1");
  });

  it("accepted is 202 and carries the handle for the work", () => {
    expect(accepted({ task_run_id: "t-1" }).status).toBe(202);
  });

  it("noContent is 204 with no body", () => {
    expect(noContent().status).toBe(204);
    expect(noContent().body).toBeUndefined();
  });

  it("a plain value is still a 200 — every existing handler is unaffected", () => {
    expect({ id: "h-1" }).not.toBeInstanceOf(RouteResponse);
  });
});
