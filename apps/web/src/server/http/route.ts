import { runAsUser, type Database } from "@autobureau/db";
import { createJwtVerifier } from "../auth/jwt";
import { AuthConfigError, authConfigFromEnv, type AuthConfig } from "../auth/config";
import { DatabaseConfigError, getDatabase } from "../db";
import {
  RequestContextError,
  membershipsVia,
  resolveRequestContext,
  type RequestContext,
} from "../auth/context";
import { ForbiddenError, assertCan, type Capability } from "../auth/policy";
import { CsrfError, assertSameSiteRequest } from "./csrf";
import {
  householdRef,
  log,
  routeOf,
  traceIdFrom,
  withTraceHeader,
} from "../observability";
import { jsonResponse, problemResponse } from "./problem";

/**
 * The `/v1` request boundary (ADR-009 D1–D5).
 *
 * THE ORDER IS THE CONTRACT
 * -------------------------
 *   1. CSRF          — cheapest, needs no identity and no database
 *   2. identity      — the verified token's subject, never a header
 *   3. household     — the candidate validated against membership (D1)
 *   4. authorization — centralized `can()`, before any data is touched
 *   5. attribution   — `runAsUser`, so every mutation the handler makes is attributed
 *   6. handler       — which opens `withHousehold` with an already-validated id
 *
 * Nothing below step 3 can run for a request that failed it, so a rejected request never
 * opens a household scope (A7). Handlers receive a context and never re-derive identity
 * (doc 06 §2); they cannot reach the request's headers for it because they are not given
 * the means to interpret them.
 */

export interface HandlerInput {
  readonly request: Request;
  readonly ctx: RequestContext;
  readonly db: Database;
}

export interface AuthenticatedRouteOptions {
  /** Checked before the handler runs. Omit only for endpoints every role may reach. */
  readonly requires?: Capability;
  /** Injected by tests; production reads the environment. */
  readonly config?: AuthConfig;
  /** Injected by tests; production opens a connection from `DATABASE_URL`. */
  readonly db?: Database;
}

export type RouteHandler = (input: HandlerInput) => Promise<unknown>;

/**
 * A response a handler wants shaped rather than defaulted (ADR-011).
 *
 * Returning a plain value still means "200 with this body", which is what every existing
 * handler does and keeps doing. This exists for the cases that ADR-011 fixes a status
 * for — 201 with a `Location`, 202 for work that has only been accepted, 204 for a
 * delete — because a handler previously had no way to say any of them.
 *
 * A class rather than a tagged object: a domain payload that happened to carry `status`
 * and `body` keys would otherwise be silently reinterpreted as an envelope, and the
 * failure would be a 204 where a resource was meant to be.
 */
export class RouteResponse {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {}
}

/** 201 with the created representation. `Location` when the resource has a URL. */
export function created(body: unknown, location?: string): RouteResponse {
  return new RouteResponse(201, body, location === undefined ? {} : { location });
}

/** 202: accepted, not done. The body carries whatever handle tracks the work. */
export function accepted(body: unknown): RouteResponse {
  return new RouteResponse(202, body);
}

/** 204: nothing to say. Used by DELETE, which says it by having succeeded. */
export function noContent(): RouteResponse {
  return new RouteResponse(204, undefined);
}

/**
 * Lazily built so a missing environment variable becomes a 503 on the first request
 * rather than a crash at module load — which would take the whole deployment down,
 * including the pages that need no authentication at all.
 */
let cached: { config: AuthConfig; db: Database } | null = null;

function boundaryDeps(options: AuthenticatedRouteOptions): { config: AuthConfig; db: Database } {
  if (options.config && options.db) return { config: options.config, db: options.db };
  if (!cached) {
    const config = options.config ?? authConfigFromEnv();
    cached = { config, db: options.db ?? getDatabase() };
  }
  return cached;
}

/** Test seam: the module-level cache would otherwise outlive a config change. */
export function resetBoundaryCache(): void {
  cached = null;
}

