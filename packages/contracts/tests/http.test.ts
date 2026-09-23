import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CursorError,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  ORDERING_RULE,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PageLimitSchema,
  PageSchema,
  cursorFingerprintInput,
  decodeCursor,
  encodeCursor,
  idempotencyDisposition,
  idempotencyFingerprintInput,
  nullableUpdate,
} from "../src/http.js";
import { payloadSha256Hex } from "../src/canonical.js";

/**
 * The `/v1` conventions (ADR-011).
 *
 * These assertions are the contract. Doc 03 §1 decided the envelope and cursor
 * pagination in a table; this is where "decided" becomes "enforced", so that the
 * thirteen endpoints still to be written inherit one answer rather than thirteen.
 */

const Item = z.object({ id: z.string(), name: z.string() });
const fingerprint = (resource: string, filters: Record<string, unknown>, sort: string) =>
  payloadSha256Hex(cursorFingerprintInput(resource, filters, sort));

describe("Test A · the list envelope is exactly two fields", () => {
  it("accepts a page and rejects extra top-level fields", () => {
    const page = PageSchema(Item);
    expect(
      page.parse({ data: [{ id: "1", name: "a" }], next_cursor: "abc" }),
    ).toEqual({ data: [{ id: "1", name: "a" }], next_cursor: "abc" });

    // `has_more` is deliberately absent — derivable from `next_cursor`, and two sources
    // for one fact eventually disagree.
    expect(page.parse({ data: [], next_cursor: null, has_more: false })).not.toHaveProperty(
      "has_more",
    );
  });

  it("requires next_cursor to be present, even when null", () => {
    expect(PageSchema(Item).safeParse({ data: [] }).success).toBe(false);
  });

  it("is the same shape for a singleton-bearing page as for a full one", () => {
    const page = PageSchema(Item);
    expect(page.parse({ data: [{ id: "1", name: "a" }], next_cursor: null }).data).toHaveLength(1);
  });
});

describe("Test B · an empty collection uses the same envelope", () => {
  it("is data: [] with a null cursor, not a 404 and not a different shape", () => {
    expect(PageSchema(Item).parse({ data: [], next_cursor: null })).toEqual({
      data: [],
      next_cursor: null,
    });
  });
});

describe("page limits", () => {
  it("defaults when absent and accepts the documented bounds", () => {
    expect(PageLimitSchema.parse(undefined)).toBe(PAGE_LIMIT_DEFAULT);
    expect(PageLimitSchema.parse("1")).toBe(1);
    expect(PageLimitSchema.parse(String(PAGE_LIMIT_MAX))).toBe(PAGE_LIMIT_MAX);
  });

  it("rejects out-of-range rather than clamping", () => {
    // Clamping would let a caller asking for 1000 receive 100 with no way to tell the
    // collection had not ended.
    expect(PageLimitSchema.safeParse("0").success).toBe(false);
    expect(PageLimitSchema.safeParse(String(PAGE_LIMIT_MAX + 1)).success).toBe(false);
    expect(PageLimitSchema.safeParse("2.5").success).toBe(false);
    expect(PageLimitSchema.safeParse("all").success).toBe(false);
  });

  it("honours doc 03 §1's ceiling of 100", () => {
    expect(PAGE_LIMIT_MAX).toBe(100);
  });
});

