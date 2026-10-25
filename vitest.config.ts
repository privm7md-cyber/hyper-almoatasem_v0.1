import { defineConfig } from "vitest/config";
import path from "node:path";

// FE-1 foundation tests: jsdom component + utility tests only. No network, no DB.
// JSX is transformed by vitest's built-in esbuild (automatic runtime); no extra plugin needed.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Test-only swap so jsdom unit tests can import server modules' logic
      // without tripping the RSC guard. See vitest.server-only-stub.cjs.
      "server-only": path.resolve(__dirname, "vitest.server-only-stub.cjs"),
    },
  },  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
