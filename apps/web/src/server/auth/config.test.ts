import { describe, expect, it } from "vitest";
import { AuthConfigError, authConfigFromEnv } from "./config";

/**
 * `APP_ORIGIN` on Vercel previews.
 *
 * Doc 09 §9.3 requires preview to derive its origin from `VERCEL_URL` rather than pin a
 * literal, because the value is compared against by the CSRF check and every preview has a
 * different host — a preview carrying production's origin rejects its own form posts.
 * Configuration cannot express that (a Vercel env var is a literal; `$VERCEL_URL` is not
 * interpolated), so it is derived here, and these tests are the fence around it.
 *
 * The security shape matters more than the convenience: the derivation must never widen the
 * accepted origin for a deployment that is served on a real domain, and must never take its
 * answer from anything a requester controls.
 */

/** `NODE_ENV` is required by this project's augmented `ProcessEnv`, so every case carries it. */
const BASE: Record<string, string | undefined> = {
  NODE_ENV: "test",
  AUTH_ISSUER: "https://example.supabase.co/auth/v1",
  AUTH_AUDIENCE: "authenticated",
  AUTH_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
  AUTH_API_URL: "https://example.supabase.co/auth/v1",
  AUTH_ANON_KEY: "publishable-key",
  AUTH_COOKIE_NAME: "ab_session",
};

const env = (extra: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({ ...BASE, ...extra }) as NodeJS.ProcessEnv;

describe("APP_ORIGIN · an explicit value is always authoritative", () => {
  it("uses APP_ORIGIN when set, on any platform", () => {
    const config = authConfigFromEnv(env({ APP_ORIGIN: "https://app.autobureau.com" }));
    expect(config.allowedOrigins).toEqual(["https://app.autobureau.com"]);
  });

  it("prefers an explicit APP_ORIGIN over VERCEL_URL even on a preview", () => {
    // The deployment URL is reachable, but it is not the origin this deployment is served
    // on when an operator has named one. Deriving here would silently disagree with the
    // domain the browser actually posts from.
    const config = authConfigFromEnv(
      env({
        APP_ORIGIN: "https://staging.autobureau.com",
        VERCEL_ENV: "preview",
        VERCEL_URL: "autobureau-abc123.vercel.app",
      }),
    );
    expect(config.allowedOrigins).toEqual(["https://staging.autobureau.com"]);
  });

  it("treats a blank APP_ORIGIN as unset rather than as an empty origin", () => {
    expect(() => authConfigFromEnv(env({ APP_ORIGIN: "   " }))).toThrow(AuthConfigError);
  });
});

describe("APP_ORIGIN · preview derives from the platform, and only preview", () => {
  it("derives https://$VERCEL_URL on a preview deployment", () => {
    const config = authConfigFromEnv(
      env({ VERCEL_ENV: "preview", VERCEL_URL: "autobureau-abc123.vercel.app" }),
    );
    expect(config.allowedOrigins).toEqual(["https://autobureau-abc123.vercel.app"]);
  });

  it("fails closed on production rather than accepting the deployment URL", () => {
    // The important negative. A production deployment that lost APP_ORIGIN must return the
    // existing unconfigured-boundary 503, not quietly trust its *.vercel.app hostname and
    // then reject every form post from the real domain.
    expect(() =>
      authConfigFromEnv(env({ VERCEL_ENV: "production", VERCEL_URL: "autobureau.vercel.app" })),
    ).toThrow(AuthConfigError);
  });

  it("fails closed for development and for any unrecognised VERCEL_ENV", () => {
    for (const vercelEnv of ["development", "staging", "PREVIEW", ""]) {
      expect(() =>
        authConfigFromEnv(env({ VERCEL_ENV: vercelEnv, VERCEL_URL: "host.vercel.app" })),
      ).toThrow(AuthConfigError);
    }
  });

  it("fails closed off Vercel entirely, where neither variable is injected", () => {
    expect(() => authConfigFromEnv(env({}))).toThrow(AuthConfigError);
  });

  it("fails closed when VERCEL_ENV says preview but VERCEL_URL is absent or blank", () => {
    expect(() => authConfigFromEnv(env({ VERCEL_ENV: "preview" }))).toThrow(AuthConfigError);
    expect(() => authConfigFromEnv(env({ VERCEL_ENV: "preview", VERCEL_URL: "  " }))).toThrow(
      AuthConfigError,
    );
  });
});

describe("APP_ORIGIN · the derived origin is a single, exact origin", () => {
  it("never widens the accepted set beyond one entry", () => {
    const config = authConfigFromEnv(
      env({ VERCEL_ENV: "preview", VERCEL_URL: "autobureau-abc123.vercel.app" }),
    );
    expect(config.allowedOrigins).toHaveLength(1);
  });

  it("produces an origin with no path, so it can only match by exact origin", () => {
    const [origin] = authConfigFromEnv(
      env({ VERCEL_ENV: "preview", VERCEL_URL: "autobureau-abc123.vercel.app" }),
    ).allowedOrigins;
    expect(new URL(origin as string).origin).toBe(origin);
    expect(origin).not.toMatch(/\/$/);
  });

  it("is always https, never a scheme taken from configuration", () => {
    const [origin] = authConfigFromEnv(
      env({ VERCEL_ENV: "preview", VERCEL_URL: "autobureau-abc123.vercel.app" }),
    ).allowedOrigins;
    expect(origin).toMatch(/^https:\/\//);
  });
});

describe("the rest of the boundary still refuses to start half-configured", () => {
  it.each(["AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_JWKS_URL", "AUTH_API_URL", "AUTH_ANON_KEY", "AUTH_COOKIE_NAME"])(
    "throws when %s is missing",
    (key) => {
      const incomplete: Record<string, string | undefined> = {
        ...BASE,
        APP_ORIGIN: "https://app.autobureau.com",
      };
      delete incomplete[key];
      expect(() => authConfigFromEnv(incomplete as NodeJS.ProcessEnv)).toThrow(AuthConfigError);
    },
  );
});
