/**
 * Phase 1K-D1A — dedicated Vitest config for the real PostgreSQL 16 gate on
 * the historical opportunity repair reconciliation.
 *
 * Runs ONLY `tests/postgres/phase1kHistoricalOpportunityRepairPostgres.test.ts`.
 * The default `bunx vitest run` never picks this file up (it lives outside
 * `src/`), and this config never picks up any other suite.
 *
 * Executes serially against a single Postgres 16 instance so repair,
 * visibility, and catalog proofs cannot race each other. No retries, no
 * passWithNoTests — a missing or skipped suite fails the gate.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/postgres/phase1kHistoricalOpportunityRepairPostgres.test.ts',
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
