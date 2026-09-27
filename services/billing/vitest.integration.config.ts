import { defineConfig } from "vitest/config";

/** Real Postgres, one shared database: files may not run in parallel. */
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.integration.test.ts"], fileParallelism: false, hookTimeout: 120_000 },
});
