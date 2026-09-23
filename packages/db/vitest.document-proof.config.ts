import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// One DB module instance: audit AsyncLocalStorage must not split between src/dist.
export default defineConfig({resolve:{alias:{"@":fileURLToPath(new URL("../../apps/web/src",import.meta.url)),"@autobureau/db":fileURLToPath(new URL("./src/index.ts",import.meta.url))}},test:{environment:"node",include:["tests/local/*.proof.ts"],fileParallelism:false,testTimeout:90000,hookTimeout:120000}});
