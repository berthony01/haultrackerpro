import path from "node:path";
import { defineConfig } from "vitest/config";

// Dedicated real-PostgreSQL gate for Phase 1R-D2-B2-A. This config includes
// only the business checkout claim concurrency suite, so the normal Vitest run
// never contacts PostgreSQL and never reports a skipped database test.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/postgres/businessCheckoutClaimsConcurrency.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
