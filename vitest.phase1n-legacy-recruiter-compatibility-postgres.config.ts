import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Phase 1N-E1 — dedicated Vitest config for the real PostgreSQL 16 gate on
 * the legacy recruiter compatibility candidate. Runs ONLY
 *   `tests/postgres/phase1nLegacyRecruiterCompatibilityPostgres.test.ts`.
 *
 * The default `bunx vitest run` never picks up this file (it lives outside
 * `src/`), and this config never picks up any other suite. Executes serially
 * so RLS, GRANT, pg_catalog and concurrency proofs cannot race. No retries,
 * no passWithNoTests — a missing or skipped suite fails the gate.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/postgres/phase1nLegacyRecruiterCompatibilityPostgres.test.ts',
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
