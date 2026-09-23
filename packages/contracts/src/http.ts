import { z } from "zod";

/**
 * `/v1` domain API conventions (ADR-011).
 *
 * Doc 03 §1 already froze most of this table — cursor pagination as `?cursor=&limit=`
 * with a `{data, next_cursor}` response, whitelisted per-endpoint filters with no query
 * language, RFC 9457 problem responses, `Idempotency-Key` on POSTs with side effects.
 * What it did not say is what a cursor *is*, what order rows come back in, what a `PATCH`
 * body means, or which status a mutation answers with. One endpoint exists and about
 * thirteen are coming; this module is where the answers live so they are not invented
 * thirteen times.
 *
 * Everything here is isomorphic. The one piece that is not — hashing a query into a
 * cursor fingerprint — takes the digest as an argument rather than computing it, so this
 * file never drags `node:crypto` into a browser bundle. The server computes it with
 * `payloadSha256Hex` from `@autobureau/contracts/node`.
 */

// ─────────────────────────────── list envelope ───────────────────────────────

/**
 * The collection envelope. Doc 03 §1 fixed the shape; this is its schema.
 *
 * Deliberately two fields and no more. `has_more` was considered and rejected: it is
 * derivable (`next_cursor !== null`), and two sources for one fact eventually disagree.
 * A total count is also absent — counting a filtered household-scoped table costs a
 * second query on every page for a number the UI does not show.
 *
 * An empty collection is `{ data: [], next_cursor: null }`. It is not a 404, and not a
 * different shape: a client that special-cases empty is a client that will crash on the
 * first household with no documents.
 *
 * Additive evolution stays open. A future `meta` object may be added beside these two
 * without breaking a client, because clients read named fields rather than positions.
 */
export function PageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    /** Opaque. `null` means this is the last page. */
    next_cursor: z.string().nullable(),
  });
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

// ─────────────────────────────── pagination ───────────────────────────────

/** Doc 03 §1 fixes the ceiling. The default is this module's decision. */
export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 25;

/**
 * `?limit=` — an integer in 1…100, or absent.
 *
 * Out-of-range values are rejected rather than clamped. Clamping means a caller asking
 * for 1000 silently receives 100 and cannot tell whether the collection ended; a 400
 * says which rule was broken, which is the whole point of a documented contract.
 */
export const PageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PAGE_LIMIT_MAX)
  .default(PAGE_LIMIT_DEFAULT);

/**
 * What a cursor carries, before encoding.
 *
 * `k` is the *keyset*: the ordering values of the last row on the page just served. Not
 * an offset — an offset re-counts rows that may have shifted, so a row inserted during
 * paging silently duplicates or skips one. A keyset resumes at a position in the sort,
 * which is stable under insertion and deletion.
 *
 * `f` binds the cursor to the query that produced it (see `cursorFingerprint`).
 */
const CursorPayloadSchema = z.object({
  k: z.array(z.union([z.string(), z.number().int()])).min(1),
  f: z.string().min(1),
});

export type CursorKeyset = ReadonlyArray<string | number>;

export class CursorError extends Error {
  override readonly name = "CursorError";
  constructor(readonly reason: "malformed" | "mismatched-query") {
    super(
      reason === "malformed"
        ? "cursor is not a cursor this endpoint issued"
        : "cursor belongs to a different filter or sort",
    );
  }
}

