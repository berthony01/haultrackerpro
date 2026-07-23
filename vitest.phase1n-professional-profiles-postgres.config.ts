import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Phase 1N-D — dedicated Vitest config for the real PostgreSQL 16 gate on the
 * shared professional-profile foundation candidate.
 *
 * Runs ONLY
 *   `tests/postgres/phase1nProfessionalProfilesPostgres.test.ts`.
 *
 * The default `bunx vitest run` never picks this file up (it lives outside
 * `src/`), and this config never picks up any other suite. Executes serially
 * against a single Postgres 16 instance so RLS, GRANT and pg_catalog proofs
 * cannot race each other. No retries, no passWithNoTests — a missing or
 * skipped suite fails the gate.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/postgres/phase1nProfessionalProfilesPostgres.test.ts',
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
