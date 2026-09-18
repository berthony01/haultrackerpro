/**
 * Phase RB-3A-0A — dedicated Vitest config for the real PostgreSQL gate on the
 * canonical opportunity creation boundary.
 *
 * Runs ONLY
 *   `tests/postgres/phaseRB3a0aCanonicalOpportunityCreationPostgres.test.ts`.
 *
 * The default `bunx vitest run` never picks this file up (it lives outside
 * `src/`), and this config never picks up any other suite. Serial execution,
 * no retries, no passWithNoTests — a missing or skipped suite fails the gate.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/postgres/phaseRB3a0aCanonicalOpportunityCreationPostgres.test.ts',
    ],
    fileParallelism: false,
    retry: 0,
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
