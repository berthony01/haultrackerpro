import path from "node:path";
import { defineConfig } from "vitest/config";

// Dedicated real-PostgreSQL gate for Phase 1H-M2. Includes only the
// Phase 1H-M2 offer-workflow real-Postgres suite so the normal Vitest
// run never contacts PostgreSQL and never reports a skipped DB test.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/postgres/phase1hM2OfferWorkflowPostgres.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
