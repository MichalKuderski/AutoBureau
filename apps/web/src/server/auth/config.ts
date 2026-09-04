import type { JwksSource } from "./jwt";

/**
 * Boundary configuration, read from the environment (ADR-009 D2/D7).
 *
 * Named `AUTH_*` rather than `SUPABASE_*` on purpose. Doc 14 commits to keeping auth
 * JWT-compatible so a migration to GoTrue or a WorkOS-style provider is possible
 * "without token-format change"; a provider-shaped variable name is the first thing that
 * quietly breaks that promise. Supabase populates these values; it is not named by them.
 *
 * Every field is required and there are no defaults. A boundary that starts with a
 * guessed issuer or a guessed cookie name is a boundary that verifies nothing.
 */

export interface AuthConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwks: JwksSource;
  readonly cookieName: string;
  readonly allowedOrigins: readonly string[];
  readonly algorithms: readonly string[];
  /** GoTrue REST base. Separate from `issuer` so a provider swap can move one and not the other. */
  readonly apiUrl: string;
  /**
   * The provider's publishable key. Not a secret — GoTrue requires it as `apikey` on
   * every REST call — but it is still read from configuration rather than compiled in,
   * because it differs per environment. The `service_role` key is deliberately absent:
   * no request-path code may hold it (doc 06 §5).
   */
  readonly anonKey: string;
  /** The refresh token gets its own cookie, and therefore its own name. */
  readonly refreshCookieName: string;
}

export class AuthConfigError extends Error {
  override readonly name = "AuthConfigError";
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new AuthConfigError(
      `${key} is not set. The authenticated boundary cannot start without it.`,
    );
  }
  return value.trim();
}

/**
 * This deployment's own origin, for the CSRF comparison.
 *
 * Doc 09 §9.3 requires that "preview configuration must derive it from Vercel's
 * `VERCEL_URL` rather than pin a literal — a preview that claims production's origin
 * rejects its own form posts", and `.env.example` §94 repeats it. Neither could be
 * honoured by configuration alone: a Vercel environment variable is a literal string and
 * `$VERCEL_URL` in its value is not interpolated, so every preview shares one stored
 * value while each has a different host. The derivation has to happen here, and
 * `sentry.ts` already reads `VERCEL_ENV` on the same premise — a platform-injected
 * variable is configuration, not request data.
 *
 * WHY THIS IS NOT THE HOST HEADER MISTAKE
 * ---------------------------------------
 * `VERCEL_URL` is injected into the runtime by the platform and is fixed for the life of
 * the deployment. A requester cannot influence it: it arrives with the process, not with
 * the request, so nothing a caller sends can widen the accepted origin set. That is the
 * whole difference from trusting `Host`, which is attacker-supplied on every request.
 *
 * TWO GUARDS, BOTH DELIBERATE
 * ---------------------------
 * An explicit `APP_ORIGIN` always wins, so production and staging keep the literal custom
 * domain they are actually served on. And the fallback is gated on `VERCEL_ENV` being
 * exactly `preview`, so a production deployment whose `APP_ORIGIN` went missing fails
 * closed — 503, the existing unconfigured-boundary behaviour — rather than quietly
 * accepting its `*.vercel.app` deployment URL as its origin and diverging from the domain
 * users actually post from.
 */
function appOrigin(env: NodeJS.ProcessEnv): string {
  const explicit = env["APP_ORIGIN"];
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim();

  if (env["VERCEL_ENV"] === "preview") {
    const host = env["VERCEL_URL"]?.trim();
    // Host only, no scheme — Vercel previews are HTTPS-only, so the scheme is not a guess.
    if (host !== undefined && host !== "") return `https://${host}`;
  }

  throw new AuthConfigError(
    "APP_ORIGIN is not set. The authenticated boundary cannot start without it.",
  );
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const cookieName = required(env, "AUTH_COOKIE_NAME");
  return {
    issuer: required(env, "AUTH_ISSUER"),
    audience: required(env, "AUTH_AUDIENCE"),
    jwks: { uri: required(env, "AUTH_JWKS_URL") },
    cookieName,
    refreshCookieName: `${cookieName}_refresh`,
    apiUrl: required(env, "AUTH_API_URL").replace(/\/+$/, ""),
    anonKey: required(env, "AUTH_ANON_KEY"),
    allowedOrigins: [appOrigin(env)],
    // Pinned here rather than read from the environment: an operator who can widen the
    // accepted algorithm set through configuration can reintroduce algorithm confusion
    // without a code review.
    algorithms: ["RS256", "ES256"],
  };
}
