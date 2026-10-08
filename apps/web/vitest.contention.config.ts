import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
/** Opt-in disposable loopback experiment, never the default test suite. */
export default defineConfig({test:{environment:"node",include:["src/test/dashboard-contention.probe.ts"],fileParallelism:false,testTimeout:40000,hookTimeout:30000},resolve:{alias:{"@":fileURLToPath(new URL("./src",import.meta.url))}}});
