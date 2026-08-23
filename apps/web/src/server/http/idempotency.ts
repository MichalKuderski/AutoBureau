import {
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  idempotencyDisposition,
  idempotencyFingerprintInput,
  uuidv7,
} from "@autobureau/contracts";
import { CanonicalizationError, payloadSha256Hex } from "@autobureau/contracts/node";
import type { Database, ScopedClient } from "@autobureau/db";
import type { RequestContext } from "../auth/context";
import { householdRef, log } from "../observability";
import { problemResponse } from "./problem";

/**
 * Server-side idempotency (blueprint P1-05).
 *
 * ADR-011 D13 is the contract; this file is the machine that keeps it, and ADR-012 is why
 * the machine is made of Postgres rather than Redis. Until now `apiFetch` generated an
 * `Idempotency-Key` for every unsafe non-DELETE request and no server code read it, while
 * that file's own header promised "a double-tapped button on a flaky train connection
 * cannot create two obligations". That promise is what this implements.
 *
 * THE CONTRACT, RESTATED SO THIS FILE CAN BE READ ALONE
 * -----------------------------------------------------
 *   POST                       honored — claim, execute, store, replay
 *   every other method         the key is IGNORED, never rejected. `apiFetch` sends one
 *                              on PATCH and PUT too, so a server that 400'd an unexpected
 *                              key would fail every update in the product.
 *   same key, same fingerprint replay the stored response
 *   same key, other fingerprint 409
 *   same key, still in flight  409
 *   retention                  24 h
 *
 * WHAT IS AND IS NOT COVERED, AND WHY IT NEEDS NO ALLOWLIST
 * ---------------------------------------------------------
 * This runs inside `authenticated()`, so the two ADR-011 exceptions are excluded by
 * construction rather than by a path list that someone has to remember to update:
 * `/v1/auth/*` establishes the session and is deliberately not wrapped in
 * `authenticated()`, and a `/v1/webhooks/*` endpoint cannot be — a third-party POST has
 * no principal and no household, which are two thirds of the fingerprint. Their replay
 * protection is the provider's event id plus the HMAC check (doc 05 §2).
 *
 * THE ORDER IS UNCHANGED. This is invoked after CSRF, identity, household and
 * authorization have all passed, and inside `runAsUser` — so an unauthenticated request
 * never reaches the store, and a key can never become a side channel around the boundary.
 * It has to be inside `runAsUser` for a second reason: the RLS policy on the table checks
 * `app.current_user_id()`, which `withHousehold` sets from the audit actor.
 */

/** Retention is fixed by ADR-011 D13. Expressed here so the SQL below can be read. */
const RETENTION = "24 hours";

/**
 * Headers that are never persisted, whatever a handler sets.
 *
 * Cookies are session material: replaying a `set-cookie` for 24 hours would hand a stale
 * session to whoever repeats the request. `/v1` handlers do not set cookies today — the
 * auth routes that do are outside this wrapper entirely — so this is a guard against a
 * future handler, not a description of one that exists.
 */
const NEVER_STORED: ReadonlySet<string> = new Set(["set-cookie", "authorization"]);

interface ClaimRow {
  readonly id: string;
  readonly fingerprint: string;
  readonly state: string;
  readonly response_status: number | null;
  readonly response_body: string | null;
  readonly response_headers: Record<string, string> | null;
}

export interface IdempotencyInput {
  readonly request: Request;
  readonly ctx: RequestContext;
  readonly db: Database;
  readonly traceId: string;
  readonly route: string | undefined;
}

/**
 * The request target used in the fingerprint: pathname plus query string.
 *
 * The query string participates because it is part of what was asked for. Two POSTs to
 * one path that differ only in `?dry_run=1` are different requests, and hashing them
 * identically would let the first one's response be replayed for the second.
 */
