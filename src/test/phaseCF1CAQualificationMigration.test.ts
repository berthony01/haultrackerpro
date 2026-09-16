import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase CF-1C-A — candidate migration scope contract (static, file-read only).
 */

const CANDIDATE = resolve(
  process.cwd(),
  'supabase/migration-candidates/20260916070000_phase_cf1c_a_structured_qualification_foundation.sql',
);

const sql = () => readFileSync(CANDIDATE, 'utf8');

const executableLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));

describe('CF-1C-A structured qualification candidate migration', () => {
  it('1) candidate exists and is marked NOT APPLIED LIVE', () => {
    expect(existsSync(CANDIDATE)).toBe(true);
    expect(sql().split('\n')[0]).toBe('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.');
  });

  it('2) is now recorded as a promoted production migration', () => {
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'supabase/migrations/20260916070000_phase_cf1c_a_structured_qualification_foundation.sql',
        ),
      ),
    ).toBe(true);
  });

  it('3) is exactly one transaction', () => {
    const lines = executableLines(sql());
    expect(lines.filter((l) => l === 'BEGIN;')).toHaveLength(1);
    expect(lines.filter((l) => l === 'COMMIT;')).toHaveLength(1);
    expect(lines[0]).toBe('BEGIN;');
    expect(lines[lines.length - 1]).toBe('COMMIT;');
  });

  it('4) only alters public.opportunities', () => {
    const body = executableLines(sql()).join('\n');
    const altered = body.match(/ALTER TABLE\s+([a-z_.]+)/gi) ?? [];
    expect(altered.length).toBeGreaterThan(0);
    for (const statement of altered) {
      expect(statement).toMatch(/ALTER TABLE\s+public\.opportunities/i);
    }
  });

  it('5) adds exactly the three structured criteria columns', () => {
    const body = executableLines(sql()).join('\n');
    const added = body.match(/ADD COLUMN[^,;]*/gi) ?? [];
    expect(added).toHaveLength(3);
    expect(body).toContain('ADD COLUMN IF NOT EXISTS min_years_experience numeric NULL');
    expect(body).toContain('ADD COLUMN IF NOT EXISTS required_cdl_class text NULL');
    expect(body).toContain(
      "ADD COLUMN IF NOT EXISTS required_endorsements text[] NOT NULL DEFAULT '{}'::text[]",
    );
  });

  it('6) constrains experience to NULL or >= 0', () => {
    expect(sql()).toContain(
      'CHECK (min_years_experience IS NULL OR min_years_experience >= 0)',
    );
  });

  it('7) constrains CDL class to NULL or exactly A/B/C', () => {
    expect(sql()).toContain(
      "CHECK (required_cdl_class IS NULL OR required_cdl_class IN ('A', 'B', 'C'))",
    );
  });

  it('8) constrains endorsements to non-NULL entries within H,N,P,S,T,X', () => {
    const text = sql();
    expect(text).toContain('array_position(required_endorsements, NULL) IS NULL');
    expect(text).toContain(
      "required_endorsements <@ ARRAY['H', 'N', 'P', 'S', 'T', 'X']::text[]",
    );
  });

  it('9) performs no backfill or any data write', () => {
    const body = executableLines(sql()).toString().toUpperCase();
    for (const forbidden of ['UPDATE ', 'INSERT INTO', 'DELETE FROM', 'TRUNCATE', 'MERGE ']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('10) changes no RLS, policy, grant, function, trigger, index, enum, or table lifecycle', () => {
    const body = executableLines(sql()).toString().toUpperCase();
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

  it('11) touches no billing, Telegram, application, conversation, or auth surface', () => {
    const body = executableLines(sql()).toString().toLowerCase();
    for (const forbidden of [
      'stripe',
      'subscription',
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

  it('12) leaves the free-text requirements column untouched', () => {
    const body = executableLines(sql()).join('\n');
    expect(body).not.toMatch(/\brequirements\b/);
  });
});