export function authenticated(
  options: AuthenticatedRouteOptions,
  handler: RouteHandler,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // Established before anything else so that every outcome below — including a
    // misconfigured deployment — is attributable. Reads headers only; no check moves.
    const traceId = traceIdFrom(request);
    const route = routeOf(request);
    const method = request.method;
    // Set once the request has resolved to a household, so a failure after that point
    // says which tenant it happened to. Hashed at the point of capture (doc 10 §3).
    let household: string | undefined;

    let deps: { config: AuthConfig; db: Database };
    try {
      deps = boundaryDeps(options);
    } catch (cause) {
      if (cause instanceof AuthConfigError || cause instanceof DatabaseConfigError) {
        // Operationally useful rather than noisy: this fires when a deployment is missing
        // configuration, which is a deploy-time fault someone has to be told about.
        log({
          event: "http.not_configured",
          level: "error",
          traceId,
          route,
          method,
          status: 503,
          error: cause,
        });
        // Deliberately not `internal`: the deployment is misconfigured, not broken, and
        // the detail names no variable — configuration is not a client's business.
        return withTraceHeader(
          problemResponse("unavailable", {
            detail: "Authentication is not configured on this deployment.",
          }),
          traceId,
        );
      }
      throw cause;
    }

    try {
      assertSameSiteRequest(request, { allowedOrigins: deps.config.allowedOrigins });

      const ctx = await resolveRequestContext(request, {
        verifier: createJwtVerifier({
          jwks: deps.config.jwks,
          issuer: deps.config.issuer,
          audience: deps.config.audience,
          algorithms: deps.config.algorithms,
        }),
        memberships: membershipsVia(deps.db),
        cookieName: deps.config.cookieName,
      });

      household = householdRef(ctx.householdId);

      if (options.requires) assertCan(ctx, options.requires);

      const payload = await runAsUser(ctx.userId, () =>
        handler({ request, ctx, db: deps.db }),
      );
      // Nothing above this line moved. The only change is that a handler may now name a
      // status and headers; a plain value still means 200, exactly as before.
      return withTraceHeader(toResponse(payload), traceId);
    } catch (cause) {
      return withTraceHeader(
        toProblem(cause, { traceId, route, method, household }),
        traceId,
      );
    }
  };
}

/**
 * A handler's return value as a response.
 *
 * `no-store` and `content-type` come from `jsonResponse`, so a shaped response cannot
 * accidentally become cacheable — every `/v1` body is household data. A 204 carries no
 * body at all, which is what the status means.
 */
function toResponse(payload: unknown): Response {
  if (!(payload instanceof RouteResponse)) return jsonResponse(payload ?? null);
  if (payload.status === 204) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store", ...payload.headers },
    });
  }
  const response = jsonResponse(payload.body ?? null, payload.status);
  for (const [name, value] of Object.entries(payload.headers)) response.headers.set(name, value);
  return response;
}

/** What the error mapper needs to record a failure. Never reaches the response body. */
interface ProblemContext {
  readonly traceId: string;
  readonly route: string | undefined;
  readonly method: string | undefined;
  readonly household: string | undefined;
}

/**
 * Map a thrown value to its response, and record it once.
 *
 * The mapping below is unchanged — same predicates, same order, same statuses, same
 * details. What is new is that each branch says so out loud.
 *
 * REJECTIONS ARE `warn`, FAULTS ARE `error`.
 * A CSRF rejection or a `not-a-member` is the boundary working, not breaking: it carries
 * no stack, because there is no defect to locate, and its `error_code` is already the
 * whole story. They are recorded rather than dropped because a rejection is the signal an
 * attempt to cross a tenant boundary produces, and audit 05 found that signal to be
 * entirely absent today. An unexpected throw is the opposite — a defect, with a stack.
 */
function toProblem(cause: unknown, context: ProblemContext): Response {
  const rejection = (status: number) =>
    log({
      event: "http.rejected",
      level: "warn",
      traceId: context.traceId,
      route: context.route,
      method: context.method,
      household: context.household,
      status,
      error: cause,
    });

  if (cause instanceof CsrfError) {
    rejection(403);
    return problemResponse("forbidden", { detail: "This request could not be verified." });
  }
  if (cause instanceof RequestContextError) {
    rejection(cause.status);
    switch (cause.status) {
      case 401:
        return problemResponse("unauthorized", { detail: "Sign in to continue." });
      case 400:
        return problemResponse("validation", { detail: cause.message });
      default:
        return problemResponse("forbidden", { detail: "You don't have access to that." });
    }
  }
  if (cause instanceof ForbiddenError) {
    rejection(403);
    return problemResponse("forbidden", { detail: "Your role does not allow that." });
  }
  // Never surfaced: an unexpected throw could carry a query, a row, or a connection
  // string in its message. It is now recorded instead of discarded — the message and the
  // stack are scrubbed on the way into the record, which is why logging them is safe and
  // returning them still is not.
  log({
    event: "http.unhandled_error",
    level: "error",
    traceId: context.traceId,
    route: context.route,
    method: context.method,
    household: context.household,
    status: 500,
    error: cause,
    stack: true,
  });
  return problemResponse("internal");
}
