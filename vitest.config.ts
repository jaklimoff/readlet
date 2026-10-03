import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["readlet-source"] },
  // Node tests run in the SSR environment, which has its own conditions.
  ssr: { resolve: { conditions: ["readlet-source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/core/src/model/**"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
