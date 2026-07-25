import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Phase 1P-A1.1-R1 — dedicated Vitest config for the real PostgreSQL 16 gate
 * on the recruiter readiness + company type + conditional DOT/MC candidate.
 * Runs ONLY
 *   `tests/postgres/phase1pA1CompanyTypeConditionalDotMcPostgres.test.ts`.
 *
 * The default `bunx vitest run` never picks up this file (it lives outside
 * `src/`) and this config never picks up any other suite. Runs serially so
 * catalog/GRANT/RLS proofs cannot race. No retries, no passWithNoTests.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/postgres/phase1pA1CompanyTypeConditionalDotMcPostgres.test.ts',
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
