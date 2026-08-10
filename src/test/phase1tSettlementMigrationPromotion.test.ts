import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase 1T — settlement candidate-promotion acceptance suite.
 *
 * Static, file-read-only. No network, no database, no PGlite. It proves that the
 * 12 accepted Phase 1T settlement candidates were promoted into managed
 * migrations with byte-identical executable bodies and FILE-only headers.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const CANDIDATE_DIR = 'supabase/migration-candidates';
const MIGRATION_DIR = 'supabase/migrations';

const PRIOR_MANAGED_MIGRATION =
  '20260806052000_phase1s_a2_agency_paid_plan_enforcement.sql';

/** Exact promotion set, in the exact required dependency order. */
const PHASE_1T_BASENAMES = [
  '20260808161500_phase1t_b1_settlement_schema.sql',
  '20260808163500_phase1t_b2a_settlement_authorization_helpers.sql',
  '20260808165000_phase1t_b2b_settlement_read_rls.sql',
  '20260808170500_phase1t_b2c1_carrier_driver_relationship_rpcs.sql',
  '20260808172000_phase1t_b2c2a_settlement_draft_header_rpcs.sql',
  '20260808173500_phase1t_b2c3a_settlement_item_rpcs.sql',
  '20260808175000_phase1t_b2c4a_settlement_load_match_rpcs.sql',
  '20260808180500_phase1t_b2c4b_settlement_load_match_suggestions.sql',
  '20260808182000_phase1t_b2c4c_settlement_load_match_rejection.sql',
  '20260808183500_phase1t_b2c5a_settlement_finalization.sql',
  '20260808185000_phase1t_b2c5b_settlement_void.sql',
  '20260808190500_phase1t_b2c5c_settlement_correction_supersede.sql',
] as const;

const candidatePath = (base: string) => resolve(REPO_ROOT, CANDIDATE_DIR, base);
const migrationPath = (base: string) => resolve(REPO_ROOT, MIGRATION_DIR, base);

const readText = (path: string) => readFileSync(path, 'utf8');
const readBytes = (path: string) => readFileSync(path);

/** Executable body: first exact `BEGIN;` line through the last exact `COMMIT;` line. */
function executableBody(text: string): string {
  const lines = text.split('\n');
  const begin = lines.findIndex((l) => l === 'BEGIN;');
  const commit = lines.reduce(
    (acc, l, i) => (l === 'COMMIT;' ? i : acc),
    -1,
  );
  expect(begin, 'exact-line BEGIN; must exist').toBeGreaterThanOrEqual(0);
  expect(commit, 'exact-line COMMIT; must exist').toBeGreaterThan(begin);
  return lines.slice(begin, commit + 1).join('\n');
}

function countExactLines(text: string, needle: string): number {
  return text.split('\n').filter((l) => l === needle).length;
}

describe('Phase 1T — settlement migration promotion', () => {
  it('1. all 12 source candidates still exist at the accepted candidate paths', () => {
    for (const base of PHASE_1T_BASENAMES) {
      expect(existsSync(candidatePath(base)), `${CANDIDATE_DIR}/${base}`).toBe(true);
    }
    expect(PHASE_1T_BASENAMES.length).toBe(12);
  });

  it('2. all 12 active migrations exist under supabase/migrations/', () => {
    for (const base of PHASE_1T_BASENAMES) {
      expect(existsSync(migrationPath(base)), `${MIGRATION_DIR}/${base}`).toBe(true);
    }
  });

  it('3. executable bodies are string- and byte-identical candidate vs active', () => {
    for (const base of PHASE_1T_BASENAMES) {
      const candidateBody = executableBody(readText(candidatePath(base)));
      const activeBody = executableBody(readText(migrationPath(base)));

      expect(activeBody, `string equality for ${base}`).toBe(candidateBody);
      expect(
        Buffer.from(activeBody, 'utf8').equals(Buffer.from(candidateBody, 'utf8')),
        `utf-8 byte equality for ${base}`,
      ).toBe(true);
      expect(activeBody.length).toBeGreaterThan(0);
    }
  });

  it('4. every candidate and active migration has exactly one BEGIN; and one COMMIT; line', () => {
    for (const base of PHASE_1T_BASENAMES) {
      for (const path of [candidatePath(base), migrationPath(base)]) {
        const text = readText(path);
        expect(countExactLines(text, 'BEGIN;'), `BEGIN; count in ${path}`).toBe(1);
        expect(countExactLines(text, 'COMMIT;'), `COMMIT; count in ${path}`).toBe(1);
      }
    }
  });

  it('5. each active header references its candidate path and states FILE-only / not applied', () => {
    for (const base of PHASE_1T_BASENAMES) {
      const text = readText(migrationPath(base));
      const header = text.slice(0, text.indexOf('\nBEGIN;'));

      expect(header, `candidate path reference in ${base}`).toContain(
        `${CANDIDATE_DIR}/${base}`,
      );
      expect(header.toLowerCase()).toContain('phase 1t');
      expect(header.toLowerCase()).toContain('promotion');
      expect(header).toMatch(/FILE only/i);
      expect(header).toMatch(/NOT\s*\n?--\s*applied|is NOT/i);
      expect(header.toLowerCase()).toContain('production');
      expect(header.toLowerCase()).toContain('connected database');
    }
  });

  it('6. the 12 Phase 1T active basenames sort in the exact dependency order', () => {
    const sorted = [...PHASE_1T_BASENAMES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sorted).toEqual([...PHASE_1T_BASENAMES]);
  });

  it('7. all 12 timestamps are later than the prior managed migration', () => {
    const priorTs = PRIOR_MANAGED_MIGRATION.slice(0, 14);
    expect(existsSync(migrationPath(PRIOR_MANAGED_MIGRATION))).toBe(true);

    for (const base of PHASE_1T_BASENAMES) {
      const ts = base.slice(0, 14);
      expect(/^\d{14}$/.test(ts), `numeric timestamp for ${base}`).toBe(true);
      expect(Number(ts), `${base} later than ${PRIOR_MANAGED_MIGRATION}`).toBeGreaterThan(
        Number(priorTs),
      );
    }
  });

  it('8. exactly the 12 promoted files are the managed phase1t_ migrations', () => {
    const managed = readdirSync(resolve(REPO_ROOT, MIGRATION_DIR)).filter((f) =>
      f.includes('phase1t_'),
    );
    expect(managed.length).toBe(12);
    expect([...managed].sort()).toEqual([...PHASE_1T_BASENAMES].sort());
    expect(new Set(managed).size).toBe(12);
  });

  it('9. candidates remain under supabase/migration-candidates/ after promotion', () => {
    const candidates = readdirSync(resolve(REPO_ROOT, CANDIDATE_DIR)).filter((f) =>
      f.includes('phase1t_'),
    );
    for (const base of PHASE_1T_BASENAMES) {
      expect(candidates).toContain(base);
    }
  });

  it('10. no focused/skipped tests or snapshot assertions in this suite', () => {
    const self = readText(resolve(__dirname, 'phase1tSettlementMigrationPromotion.test.ts'));
    for (const forbidden of [
      'it.only',
      'describe.only',
      'test.only',
      'it.skip',
      'describe.skip',
      'test.skip',
      'it.todo',
      'test.todo',
      'fit(',
      'fdescribe(',
      'toMatchSnapshot',
      'toMatchInlineSnapshot',
    ]) {
      expect(self.includes(forbidden), `forbidden token ${forbidden}`).toBe(false);
    }
  });
});