const toBase64Url = (input: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (input: string): string => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

/**
 * Encode a keyset into the opaque string a client sends back.
 *
 * Opaque is a contract, not an implementation detail: a client that parses this is a
 * client that breaks when the sort gains a column. Base64url of JSON is *obfuscation*
 * and nothing more — it is deliberately not signed or encrypted, because it needs no
 * confidentiality and no integrity. The values inside are the caller's own rows' sort
 * keys, and a tampered cursor cannot reach another household's data: every query it
 * resumes still runs inside `withHousehold`, where RLS decides what exists. The worst a
 * forged cursor achieves is a strange page of the caller's own collection.
 */
export function encodeCursor(keyset: CursorKeyset, fingerprint: string): string {
  return toBase64Url(JSON.stringify({ k: [...keyset], f: fingerprint }));
}

/**
 * Decode a cursor, refusing one that belongs to a different query.
 *
 * A cursor is a position in *one* ordering of *one* filtered set. Replaying it against
 * different filters resumes at a keyset that means something else — which produces a page
 * that is not wrong in any way the caller can detect. Binding the fingerprint turns that
 * silent nonsense into a 400.
 */
export function decodeCursor(cursor: string, fingerprint: string): CursorKeyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw new CursorError("malformed");
  }
  const result = CursorPayloadSchema.safeParse(parsed);
  if (!result.success) throw new CursorError("malformed");
  if (result.data.f !== fingerprint) throw new CursorError("mismatched-query");
  return result.data.k;
}

/**
 * The canonical input to a cursor's fingerprint.
 *
 * Hashing this — with `payloadSha256Hex`, the same RFC 8785 canonicalization approval
 * payloads use — gives a value that is identical across runtimes and independent of query
 * parameter order, so `?status=a&kind=b` and `?kind=b&status=a` produce one cursor rather
 * than two that refuse each other.
 */
export function cursorFingerprintInput(
  resource: string,
  filters: Readonly<Record<string, unknown>>,
  sort: string,
): Record<string, unknown> {
  const normalised: Record<string, unknown> = {};
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === undefined) continue;
    normalised[key] = Array.isArray(value) ? [...value].map(String).sort() : value;
  }
  return { resource, sort, filters: normalised };
}

// ─────────────────────────────── ordering ───────────────────────────────

/**
 * Sort direction. Ascending is never the default for a feed — see `ORDERING_RULE`.
 */
export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/**
 * THE ORDERING RULE, stated once so thirteen endpoints do not each invent one.
 *
 * Every list endpoint declares a total order whose LAST component is the primary key.
 * Without that, rows sharing a `created_at` tie in an arbitrary order, the keyset lands
 * mid-tie, and paging drops or repeats rows — a bug that appears only when two rows are
 * written in the same millisecond, which is to say only in production.
 *
 * The default order is `created_at DESC, id DESC`: newest first, ties broken by a UUIDv7
 * whose leading bits are themselves a timestamp, so the tiebreak agrees with the sort
 * rather than fighting it. An endpoint may declare a different order — `due_at ASC` for
 * obligations is the obvious one — and must still end it with `id`.
 *
 * Client-controlled sorting is NOT part of v1. The product has none: the shared `Table`
 * sorts presentationally, over data it already holds. When an endpoint genuinely needs
 * it, `?sort=` takes a value from a server-defined enum of named orders — never a column
 * name, which is how a sort parameter becomes an injection sink — and the enum member
 * maps to a declared total order on the server.
 */
export const ORDERING_RULE = "created_at DESC, id DESC" as const;

// ─────────────────────────────── PATCH ───────────────────────────────

/**
 * What a `PATCH` body means (RFC 7396 merge semantics, narrowed).
 *
 * - A field that is **absent** is unchanged. This is the whole reason PATCH exists here:
 *   a client that holds a stale copy of a resource must not overwrite fields it never
 *   displayed, which is exactly what a PUT of the full representation would do.
 * - A field explicitly set to **null** is cleared, and only where the field is nullable.
 *   `null` on a non-nullable field is a validation error, not a silent no-op — the two
 *   are indistinguishable to a client otherwise, and "why did my update do nothing" is a
 *   bug report nobody can act on.
 * - An **unknown** field is a validation error (doc 03 §4 already 400s on schema
 *   mismatch). Ignoring it means a typo'd field name looks like a successful write.
 * - A **read-only or immutable** field present in the body is a validation error for the
 *   same reason, even when the value matches what is stored.
 * - An **empty** body `{}` is valid: 200 with the current representation, no write, no
 *   audit row. It changes nothing, and refusing it would make retry logic special-case a
 *   request that is already correct.
 *
 * Not RFC 6902 JSON Patch. Its op arrays buy array-index manipulation and test/assert
 * semantics, and no AutoBureau resource needs either; the cost would be a request body
 * no client can construct without a library.
 *
 * `nullableUpdate` is the helper that encodes the tri-state at the type level: absent,
 * null, or a value.
 */
