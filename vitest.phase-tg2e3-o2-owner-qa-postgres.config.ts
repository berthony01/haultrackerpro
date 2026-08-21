import { defineConfig } from 'vitest/config';

/**
 * Phase TG-2E3-O2 — real PostgreSQL gate for the Owner QA entitlement
 * candidate. Never included in the default `src/` suite.
 *
 * Requires TG2E3O2_DATABASE_URL.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/postgres/phaseTG2E3OOwnerQaPersonaPostgres.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
