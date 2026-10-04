import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside the React Server Components bundler condition.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    // Integration files share one seeded database.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/integration-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
      {
        // Brand-isolation suite (prompt 15): a required check in CI – `pnpm test:isolation`.
        extends: true,
        test: {
          name: "isolation",
          include: ["tests/isolation/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/integration-setup.ts"],
          testTimeout: 180_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