export function nullableUpdate<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullable().optional();
}

// ─────────────────────────────── idempotency ───────────────────────────────

/**
 * The `Idempotency-Key` contract (ADR-011). P1-05 implements the storage; this is the
 * agreement it implements.
 *
 * Doc 03 §1 fixed the header and the 24-hour retention, and that replays are returned
 * verbatim. What it left open is what "the same request" means — answered here as the
 * scope tuple plus a body fingerprint.
 */
export const IDEMPOTENCY_HEADER = "idempotency-key";

/** Opaque to the server; a UUID in practice, because `apiFetch` generates one. */
export const IdempotencyKeySchema = z.string().min(1).max(255);

/**
 * What the server does with a key that was supplied.
 *
 * Two facts have to agree here, and the question is not "which methods may send a key"
 * but "what happens to one that arrives".
 *
 *   - Doc 03 §1: the header is *honored on all POSTs with side effects*.
 *   - `apiFetch` attaches a generated key to every unsafe method except DELETE — so
 *     `POST`, `PATCH` and `PUT` all arrive carrying one, today, from our own client.
 *
 * So `honored` is `POST`: that is where a stored response is looked up and replayed, and
 * where a key reused with a different body is a `409`.
 *
 * `POST` is deliberately unqualified, because under `/v1` "POST" and "POST with side
 * effects" denote the same set. Every POST in doc 03 §2 mutates — creates, state
 * transitions (`/complete`, `/dismiss`, `/snooze`, `/cancel`), approvals, invites,
 * exports, registrations, the `/v1/notifications/read` batch. The endpoint that is a
 * read-only POST in most APIs is a `GET` here (`GET /v1/search?q=`), and doc 03 §1 rules
 * out a generic query language, so no POST-shaped read exists to disagree about. Taking a
 * method and no path is therefore complete rather than a simplification; ADR-011 D13 says
 * what a future read-only POST would have to do first.
 *
 * Everything else is `ignored` — and *ignored* is the load-bearing word. A key on a
 * `PATCH` must never be rejected: our own client sends one on every `PATCH`, so a server
 * that 400'd an unexpected key would fail every update in the product. It is safe to
 * ignore because those methods are already idempotent under this ADR — a merge patch
 * reapplied is a no-op (D6), and deleting an absent resource answers 204 (D9) — so replay
 * protection adds nothing they do not already have.
 *
 * A future endpoint may choose to honor a key on `PATCH` or `PUT` as a local decision;
 * what it may not do is refuse one.
 */
export type IdempotencyDisposition = "honored" | "ignored";

export function idempotencyDisposition(method: string): IdempotencyDisposition {
  return method.toUpperCase() === "POST" ? "honored" : "ignored";
}

/**
 * The canonical input to a request's idempotency fingerprint.
 *
 * Scoped by household and principal so one household's key can never collide with
 * another's, and by method and path so the same key on a different endpoint is a
 * different request rather than a false replay. The body participates: a key reused with
 * a *different* body is a client bug, and answering it with the first response would hide
 * that bug behind a success. That case is `409 conflict`.
 */
export function idempotencyFingerprintInput(request: {
  householdId: string;
  userId: string;
  method: string;
  path: string;
  body: unknown;
}): Record<string, unknown> {
  return {
    household_id: request.householdId,
    user_id: request.userId,
    method: request.method.toUpperCase(),
    path: request.path,
    body: request.body ?? null,
  };
}
