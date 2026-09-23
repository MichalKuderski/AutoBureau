import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tier: real Postgres, real HTTP objects, no DOM.
 *
 * Separate from `vitest.config.ts` because the two tiers disagree on everything that
 * matters — environment (node vs happy-dom), what counts as available (a database), and
 * whether files may run in parallel (they share one database, so they may not).
 */
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.integration.test.ts"],
    // One database, shared fixtures: parallel files would race each other.
    fileParallelism: false,
    hookTimeout: 120_000,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
