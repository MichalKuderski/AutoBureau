import { createDatabase, runAsUser, type Database } from "@autobureau/db";
import { createJwtVerifier } from "../auth/jwt";
import { AuthConfigError, authConfigFromEnv, type AuthConfig } from "../auth/config";
import {
  RequestContextError,
  membershipsVia,
  resolveRequestContext,
  type RequestContext,
} from "../auth/context";
import { ForbiddenError, assertCan, type Capability } from "../auth/policy";
import { CsrfError, assertSameSiteRequest } from "./csrf";
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
 * Lazily built so a missing environment variable becomes a 503 on the first request
 * rather than a crash at module load — which would take the whole deployment down,
 * including the pages that need no authentication at all.
 */
let cached: { config: AuthConfig; db: Database } | null = null;

function boundaryDeps(options: AuthenticatedRouteOptions): { config: AuthConfig; db: Database } {
  if (options.config && options.db) return { config: options.config, db: options.db };
  if (!cached) {
    const config = options.config ?? authConfigFromEnv();
    const url = process.env["DATABASE_URL"];
    if (url === undefined || url.trim() === "") {
      throw new AuthConfigError("DATABASE_URL is not set.");
    }
    cached = { config, db: options.db ?? createDatabase(url) };
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
    let deps: { config: AuthConfig; db: Database };
    try {
      deps = boundaryDeps(options);
    } catch (cause) {
      if (cause instanceof AuthConfigError) {
        // Deliberately not `internal`: the deployment is misconfigured, not broken, and
        // the detail names no variable — configuration is not a client's business.
        return problemResponse("unavailable", {
          detail: "Authentication is not configured on this deployment.",
        });
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

      if (options.requires) assertCan(ctx, options.requires);

      const payload = await runAsUser(ctx.userId, () =>
        handler({ request, ctx, db: deps.db }),
      );
      return jsonResponse(payload ?? null);
    } catch (cause) {
      return toProblem(cause);
    }
  };
}

function toProblem(cause: unknown): Response {
  if (cause instanceof CsrfError) {
    return problemResponse("forbidden", { detail: "This request could not be verified." });
  }
  if (cause instanceof RequestContextError) {
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
    return problemResponse("forbidden", { detail: "Your role does not allow that." });
  }
  // Never surfaced: an unexpected throw could carry a query, a row, or a connection
  // string in its message.
  if (process.env.NODE_ENV !== "production") console.error("[v1]", cause);
  return problemResponse("internal");
}
