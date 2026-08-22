import { z } from "zod";
import {
  CursorError,
  PageLimitSchema,
  cursorFingerprintInput,
  decodeCursor,
  encodeCursor,
  type CursorKeyset,
  type Page,
} from "@autobureau/contracts";
import { payloadSha256Hex } from "@autobureau/contracts/node";

/**
 * Collection endpoints, parsed once (ADR-011).
 *
 * Doc 03 §1 fixed `?cursor=&limit=` and a `{data, next_cursor}` response. This is the
 * shared implementation of that sentence, so the thirteen list endpoints still to be
 * written inherit one parser rather than thirteen slightly different ones — which is how
 * a `limit` ceiling ends up enforced on four endpoints out of thirteen.
 *
 * WHAT A CALLER DECLARES, AND WHAT IT MAY NOT
 * -------------------------------------------
 * A caller declares its resource name, its filter schema, and its ordering. It never
 * declares a column: `sort` is a name this module hands back verbatim to be mapped
 * server-side, and filters arrive already parsed by a Zod schema the endpoint owns. There
 * is no path by which a query parameter reaches SQL — which is the property that makes
 * "whitelisted params per endpoint" (doc 03 §1) enforceable rather than aspirational.
 */

export class ListQueryError extends Error {
  override readonly name = "ListQueryError";
  constructor(
    readonly reason: "unknown-parameter" | "cursor",
    message: string,
    readonly issues?: z.ZodError,
  ) {
    super(message);
  }
}

/** Reserved parameter names every collection endpoint understands. */
const RESERVED = new Set(["cursor", "limit"]);

export interface ListQuery<F> {
  readonly filters: F;
  readonly limit: number;
  /** Absent on the first page; the ordering values to resume after otherwise. */
  readonly after: CursorKeyset | null;
  /** Binds any cursor this request issues to this exact query. */
  readonly fingerprint: string;
}

export interface ListQueryOptions<S extends z.ZodTypeAny> {
  /** Stable name for this collection; part of the cursor fingerprint. */
  readonly resource: string;
  /** The endpoint's whitelist. Anything not in it is not a filter. */
  readonly filters: S;
  /** The declared total order, ending in the primary key (see `ORDERING_RULE`). */
  readonly sort: string;
}

/**
 * Parse a collection request.
 *
 * Unknown query parameters are rejected rather than ignored. A silently dropped
 * `?statuss=done` returns the whole collection and looks like a working filter, which is
 * the failure mode that costs an afternoon; a 400 naming the parameter costs a second.
 *
 * Repeated parameters become arrays, so `?status=a&status=b` is a multi-value filter
 * without a separator convention. Comma-splitting was rejected: it makes a comma illegal
 * inside every filter value forever, and search text legitimately contains one.
 */
export function listQuery<S extends z.ZodTypeAny>(
  url: URL,
  options: ListQueryOptions<S>,
): ListQuery<z.infer<S>> {
  const raw = new Map<string, string[]>();
  for (const [key, value] of url.searchParams) {
    if (RESERVED.has(key)) continue;
    const existing = raw.get(key);
    if (existing) existing.push(value);
    else raw.set(key, [value]);
  }

  const shape = options.filters instanceof z.ZodObject ? options.filters.shape : {};
  const known = new Set(Object.keys(shape as Record<string, unknown>));
  const unknown = [...raw.keys()].filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new ListQueryError(
      "unknown-parameter",
      `not a filter this endpoint accepts: ${unknown.sort().join(", ")}`,
    );
  }

  const candidate: Record<string, unknown> = {};
  for (const [key, values] of raw) candidate[key] = values.length === 1 ? values[0] : values;

  const parsed = options.filters.safeParse(candidate);
  if (!parsed.success) {
    throw new ListQueryError("unknown-parameter", "filters did not validate", parsed.error);
  }

  const limitParsed = PageLimitSchema.safeParse(url.searchParams.get("limit") ?? undefined);
  if (!limitParsed.success) {
    throw new ListQueryError("unknown-parameter", "limit must be between 1 and 100", limitParsed.error);
  }

  const fingerprint = payloadSha256Hex(
    cursorFingerprintInput(options.resource, parsed.data as Record<string, unknown>, options.sort),
  );

  const cursor = url.searchParams.get("cursor");
  let after: CursorKeyset | null = null;
  if (cursor !== null && cursor !== "") {
    try {
      after = decodeCursor(cursor, fingerprint);
    } catch (cause) {
      if (cause instanceof CursorError) {
        // Both reasons are the caller's to fix and neither says anything about the data:
        // a mismatched cursor reveals only that the filters changed, which the caller
        // already knows because it changed them.
        throw new ListQueryError("cursor", cause.message);
      }
      throw cause;
    }
  }

  return { filters: parsed.data, limit: limitParsed.data, after, fingerprint };
}

/**
 * Build the response envelope.
 *
 * Endpoints fetch `limit + 1` rows: the extra one answers "is there another page" without
 * a second query and without a count. It is dropped here rather than returned, and its
 * existence is what makes `next_cursor` non-null.
 */
export function pageOf<T>(
  rows: readonly T[],
  query: Pick<ListQuery<unknown>, "limit" | "fingerprint">,
  keysetOf: (row: T) => CursorKeyset,
): Page<T> {
  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : [...rows];
  const last = data[data.length - 1];
  return {
    data,
    next_cursor: hasMore && last !== undefined ? encodeCursor(keysetOf(last), query.fingerprint) : null,
  };
}
