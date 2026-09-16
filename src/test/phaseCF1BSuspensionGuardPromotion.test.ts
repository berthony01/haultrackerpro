import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase CF-1B-R1 — migration promotion parity.
 *
 * The suspension-guard candidate was applied live manually. This suite records
 * source-control parity only: the production migration file must be a
 * byte-identical copy of the candidate, and must remain scoped to the single
 * authorization function.
 */

const CANDIDATE = resolve(
  process.cwd(),
  'supabase/migration-candidates/20260916063000_phase_cf1b_conversation_suspension_guard.sql',
);
const PRODUCTION = resolve(
  process.cwd(),
  'supabase/migrations/20260916063000_phase_cf1b_conversation_suspension_guard.sql',
);

const executableLines = (sql: string): string[] =>
  sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));

describe('CF-1B-R1 suspension guard migration promotion', () => {
  it('1) candidate file still exists in place', () => {
    expect(existsSync(CANDIDATE)).toBe(true);
  });

  it('2) production migration copy exists', () => {
    expect(existsSync(PRODUCTION)).toBe(true);
  });

  it('3) candidate and production copies are exactly string-equal', () => {
    expect(readFileSync(PRODUCTION, 'utf8')).toBe(readFileSync(CANDIDATE, 'utf8'));
  });

  it('4) candidate and production copies are exactly byte-equal (UTF-8)', () => {
    const a = readFileSync(CANDIDATE);
    const b = readFileSync(PRODUCTION);
    expect(b.length).toBe(a.length);
    expect(b.equals(a)).toBe(true);
  });

  it('5) production copy has exactly one executable BEGIN and one COMMIT', () => {
    const lines = executableLines(readFileSync(PRODUCTION, 'utf8'));
    expect(lines.filter((l) => /^BEGIN;$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /^COMMIT;$/.test(l))).toHaveLength(1);
    expect(lines[0]).toBe('BEGIN;');
    expect(lines[lines.length - 1]).toBe('COMMIT;');
  });

  it('6) production copy creates/replaces only current_user_can_conversation_action', () => {
    const sql = readFileSync(PRODUCTION, 'utf8');
    const created = sql.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi) ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/public\.current_user_can_conversation_action/);
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.current_user_can_conversation_action(',
    );
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
  });

  it('7) recruiter availability helper is present and gates recruiter authority', () => {
    const sql = readFileSync(PRODUCTION, 'utf8');
    expect(sql).toContain('public.recruiter_profile_can_manage_opportunities(_t.recruiter_id)');
    expect(sql).toContain('IF NOT _recruiter_available THEN');
    const availabilityIndex = sql.indexOf('IF NOT _recruiter_available THEN');
    const permissionIndex = sql.indexOf('current_user_has_recruiter_permission');
    expect(availabilityIndex).toBeGreaterThan(-1);
    expect(availabilityIndex).toBeLessThan(permissionIndex);
  });

  it('8) admin shortcut is view-only with no blanket bypass', () => {
    const sql = readFileSync(PRODUCTION, 'utf8');
    expect(sql).toContain("IF _action = 'view' AND public.is_admin(_uid) THEN");
    expect(sql.match(/public\.is_admin\(/g) ?? []).toHaveLength(1);
    expect(sql).not.toMatch(/IF\s+public\.is_admin\(_uid\)\s+THEN\s+RETURN\s+true/);
  });

  it('9) contains no table, policy, enum, trigger, index, or data statements', () => {
    const sql = readFileSync(PRODUCTION, 'utf8').toUpperCase();
    for (const forbidden of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE POLICY',
      'DROP POLICY',
      'ALTER POLICY',
      'CREATE TYPE',
      'ALTER TYPE',
      'CREATE TRIGGER',
      'DROP TRIGGER',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'DROP INDEX',
      'INSERT INTO',
      'UPDATE ',
      'DELETE FROM',
      'TRUNCATE',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('10) function execution grants are restated exactly', () => {
    const sql = readFileSync(PRODUCTION, 'utf8');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.current_user_can_conversation_action(uuid, text) FROM PUBLIC;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.current_user_can_conversation_action(uuid, text) FROM anon;',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.current_user_can_conversation_action(uuid, text) TO authenticated;',
    );
  });
});
