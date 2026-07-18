import path from "node:path";
import { defineConfig } from "vitest/config";

// Dedicated real-PostgreSQL gate for Phase 1G-R1A3. This config includes only
// the Recruiter Checkout concurrency suite, so the normal Vitest run never
// contacts PostgreSQL and never reports a skipped database test.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/postgres/recruiterCheckoutConcurrency.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
