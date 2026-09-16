import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase CF-1C-A — candidate to production migration promotion parity.
 *
 * Static, file-read-only. No database, no network. CF-1C-A was applied live
 * manually; this suite proves the repository recording is a byte-exact copy of
 * the accepted candidate and remains scoped to the approved additive columns.
 */

const BASENAME =
  '20260916070000_phase_cf1c_a_structured_qualification_foundation.sql';

const CANDIDATE = resolve(
  process.cwd(),
  'supabase/migration-candidates',
  BASENAME,
);
const PRODUCTION = resolve(process.cwd(), 'supabase/migrations', BASENAME);

const productionSql = () => readFileSync(PRODUCTION, 'utf8');

const executableLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));

describe('CF-1C-A promotion / file placement', () => {
  it('1) candidate still exists at its accepted path', () => {
    expect(existsSync(CANDIDATE)).toBe(true);
  });

  it('2) production migration copy exists', () => {
    expect(existsSync(PRODUCTION)).toBe(true);
  });
});

describe('CF-1C-A promotion / parity', () => {
  it('3) candidate and production copies are exactly string-equal', () => {
    expect(readFileSync(PRODUCTION, 'utf8')).toBe(
      readFileSync(CANDIDATE, 'utf8'),
    );
  });

  it('4) candidate and production copies are exactly byte-equal (UTF-8)', () => {
    const a = readFileSync(CANDIDATE);
    const b = readFileSync(PRODUCTION);
    expect(b.length).toBe(a.length);
    expect(b.equals(a)).toBe(true);
    expect(b.length).toBeGreaterThan(0);
  });
});

describe('CF-1C-A promotion / production copy scope', () => {
  it('5) has exactly one executable BEGIN and one COMMIT', () => {
    const lines = executableLines(productionSql());
    expect(lines.filter((l) => l === 'BEGIN;')).toHaveLength(1);
    expect(lines.filter((l) => l === 'COMMIT;')).toHaveLength(1);
    expect(lines[0]).toBe('BEGIN;');
    expect(lines[lines.length - 1]).toBe('COMMIT;');
  });

  it('6) alters only public.opportunities', () => {
    const body = executableLines(productionSql()).join('\n');
    const altered = body.match(/ALTER TABLE\s+([a-z_.]+)/gi) ?? [];
    expect(altered.length).toBeGreaterThan(0);
    for (const statement of altered) {
      expect(statement).toMatch(/ALTER TABLE\s+public\.opportunities/i);
    }
  });

  it('7) adds exactly the three approved structured criteria columns', () => {
    const body = executableLines(productionSql()).join('\n');
    const added = body.match(/ADD COLUMN[^,;]*/gi) ?? [];
    expect(added).toHaveLength(3);
    expect(body).toContain(
      'ADD COLUMN IF NOT EXISTS min_years_experience numeric NULL',
    );
    expect(body).toContain(
      'ADD COLUMN IF NOT EXISTS required_cdl_class text NULL',
    );
    expect(body).toContain(
      "ADD COLUMN IF NOT EXISTS required_endorsements text[] NOT NULL DEFAULT '{}'::text[]",
    );
  });

  it('8) contains the three approved CHECK constraints', () => {
    const text = productionSql();
    expect(text).toContain(
      'CHECK (min_years_experience IS NULL OR min_years_experience >= 0)',
    );
    expect(text).toContain(
      "CHECK (required_cdl_class IS NULL OR required_cdl_class IN ('A', 'B', 'C'))",
    );
    expect(text).toContain('array_position(required_endorsements, NULL) IS NULL');
    expect(text).toContain(
      "required_endorsements <@ ARRAY['H', 'N', 'P', 'S', 'T', 'X']::text[]",
    );
  });

  it('9) performs no backfill or any data write', () => {
    const body = executableLines(productionSql()).toString().toUpperCase();
    for (const forbidden of [
      'UPDATE ',
      'INSERT INTO',
      'DELETE FROM',
      'TRUNCATE',
      'MERGE ',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('10) changes no RLS, policy, grant, function, trigger, index, enum, or table lifecycle', () => {
    const body = executableLines(productionSql()).toString().toUpperCase();
    for (const forbidden of [
      'ROW LEVEL SECURITY',
      'CREATE POLICY',
      'ALTER POLICY',
      'DROP POLICY',
      'GRANT ',
      'REVOKE ',
      'CREATE FUNCTION',
      'CREATE OR REPLACE FUNCTION',
      'DROP FUNCTION',
      'CREATE TRIGGER',
      'DROP TRIGGER',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'CREATE TYPE',
      'ALTER TYPE',
      'CREATE TABLE',
      'DROP TABLE',
      'DROP COLUMN',
      'ALTER COLUMN',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('11) leaves the free-text requirements column untouched', () => {
    const body = executableLines(productionSql()).join('\n');
    expect(body).not.toMatch(/\brequirements\b/);
  });

  it('12) introduces no billing, Stripe, Telegram, application, conversation, or auth coupling', () => {
    const body = executableLines(productionSql()).toString().toLowerCase();
    for (const forbidden of [
      'stripe',
      'subscription',
      'billing',
      'telegram',
      'opportunity_applications',
      'application_events',
      'conversation_',
      'auth.',
      'recruiter_members',
      'driver_opportunity_profiles',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});