describe("Test C · a cursor round-trips", () => {
  it("returns the keyset it was given, for the same query", () => {
    const f = fingerprint("obligations", { status: "upcoming" }, ORDERING_RULE);
    const cursor = encodeCursor(["2026-08-21T00:00:00.000Z", "0192f5a1-0000-7000-8000-000000000001"], f);
    expect(decodeCursor(cursor, f)).toEqual([
      "2026-08-21T00:00:00.000Z",
      "0192f5a1-0000-7000-8000-000000000001",
    ]);
  });

  it("survives integer keys as well as strings", () => {
    const f = fingerprint("items", {}, ORDERING_RULE);
    expect(decodeCursor(encodeCursor([3, "id-3"], f), f)).toEqual([3, "id-3"]);
  });

  it("is opaque — no field of the keyset is readable without decoding", () => {
    const f = fingerprint("documents", {}, ORDERING_RULE);
    const cursor = encodeCursor(["2026-08-21T00:00:00.000Z", "doc-1"], f);
    expect(cursor).not.toContain("doc-1");
    expect(cursor).not.toContain("2026");
    // base64url: URL-safe, unpadded, so it needs no encoding in a query string.
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("Test D · an invalid cursor is refused", () => {
  const f = fingerprint("obligations", { status: "upcoming" }, ORDERING_RULE);

  it.each(["", "not-base64!!", "YWJj", toB64("{}"), toB64('{"k":[],"f":"x"}')])(
    "rejects %s as malformed",
    (cursor) => {
      const error = capture(() => decodeCursor(cursor, f));
      expect(error).toBeInstanceOf(CursorError);
      expect((error as CursorError).reason).toBe("malformed");
    },
  );

  it("rejects a cursor issued for a different filter", () => {
    const cursor = encodeCursor(["x", "y"], f);
    const other = fingerprint("obligations", { status: "done" }, ORDERING_RULE);
    const error = capture(() => decodeCursor(cursor, other));
    expect((error as CursorError).reason).toBe("mismatched-query");
  });

  it("rejects a cursor issued for a different sort", () => {
    const cursor = encodeCursor(["x", "y"], f);
    const other = fingerprint("obligations", { status: "upcoming" }, "due_at ASC, id ASC");
    expect((capture(() => decodeCursor(cursor, other)) as CursorError).reason).toBe(
      "mismatched-query",
    );
  });

  it("rejects a cursor issued for a different resource", () => {
    const cursor = encodeCursor(["x", "y"], f);
    const other = fingerprint("documents", { status: "upcoming" }, ORDERING_RULE);
    expect((capture(() => decodeCursor(cursor, other)) as CursorError).reason).toBe(
      "mismatched-query",
    );
  });
});

describe("Test E · filter encoding is order-independent", () => {
  it("produces one fingerprint regardless of parameter order", () => {
    expect(fingerprint("obligations", { status: "upcoming", kind: "renewal" }, ORDERING_RULE)).toBe(
      fingerprint("obligations", { kind: "renewal", status: "upcoming" }, ORDERING_RULE),
    );
  });

  it("treats a repeated parameter as a set, not a sequence", () => {
    // `?status=a&status=b` and `?status=b&status=a` are the same query.
    expect(fingerprint("obligations", { status: ["a", "b"] }, ORDERING_RULE)).toBe(
      fingerprint("obligations", { status: ["b", "a"] }, ORDERING_RULE),
    );
  });

  it("ignores absent filters so an unset parameter equals an omitted one", () => {
    expect(fingerprint("items", { kind: undefined, status: "active" }, ORDERING_RULE)).toBe(
      fingerprint("items", { status: "active" }, ORDERING_RULE),
    );
  });

  it("distinguishes different values", () => {
    expect(fingerprint("items", { status: "active" }, ORDERING_RULE)).not.toBe(
      fingerprint("items", { status: "archived" }, ORDERING_RULE),
    );
  });
});

describe("Test F · ordering is total and ends in the primary key", () => {
  it("documents the default order", () => {
    expect(ORDERING_RULE).toBe("created_at DESC, id DESC");
  });

  it("ends in id, which is what makes a keyset stable across ties", () => {
    expect(ORDERING_RULE.trim().endsWith("id DESC")).toBe(true);
  });
});

describe("Test G · PATCH tri-state", () => {
  const Patch = z.object({
    name: z.string().optional(),
    vendor_name: nullableUpdate(z.string()),
  });

  it("absent means unchanged — the key is simply not there", () => {
    const parsed = Patch.parse({ name: "x" });
    expect("vendor_name" in parsed).toBe(false);
  });

  it("explicit null means clear, and is distinguishable from absent", () => {
    const parsed = Patch.parse({ vendor_name: null });
    expect("vendor_name" in parsed).toBe(true);
    expect(parsed.vendor_name).toBeNull();
  });

  it("a value means set", () => {
    expect(Patch.parse({ vendor_name: "Griffin Mutual" }).vendor_name).toBe("Griffin Mutual");
  });

  it("null on a non-nullable field is a validation error, not a silent no-op", () => {
    expect(Patch.safeParse({ name: null }).success).toBe(false);
  });

  it("an empty patch is valid — it changes nothing and refusing it would break retries", () => {
    expect(Patch.safeParse({}).success).toBe(true);
  });

  it("an unknown field is rejected when the schema is strict", () => {
    expect(Patch.strict().safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("Test J · the idempotency contract", () => {
  it("honors a key on POST, case-insensitively", () => {
    expect(idempotencyDisposition("POST")).toBe("honored");
    expect(idempotencyDisposition("post")).toBe("honored");
  });

  it("ignores — never rejects — a key on every other method", () => {
    // Load-bearing. `apiFetch` attaches a generated key to every unsafe method except
    // DELETE, so PATCH and PUT arrive carrying one from our own client today. A server
    // that treated an unexpected key as an error would fail every update in the product.
    for (const method of ["GET", "PATCH", "PUT", "DELETE", "HEAD"]) {
      expect(idempotencyDisposition(method)).toBe("ignored");
    }
  });

  it("covers exactly the methods apiFetch actually sends a key on", () => {
    // The reconciliation this test exists for: `api-client.ts` sends a key when
    // `method !== "GET" && method !== "DELETE"`. Every one of those methods must have a
    // defined disposition, and none of them may be an error.
    for (const method of ["POST", "PATCH", "PUT"]) {
      expect(["honored", "ignored"]).toContain(idempotencyDisposition(method));
    }
  });

  it("names the header doc 03 §1 fixed", () => {
    expect(IDEMPOTENCY_HEADER).toBe("idempotency-key");
  });

  it("bounds the key without constraining its format", () => {
    expect(IdempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse("").success).toBe(false);
    expect(IdempotencyKeySchema.safeParse("k".repeat(256)).success).toBe(false);
  });

  const base = {
    householdId: "h-1",
    userId: "u-1",
    method: "POST",
    path: "/v1/obligations",
    body: { title: "Renew" },
  };

  it("the same request fingerprints identically — that is what makes replay safe", () => {
    expect(payloadSha256Hex(idempotencyFingerprintInput(base))).toBe(
      payloadSha256Hex(idempotencyFingerprintInput({ ...base, method: "post" })),
    );
  });

  it("a different body is a different request — the case that must answer 409", () => {
    expect(payloadSha256Hex(idempotencyFingerprintInput(base))).not.toBe(
      payloadSha256Hex(idempotencyFingerprintInput({ ...base, body: { title: "Cancel" } })),
    );
  });

  it("is scoped by household, so one household's key cannot collide with another's", () => {
    expect(payloadSha256Hex(idempotencyFingerprintInput(base))).not.toBe(
      payloadSha256Hex(idempotencyFingerprintInput({ ...base, householdId: "h-2" })),
    );
  });

  it("is scoped by principal and by path", () => {
    expect(payloadSha256Hex(idempotencyFingerprintInput(base))).not.toBe(
      payloadSha256Hex(idempotencyFingerprintInput({ ...base, userId: "u-2" })),
    );
    expect(payloadSha256Hex(idempotencyFingerprintInput(base))).not.toBe(
      payloadSha256Hex(idempotencyFingerprintInput({ ...base, path: "/v1/items" })),
    );
  });

  it("treats a bodyless POST as null rather than refusing to fingerprint it", () => {
    expect(() => payloadSha256Hex(idempotencyFingerprintInput({ ...base, body: undefined }))).not.toThrow();
  });
});

function toB64(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (cause) {
    return cause;
  }
  throw new Error("expected a throw");
}
