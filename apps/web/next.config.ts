import type { NextConfig } from "next";

/**
 * The constant security headers (doc 12 §4).
 *
 * These are set here rather than in middleware so they apply to every response including
 * the static assets the middleware matcher skips — `nosniff` and HSTS earn their keep on
 * an asset response, so they belong where nothing can route around them.
 *
 * **Content-Security-Policy is not in this list, and cannot be.** It is built per request
 * in `src/server/http/csp.ts` and applied by `src/middleware.ts`, because it carries a
 * per-request nonce and this function is evaluated once at build time. A previous version
 * of this comment claimed the policy was nonce-based while the emitted header read
 * `script-src 'self' 'unsafe-inline'`; see ADR-010 for what changed and why.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@autobureau/contracts"],
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
