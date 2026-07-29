import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The app compiles JSX through Next's SWC pipeline; the test runner needs the same
  // automatic runtime told to it explicitly, or component tests fail on a bare
  // "React is not defined".
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
