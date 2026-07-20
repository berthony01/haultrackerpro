/**
 * Phase 1J-D2B-1 — dedicated Vitest config for the real PostgreSQL 16 gate on
 * the recruiter paid-plan entitlement resolver.
 *
 * Runs ONLY `tests/postgres/phase1jD2B1RecruiterPaidEntitlementPostgres.test.ts`.
 * The default `bunx vitest run` never picks this file up (it lives outside
 * `src/`), and this config never picks up any other suite.
 *
 * Executes serially against a single Postgres 16 instance so ACL, session,
 * and rollback proofs cannot race each other. No retries, no passWithNoTests
 * — a missing or skipped suite fails the gate.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/postgres/phase1jD2B1RecruiterPaidEntitlementPostgres.test.ts',
    ],
    fileParallelism: false,
    retry: 0,
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