function targetOf(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

/**
 * The request body as the fingerprint sees it.
 *
 * Parsed when it is JSON, so that `{"a":1,"b":2}` and `{"b":2,"a":1}` are one request
 * rather than two — which is the entire point of hashing the canonical form. A body that
 * is not JSON at all is hashed as the string it is.
 */
function bodyOf(raw: string): unknown {
  if (raw === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Fingerprint a request (ADR-011 D13: `{household_id, user_id, method, path, body}`).
 *
 * Uses the contract's own `idempotencyFingerprintInput` and `payloadSha256Hex` — the same
 * RFC 8785 canonicalization approval payloads use — rather than a second hashing scheme.
 * Tenant and principal isolation are properties of the *input*, not of the query: two
 * households cannot produce one fingerprint because their ids are inside the hashed
 * payload, and the storage lookup is scoped again by RLS on top of that.
 *
 * The canonical profile rejects non-integer numbers (money is integer cents by contract).
 * A body carrying a float is a client bug that the handler's schema will answer with a
 * 400 — but the fingerprint has to be computed *before* the handler runs, so this falls
 * back to hashing the raw text rather than turning that 400 into a 500. The fallback is
 * still deterministic, so such a request still deduplicates correctly on its way to being
 * rejected.
 */
export function fingerprintOf(input: {
  householdId: string;
  userId: string;
  method: string;
  path: string;
  rawBody: string;
}): string {
  const scope = {
    householdId: input.householdId,
    userId: input.userId,
    method: input.method,
    path: input.path,
  };
  try {
    return payloadSha256Hex(idempotencyFingerprintInput({ ...scope, body: bodyOf(input.rawBody) }));
  } catch (cause) {
    if (cause instanceof CanonicalizationError) {
      return payloadSha256Hex(idempotencyFingerprintInput({ ...scope, body: input.rawBody }));
    }
    throw cause;
  }
}

/**
 * Everything the boundary persists of a response, and nothing else.
 *
 * "Replay verbatim" (ADR-011 D13) is a statement about what the *caller* receives: the
 * same status, the same bytes of body, and the same headers the handler chose — a
 * `Location` on a 201 being the one that matters. It is not a statement about headers
 * that describe *this* delivery of it. The correlation id is the clear case: `traceId` is
 * generated per request and applied by `authenticated()` after this wrapper returns, so a
 * replay carries the trace of the request being answered now. Replaying the original's
 * would make two distinct requests indistinguishable in the logs, which is the opposite
 * of what a correlation id is for.
 */
async function captureOf(response: Response): Promise<{
  status: number;
  body: string;
  headers: Record<string, string>;
}> {
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) {
    if (!NEVER_STORED.has(name.toLowerCase())) headers[name] = value;
  }
  return { status: response.status, body: await response.clone().text(), headers };
}

/**
 * Rebuild a stored response.
 *
 * `idempotent-replay` is additive: it says how this delivery was produced without
 * altering the canonical response, which is what the contract fixes. A client that
 * ignores it — every client we have — sees exactly the first response.
 */
function replayOf(row: ClaimRow): Response {
  const status = row.response_status ?? 200;
  const response = new Response(status === 204 || row.response_body === null ? null : row.response_body, {
    status,
    headers: row.response_headers ?? {},
  });
  response.headers.set("idempotent-replay", "true");
  return response;
}

/**
 * Claim the key, or discover why we cannot.
 *
 * ATOMICITY LIVES IN THIS STATEMENT, not in application code. `INSERT … ON CONFLICT DO
 * UPDATE` against the unique index takes the row lock and *waits* for a competing
 * transaction to finish — unlike `DO NOTHING`, which skips and leaves the loser unable to
 * see the winner's uncommitted row. So of two simultaneous identical requests:
 *
 *   winner  inserts, sees its own `id` returned, owns the claim, executes the handler
 *   loser   waits, then reads the winner's committed row and answers from it — 409 while
 *           the winner is still in flight, or the stored response once it is not
 *
 * Ownership is decided by comparing the returned `id` to the one generated here rather
 * than by reading `xmax`: an id we chose is unambiguous, and does not depend on a system
 * column's behaviour under subtransactions.
 *
 * The DELETE ahead of it is the expiry sweep. It clears this principal's lapsed rows —
 * both the one we are about to reuse (so the unique index is free) and any others, which
 * keeps the table bounded by live traffic rather than by cumulative history.
 */
async function claim(
  tx: ScopedClient,
  args: { id: string; ctx: RequestContext; key: string; method: string; path: string; fingerprint: string },
): Promise<ClaimRow | undefined> {
  await tx.$queryRaw`
    DELETE FROM idempotency_keys
    WHERE household_id = ${args.ctx.householdId}::uuid
      AND user_id = ${args.ctx.userId}::uuid
      AND expires_at <= now()
  `;
  const rows = await tx.$queryRaw<ClaimRow[]>`
    INSERT INTO idempotency_keys
      (id, household_id, user_id, key, method, path, fingerprint, state, expires_at)
    VALUES
      (${args.id}::uuid, ${args.ctx.householdId}::uuid, ${args.ctx.userId}::uuid,
       ${args.key}, ${args.method}, ${args.path}, ${args.fingerprint},
       'in_flight'::"IdempotencyState", now() + ${RETENTION}::interval)
    ON CONFLICT (household_id, user_id, key)
      DO UPDATE SET method = idempotency_keys.method
    RETURNING id::text AS id, fingerprint, state::text AS state,
              response_status, response_body, response_headers
  `;
  return rows[0];
}

/**
 * Run `execute` at most once per honored key.
 *
 * THREE TRANSACTIONS, AND THE CLAIM COMMITS FIRST
 * ------------------------------------------------
 * This is worth stating plainly because it is easy to describe wrongly. The claim is its
 * own transaction and it COMMITS before the handler starts — it has to, or a concurrent
 * duplicate could not see it and the whole mechanism would be a no-op. Nothing that
 * happens later can roll it back.
 *
 *   tx1  claim        `in_flight` row, committed
 *   ---  handler      opens its OWN `withHousehold` transaction, commits or rolls back
 *   tx2  settle       marks `completed`, or DELETEs the row
 *
 * So a claim is never *rolled back*. It is released by a COMPENSATING DELETE in tx2. The
 * handler's rollback is not the mechanism; it is the justification for why deleting is
 * safe — Prisma rolls a `$transaction` back when its callback rejects, so a throw that
 * escapes a handler means its domain write did not survive, and there is nothing a retry
 * could duplicate.
 *
 * FAILURE SEMANTICS, CHOSEN SO THAT NO PATH DUPLICATES A MUTATION
 * ---------------------------------------------------------------
 *   handler throws              RELEASED. A retry re-executes. Storing the failure would
 *                               memoize a transient 503 for a day, which would block
 *                               every ordinary retry of a request that never happened.
 *   handler answers >= 400      RELEASED, for the same reason: a 4xx/5xx is not an
 *                               outcome worth replaying for 24 hours, and the mutation it
 *                               reports did not complete. Only a success is stored.
 *   handler succeeds, tx2 fails The row stays `in_flight`, so a retry answers 409 and
 *                               never re-executes — fail-closed. The RESPONSE IS STILL
 *                               RETURNED: the mutation committed, and answering 500 for
 *                               work that succeeded would be a lie told to the client and
 *                               a duplicate invited from it.
 *   process dies mid-handler    The row stays `in_flight` and fails closed until it
 *                               expires. An `in_flight` row is NEVER reclaimed early: a
 *                               crash after the domain commit and a crash before it leave
 *                               the same record, so reclaiming is indistinguishable from
 *                               permitting a duplicate. 409 for the remainder of the
 *                               retention is the price of never being wrong here.
 *   database unreachable        The claim itself throws and the request fails, which it
 *                               would have done anyway: the handler needs that database.
 *
 * The one case this boundary cannot compensate for is a handler that commits its domain
 * write and *then* throws or reports failure — releasing the claim would let a retry
 * duplicate it. That is not a gap this layer can close from outside, and it is already
 * ruled out by `withHousehold`'s own contract: the scoped unit of work IS the
 * transaction. `handler-commits-then-fails` is tested below so the behaviour is recorded
 * rather than assumed.
 */
export async function withIdempotency(
  input: IdempotencyInput,
  execute: () => Promise<Response>,
): Promise<Response> {
  const { request, ctx, db, traceId, route } = input;
  if (idempotencyDisposition(request.method) !== "honored") return execute();

  const supplied = request.headers.get(IDEMPOTENCY_HEADER);
  // A POST without a key is a POST: the header is how a caller opts in, and nothing in
  // the contract requires one. `apiFetch` always sends it; a third-party client need not.
  if (supplied === null) return execute();

  const parsed = IdempotencyKeySchema.safeParse(supplied);
  if (!parsed.success) {
    return problemResponse("validation", {
      detail: "Idempotency-Key must be between 1 and 255 characters.",
    });
  }
  const key = parsed.data;

  const path = targetOf(request);
  // Cloned so the handler still gets an unread body — this wrapper reads it first only to
  // fingerprint it.
  const rawBody = await request.clone().text();
  const fingerprint = fingerprintOf({
    householdId: ctx.householdId,
    userId: ctx.userId,
    method: request.method,
    path,
    rawBody,
  });

  const id = uuidv7();
  const existing = await db.withHousehold(ctx.householdId, (tx) =>
    claim(tx, { id, ctx, key, method: request.method, path, fingerprint }),
  );

  const record = (event: string, level: "info" | "warn", status: number) =>
    log({
      // Deliberately carries no key, no fingerprint, no body: a replayable response is
      // household data, and an idempotency key is a capability to fetch it.
      event,
      level,
      traceId,
      route,
      method: request.method,
      household: householdRef(ctx.householdId),
      status,
    });

  if (existing !== undefined && existing.id !== id) {
    if (existing.fingerprint !== fingerprint) {
      record("http.idempotency_conflict", "warn", 409);
      return problemResponse("conflict", {
        detail: "This Idempotency-Key was already used for a different request.",
      });
    }
    if (existing.state === "completed") {
      record("http.idempotent_replay", "info", existing.response_status ?? 200);
      return replayOf(existing);
    }
    record("http.idempotency_in_flight", "warn", 409);
    return problemResponse("conflict", {
      detail: "An identical request is still being processed. Retry shortly.",
    });
  }

  let response: Response;
  try {
    response = await execute();
  } catch (cause) {
    await release(db, ctx, id).catch(() => {
      // A failed release leaves the row `in_flight`, which fails closed. It must not
      // replace the handler's error with a storage error — the caller needs to know what
      // actually went wrong.
    });
    throw cause;
  }

  // Only a success is worth replaying. A handler that answers 4xx or 5xx reports a
  // mutation that did not complete, and memoizing it would answer every retry for the
  // next 24 hours with the same failure — including the transient ones a retry exists to
  // get past. Released instead, so an ordinary retry behaves like a first attempt.
  if (response.status >= 400) {
    await release(db, ctx, id).catch(() => {
      // Fails closed to `in_flight`; must not replace the handler's answer.
    });
    return response;
  }

  const captured = await captureOf(response);
  try {
    await db.withHousehold(ctx.householdId, (tx) =>
      tx.$queryRaw`
        UPDATE idempotency_keys
        SET state = 'completed'::"IdempotencyState",
            response_status = ${captured.status},
            response_body = ${captured.body},
            response_headers = ${JSON.stringify(captured.headers)}::jsonb,
            completed_at = now()
        WHERE id = ${id}::uuid
          AND household_id = ${ctx.householdId}::uuid
          AND user_id = ${ctx.userId}::uuid
          AND state = 'in_flight'::"IdempotencyState"
      `,
    );
  } catch (cause) {
    // THE MUTATION COMMITTED. Only the record of it did not.
    //
    // Rethrowing here would turn a successful write into a 500, which is worse than
    // useless: it tells the client the work failed, and the client's natural response to
    // that — retry — is the duplicate this whole module exists to prevent. So the caller
    // gets the answer they earned, and the row is left `in_flight`, which makes a retry
    // a 409 rather than a second mutation.
    log({
      event: "http.idempotency_persist_failed",
      level: "error",
      traceId,
      route,
      method: request.method,
      household: householdRef(ctx.householdId),
      status: captured.status,
      error: cause,
      stack: true,
    });
  }
  return response;
}

/**
 * Release a claim, by deleting it.
 *
 * A COMPENSATING WRITE, NOT A ROLLBACK — the claim committed in its own transaction long
 * before this runs. Guarded on `in_flight` so that a record which somehow reached
 * `completed` is never removed by a late failure path.
 */
async function release(db: Database, ctx: RequestContext, id: string): Promise<void> {
  await db.withHousehold(ctx.householdId, (tx) =>
    tx.$queryRaw`
      DELETE FROM idempotency_keys
      WHERE id = ${id}::uuid
        AND household_id = ${ctx.householdId}::uuid
        AND user_id = ${ctx.userId}::uuid
        AND state = 'in_flight'::"IdempotencyState"
    `,
  );
}
