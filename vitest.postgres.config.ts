import { defineConfig } from "vitest/config";
import path from "path";

// Dedicated Vitest config for the real-PostgreSQL R1B gate.
// Runs ONLY tests under tests/postgres/**. Kept fully separate from the
// normal jsdom suite so the standard `bunx vitest run` never touches Postgres
// and reports zero skipped tests.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/postgres/recruiterConsentConcurrency.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
