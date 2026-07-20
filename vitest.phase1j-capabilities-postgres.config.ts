import path from "node:path";
import { defineConfig } from "vitest/config";

// Phase 1J-A — dedicated real-PostgreSQL 16 gate for additive user
// capability foundation. The normal Vitest run never touches PostgreSQL;
// this config exists so the PG16 file fails hard when the DB URL is
// absent instead of being silently skipped.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/postgres/phase1jAdditiveCapabilitiesPostgres.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
