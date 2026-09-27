import type { NextConfig } from "next";
import { join } from "node:path";

/**
 * The dedicated TEST billing runtime (ADR-020 hosted amendment): route handlers only, no
 * pages, no client bundle of consequence. Deployed to its own Vercel project so its Stripe
 * TEST credentials and app_billing_test connection never share an environment with the web
 * runtime. Tracing root is the workspace, as for apps/web, so the Prisma engine and the
 * workspace packages are copied into each function.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Cache-Control", value: "no-store" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    ] }];
  },
};

export default nextConfig;
