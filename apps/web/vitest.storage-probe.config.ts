import { defineConfig } from "vitest/config";
/** Explicit native Vercel synthetic probe only; never selected by ordinary tests. */
export default defineConfig({ test: { environment: "node", include: ["src/server/storage/quarantine.live-probe.ts"],
  fileParallelism: false, testTimeout: 180_000 } });
