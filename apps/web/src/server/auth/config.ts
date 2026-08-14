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

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  return {
    issuer: required(env, "AUTH_ISSUER"),
    audience: required(env, "AUTH_AUDIENCE"),
    jwks: { uri: required(env, "AUTH_JWKS_URL") },
    cookieName: required(env, "AUTH_COOKIE_NAME"),
    allowedOrigins: [required(env, "APP_ORIGIN")],
    // Pinned here rather than read from the environment: an operator who can widen the
    // accepted algorithm set through configuration can reintroduce algorithm confusion
    // without a code review.
    algorithms: ["RS256", "ES256"],
  };
}
