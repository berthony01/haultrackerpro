/**
 * Phase CF-1B-R1 — static contract for the conversation recruiter-availability
 * (suspension) guard candidate migration.
 *
 * File-read only. Proves the candidate changes exactly one function, fails
 * closed on recruiter availability before any recruiter-side authority, keeps
 * admin view-only, and preserves the CF-1A permission semantics and grants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const CANDIDATE =
  'supabase/migration-candidates/20260916063000_phase_cf1b_conversation_suspension_guard.sql';
const sql = readFileSync(resolve(ROOT, CANDIDATE), 'utf8');

describe('CF-1B-R1 / candidate scope', () => {
  it('1a is marked as a non-applied candidate', () => {
    expect(sql.split('\n')[0]).toContain('CANDIDATE MIGRATION — NOT APPLIED LIVE.');
  });

  it('1b wraps exactly one transaction', () => {
    const lines = sql.split('\n').map((l) => l.trim());
    expect(lines.filter((l) => l === 'BEGIN;')).toHaveLength(1);
    expect(lines.filter((l) => l === 'COMMIT;')).toHaveLength(1);
  });

  it('1c creates or replaces only current_user_can_conversation_action', () => {
    const creates = sql.match(/CREATE (OR REPLACE )?FUNCTION\s+public\.(\w+)/g) ?? [];
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain('public.current_user_can_conversation_action');
  });

  it('1d touches no table, policy, enum, trigger, or data', () => {
    for (const forbidden of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE POLICY',
      'DROP POLICY',
      'CREATE TYPE',
      'ALTER TYPE',
      'CREATE TRIGGER',
      'INSERT INTO',
      'UPDATE public.',
      'DELETE FROM',
      'CREATE INDEX',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('1e preserves SECURITY DEFINER, pinned search_path, and exact grants', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
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

describe('CF-1B-R1 / authorization contract', () => {
  const body = sql.slice(sql.indexOf('$function$'), sql.lastIndexOf('$function$'));

  it('2a admin remains view-only with no blanket bypass', () => {
    expect(body).toContain("IF _action = 'view' AND public.is_admin(_uid) THEN");
    expect(body.match(/public\.is_admin\(/g) ?? []).toHaveLength(1);
    expect(body).not.toMatch(/IF\s+public\.is_admin\(_uid\)\s+THEN\s+RETURN true/);
  });

  it('2b resolves recruiter availability through the canonical helper only', () => {
    expect(body).toContain('public.recruiter_profile_can_manage_opportunities(_t.recruiter_id)');
    expect(
      body.match(/public\.recruiter_profile_can_manage_opportunities\(/g) ?? [],
    ).toHaveLength(1);
    expect(body).toContain('_recruiter_available');
  });

  it('2c recruiter-side authority is gated before any permission resolution', () => {
    const gate = body.indexOf('IF NOT _recruiter_available THEN');
    const firstPerm = body.indexOf('current_user_has_recruiter_permission');
    expect(gate).toBeGreaterThan(-1);
    expect(firstPerm).toBeGreaterThan(gate);
  });

  it('2d driver reply requires recruiter availability', () => {
    const driverBranch = body.slice(
      body.indexOf('IF _t.driver_user_id = _uid THEN'),
      body.indexOf('-- Recruiter side'),
    );
    const replyClause = driverBranch.slice(driverBranch.indexOf("ELSIF _action = 'reply'"));
    expect(replyClause).toContain('_recruiter_available');
    expect(replyClause).toContain('user_has_blocking_messaging_restriction(_uid)');
  });

  it('2e driver view and close remain preserved regardless of availability', () => {
    const driverBranch = body.slice(
      body.indexOf('IF _t.driver_user_id = _uid THEN'),
      body.indexOf('-- Recruiter side'),
    );
    const viewClause = driverBranch.slice(
      driverBranch.indexOf("IF _action = 'view'"),
      driverBranch.indexOf("ELSIF _action = 'reply'"),
    );
    expect(viewClause).toContain('RETURN true;');
    expect(viewClause).not.toContain('_recruiter_available');
    const closeClause = driverBranch.slice(driverBranch.indexOf("ELSIF _action = 'close'"));
    expect(closeClause).toContain("_t.status IN ('requested','active')");
    expect(closeClause).not.toContain('_recruiter_available');
  });

  it('2f conversations_view / conversations_reply semantics are intact', () => {
    expect(body).toContain("'conversations_view'::public.recruiter_workspace_permission");
    expect(body).toContain("'conversations_reply'::public.recruiter_workspace_permission");
    const recruiterBranch = body.slice(body.indexOf('-- Recruiter side'));
    const viewIdx = recruiterBranch.indexOf("'conversations_view'");
    const replyIdx = recruiterBranch.indexOf("'conversations_reply'");
    expect(viewIdx).toBeLessThan(replyIdx);
    expect(recruiterBranch).toContain("RETURN _t.status = 'active'");
    expect(recruiterBranch).toContain("ELSIF _action IN ('accept','decline','close') THEN");
  });

  it('2g participant rows remain non-authoritative and identity is server-derived', () => {
    expect(body).not.toContain('conversation_participants');
    expect(body).toContain('_uid uuid := auth.uid();');
    expect(body).not.toMatch(/_actor_user_id|_caller_id\s+uuid\s*:?=\s*\$/);
  });

  it('2h fails closed on missing thread or unauthenticated caller', () => {
    expect(body).toContain('IF _uid IS NULL OR _thread_id IS NULL OR _action IS NULL THEN');
    expect(body).toContain('IF NOT FOUND THEN');
    expect(body.trimEnd().endsWith('RETURN false;\nEND;')).toBe(true);
  });

  it('2i introduces no Telegram / Stripe / billing / application coupling', () => {
    const lower = sql.toLowerCase();
    for (const forbidden of [
      'telegram',
      'stripe',
      'subscription',
      'opportunity_applications',
      'application_events',
      'settlement',
      'referral',
    ]) {
      expect(lower).not.toContain(forbidden);
    }
  });
});
