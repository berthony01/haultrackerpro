/**
 * Phase RC-1J-C — Recruiter Team Authorization (focused contract tests).
 *
 * Asserts EXECUTABLE SQL and source behavior. Comments alone can never satisfy
 * these assertions: every SQL assertion is made against a comment-stripped
 * projection of the candidate migration.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MIGRATION = path.join(
  ROOT,
  'supabase/migration-candidates/20260816150000_phase_rc1j_c_recruiter_team_authorization.sql',
);
const HOOK = path.join(ROOT, 'src/hooks/recruiter/useRecruiterStaffPermissions.ts');

const rawSql = fs.readFileSync(MIGRATION, 'utf8');
const hookSrc = fs.readFileSync(HOOK, 'utf8');

/** Comment-stripped executable projection of the migration. */
const sql = rawSql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `function ${name} must be defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function countDefs(name: string): number {
  return sql.split(`CREATE OR REPLACE FUNCTION public.${name}(`).length - 1;
}

describe('RC-1J-C — file allowlist', () => {
  it('the candidate migration exists at the exact locked path', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  it('no other RC-1J-C migration candidate was created', () => {
    const files = fs
      .readdirSync(path.join(ROOT, 'supabase/migration-candidates'))
      .filter((f) => f.toLowerCase().includes('rc1j_c'));
    expect(files).toEqual([
      '20260816150000_phase_rc1j_c_recruiter_team_authorization.sql',
    ]);
  });

  it('creates no tables, columns, enums, indexes or triggers', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ADD COLUMN/i);
    expect(sql).not.toMatch(/CREATE TYPE/i);
    expect(sql).not.toMatch(/ALTER TYPE/i);
    expect(sql).not.toMatch(/CREATE INDEX/i);
    expect(sql).not.toMatch(/CREATE TRIGGER/i);
  });

  it('touches no RLS policy, table grant, Stripe, Agency or UI surface', () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/DROP POLICY/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/GRANT[^\n]*\bON\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bstripe\b/i);
    expect(sql).not.toMatch(/\bagency/i);
  });
});

describe('RC-1J-C — frozen functions are not redefined', () => {
  const frozen = [
    'current_user_has_recruiter_permission',
    'get_my_recruiter_permissions',
    'list_recruiter_members',
    'accept_recruiter_member_invite',
    'is_recruiter_workspace_owner',
    'is_recruiter_workspace_member',
    'recruiter_team_seat_limit',
    'recruiter_team_occupied_seats',
    'recruiter_team_workspace_within_limit',
    'effective_recruiter_tier',
  ];

  for (const name of frozen) {
    it(`does not redefine ${name}`, () => {
      expect(sql).not.toMatch(
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i'),
      );
      expect(sql).not.toMatch(new RegExp(`CREATE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i'));
    });
  }

  it('legacy list_recruiter_members remains untouched but the safe RPC is new', () => {
    expect(countDefs('list_recruiter_members')).toBe(0);
    expect(countDefs('list_recruiter_team_members_safe')).toBe(1);
  });

  it('defines exactly the five authorized functions', () => {
    const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)].map(
      (m) => m[1],
    );
    expect(defs.sort()).toEqual(
      [
        'current_user_can_recruiter_team_action',
        'invite_recruiter_member',
        'list_recruiter_team_members_safe',
        'revoke_recruiter_member',
        'set_recruiter_member_permissions',
        'set_recruiter_member_role',
      ].sort(),
    );
  });
});

describe('RC-1J-C — team action helper', () => {
  const body = fnBody('current_user_can_recruiter_team_action');

  it('is STABLE SECURITY DEFINER with search_path public', () => {
    expect(body).toMatch(/STABLE/);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = public/);
  });

  it('accepts ONLY team_view and team_manage', () => {
    expect(body).toMatch(/_permission NOT IN \('team_view', 'team_manage'\)[\s\S]*RETURN false/);
  });

  it('owner is implicitly true and never seat-gated', () => {
    expect(body).toMatch(
      /IF public\.is_recruiter_workspace_owner\(_recruiter_id\) THEN\s+RETURN true;/,
    );
  });

  it('non-owner team_view resolves through the central resolver only', () => {
    expect(body).toMatch(
      /IF _permission = 'team_view' THEN\s+RETURN public\.current_user_has_recruiter_permission\(_recruiter_id, 'team_view'\);/,
    );
  });

  it('team_manage requires BOTH team_view and team_manage', () => {
    expect(body).toMatch(
      /RETURN public\.current_user_has_recruiter_permission\(_recruiter_id, 'team_view'\)\s*\n?\s*AND public\.current_user_has_recruiter_permission\(_recruiter_id, 'team_manage'\);/,
    );
  });

  it('has no role shortcut and no billing/seat logic', () => {
    expect(body).not.toMatch(/recruiter_admin/);
    expect(body).not.toMatch(/recruiter_billing_profiles/);
    expect(body).not.toMatch(/recruiter_team_(seat_limit|occupied_seats|workspace_within_limit)/);
  });
});

describe('RC-1J-C — safe team list RPC', () => {
  const body = fnBody('list_recruiter_team_members_safe');

  it('requires the team_view action', () => {
    expect(body).toMatch(
      /IF NOT public\.current_user_can_recruiter_team_action\(_recruiter_id, 'team_view'\) THEN[\s\S]*?42501/,
    );
  });

  it('exposes exactly the locked field list', () => {
    const cols = body
      .slice(body.indexOf('RETURNS TABLE ('), body.indexOf(')\nLANGUAGE'))
      .match(/^\s{2}([a-z_]+)\s/gm)!
      .map((s) => s.trim());
    expect(cols).toEqual([
      'membership_id',
      'member_user_id',
      'invite_email',
      'member_role',
      'member_status',
      'permissions',
      'invited_at',
      'accepted_at',
      'revoked_at',
      'invite_expires_at',
    ]);
  });

  it('never exposes token hash, revoked_by, auth.users, billing or audit data', () => {
    expect(body).not.toMatch(/invite_token_hash/);
    expect(body).not.toMatch(/revoked_by_user_id/);
    expect(body).not.toMatch(/auth\.users/);
    expect(body).not.toMatch(/recruiter_billing_profiles/);
    expect(body).not.toMatch(/recruiter_member_audit_log/);
    expect(body).not.toMatch(/recruiter_profiles/);
  });

  it('returns all rows including revoked history in a deterministic order', () => {
    const where = body.slice(body.indexOf('WHERE m.recruiter_id'), body.indexOf('ORDER BY'));
    expect(where).not.toMatch(/m\.status/);
    expect(body).toMatch(/ORDER BY \(m\.role = 'recruiter_owner'\) DESC/);
  });


  it('is granted to authenticated and service_role only', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.list_recruiter_team_members_safe\(uuid\) FROM PUBLIC, anon;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_recruiter_team_members_safe\(uuid\) TO authenticated, service_role;/,
    );
  });
});

describe('RC-1J-C — invite authorization', () => {
  const body = fnBody('invite_recruiter_member');

  it('widens authorization to owner OR team_manage', () => {
    expect(body).toMatch(
      /IF NOT _is_owner\s*\n\s*AND NOT public\.current_user_can_recruiter_team_action\(_recruiter_id, 'team_manage'\) THEN[\s\S]*?42501/,
    );
  });

  it('preserves the exact RC-1J-B email regex', () => {
    expect(body).toContain(
      "_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'",
    );
  });

  it('preserves crypto, 7-day expiry and duplicate-active behavior', () => {
    expect(body).toContain("encode(extensions.gen_random_bytes(24), 'hex')");
    expect(body).toContain("encode(extensions.digest(_raw_token, 'sha256'), 'hex')");
    expect(body).toContain("now() + interval '7 days'");
    expect(body).toMatch(/Already a member/);
  });

  it('preserves workspace-first / member-second lock order', () => {
    const profileLock = body.indexOf('FROM public.recruiter_profiles rp\n   WHERE rp.id = _recruiter_id\n   FOR UPDATE');
    const memberLock = body.indexOf('FROM public.recruiter_members m\n   WHERE m.recruiter_id = _recruiter_id\n     AND lower(m.invite_email::text) = _norm');
    expect(profileLock).toBeGreaterThan(0);
    expect(memberLock).toBeGreaterThan(profileLock);
  });

  it('preserves the direct post-lock occupied-seat recount and capacity error', () => {
    expect(body).toMatch(/SELECT 1 \+ count\(\*\)::integer INTO _occupied/);
    expect(body).toMatch(/_occupied >= _limit THEN[\s\S]*?Team seat limit reached/);
  });

  it('preserves unexpired-refresh seat exemption', () => {
    expect(body).toMatch(/_refresh_unexpired := FOUND[\s\S]*?invite_expires_at > now\(\)/);
    expect(body).toMatch(/IF NOT _refresh_unexpired THEN/);
  });

  it('still preserves owner-email rejection and rejects staff self-invite', () => {
    expect(body).toMatch(/_norm = _owner_email THEN[\s\S]*?Cannot invite the workspace owner/);
    expect(body).toMatch(
      /IF NOT _is_owner THEN[\s\S]*?_norm = _actor_email THEN[\s\S]*?'Invalid email'[\s\S]*?22023/,
    );
  });

  it('still rejects the recruiter_owner role', () => {
    expect(body).toMatch(/_role = 'recruiter_owner' THEN[\s\S]*?Invalid role/);
  });
});

describe('RC-1J-C — revoke authorization', () => {
  const body = fnBody('revoke_recruiter_member');

  it('is owner OR team_manage', () => {
    expect(body).toMatch(
      /public\.is_recruiter_workspace_owner\(m\.recruiter_id\)\s*\n\s*OR public\.current_user_can_recruiter_team_action\(m\.recruiter_id, 'team_manage'\)/,
    );
  });

  it('protects the owner membership and non-pending/active targets', () => {
    expect(body).toMatch(/m\.role <> 'recruiter_owner'/);
    expect(body).toMatch(/m\.status IN \('pending', 'active'\)/);
  });

  it('denies staff self-revoke while allowing the owner', () => {
    expect(body).toMatch(
      /IF NOT _is_owner AND _row\.member_user_id IS NOT DISTINCT FROM _uid THEN[\s\S]*?42501/,
    );
  });

  it('adds no auto-revoke behavior and preserves audit/status/token clearing', () => {
    expect(body).toMatch(/status = 'revoked'/);
    expect(body).toMatch(/invite_token_hash = NULL/);
    expect(body).toMatch(/'member_revoked'/);
    expect(body.match(/UPDATE public\.recruiter_members/g)!.length).toBe(1);
  });
});

describe('RC-1J-C — permissions setter authorization', () => {
  const body = fnBody('set_recruiter_member_permissions');

  it('is owner OR team_manage against a non-owner pending/active target', () => {
    expect(body).toMatch(
      /public\.is_recruiter_workspace_owner\(m\.recruiter_id\)\s*\n\s*OR public\.current_user_can_recruiter_team_action\(m\.recruiter_id, 'team_manage'\)/,
    );
    expect(body).toMatch(/m\.role <> 'recruiter_owner'/);
    expect(body).toMatch(/m\.status IN \('pending', 'active'\)/);
  });

  it('denies staff self permission edit', () => {
    expect(body).toMatch(
      /IF NOT _is_owner AND _row\.member_user_id IS NOT DISTINCT FROM _uid THEN[\s\S]*?42501/,
    );
  });

  it('preserves unknown-key and non-boolean payload rejection', () => {
    expect(body).toMatch(/Unknown permission key/);
    expect(body).toMatch(/Permission value must be boolean/);
    expect(body).toMatch(/jsonb_typeof\(_permissions\) <> 'object'/);
  });

  it('applies the subset restriction only to false/missing -> true transitions', () => {
    expect(body).toMatch(
      /IF _v = to_jsonb\(true\)\s*\n\s*AND COALESCE\(_previous -> _k, 'null'::jsonb\) <> to_jsonb\(true\) THEN/,
    );
  });

  it('requires the acting staff manager to hold the newly granted permission', () => {
    expect(body).toMatch(
      /IF NOT public\.current_user_has_recruiter_permission\([\s\S]*?_k::public\.recruiter_workspace_permission[\s\S]*?Cannot grant permission you do not hold' USING ERRCODE = '42501'/,
    );
  });

  it('runs the subset restriction for staff only — owner bypasses it', () => {
    const guard = body.indexOf('IF NOT _is_owner THEN\n    FOR _k, _v IN SELECT key, value FROM jsonb_each(_canonical)');
    expect(guard).toBeGreaterThan(0);
  });

  it('is evaluated after canonicalization and previous capture', () => {
    expect(body.indexOf('_previous := _row.permissions;')).toBeLessThan(
      body.indexOf('Cannot grant permission you do not hold'),
    );
    expect(body.indexOf('_canonical := _canonical || jsonb_build_object(_k, _v);')).toBeLessThan(
      body.indexOf('Cannot grant permission you do not hold'),
    );
  });

  it('preserves the permissions_updated audit and return shape', () => {
    expect(body).toMatch(/'permissions_updated'/);
    expect(body).toMatch(/'previous_permissions'/);
    expect(body).toMatch(/'new_permissions'/);
    expect(body).toMatch(/'permissions', _row\.permissions/);
  });
});

describe('RC-1J-C — role setter', () => {
  const body = fnBody('set_recruiter_member_role');

  it('rejects the recruiter_owner role label', () => {
    expect(body).toMatch(/_role = 'recruiter_owner' THEN[\s\S]*?Invalid role[\s\S]*?22023/);
  });

  it('is owner OR team_manage and never targets the owner membership', () => {
    expect(body).toMatch(
      /public\.is_recruiter_workspace_owner\(m\.recruiter_id\)\s*\n\s*OR public\.current_user_can_recruiter_team_action\(m\.recruiter_id, 'team_manage'\)/,
    );
    expect(body).toMatch(/m\.role <> 'recruiter_owner'/);
    expect(body).toMatch(/m\.status IN \('pending', 'active'\)/);
  });

  it('denies staff self role change', () => {
    expect(body).toMatch(
      /IF NOT _is_owner AND _row\.member_user_id IS NOT DISTINCT FROM _uid THEN[\s\S]*?42501/,
    );
  });

  it('never alters permissions', () => {
    expect(body).not.toMatch(/SET[\s\S]*permissions\s*=/);
    expect(body).toMatch(/SET role = _role,\s*\n\s*updated_at = now\(\)/);
  });

  it('returns the safe JSON shape only', () => {
    const ret = body.slice(body.indexOf('RETURN jsonb_build_object('));
    expect(ret).toMatch(/'membership_id'/);
    expect(ret).toMatch(/'recruiter_id'/);
    expect(ret).toMatch(/'role'/);
    expect(ret).toMatch(/'status'/);
    expect(ret).toMatch(/'updated_at'/);
    expect(ret).not.toMatch(/permissions/);
    expect(ret).not.toMatch(/invite_token/);
  });

  it('writes one role_updated audit event with previous/new role', () => {
    expect(body).toMatch(/'role_updated'/);
    expect(body).toMatch(/'previous_role', _previous_role/);
    expect(body).toMatch(/'new_role', _row\.role::text/);
  });

  it('is granted to authenticated and service_role only', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.set_recruiter_member_role\(uuid, public\.recruiter_member_role\) FROM PUBLIC, anon;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.set_recruiter_member_role\(uuid, public\.recruiter_member_role\) TO authenticated, service_role;/,
    );
  });
});

describe('RC-1J-C — audit event allowlist', () => {
  it('extends the check constraint to exactly seven events', () => {
    const block = sql.slice(
      sql.indexOf('ADD CONSTRAINT recruiter_member_audit_log_event_type_check'),
    );
    const list = block.slice(0, block.indexOf('));'));
    const events = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(events).toEqual([
      'owner_bootstrapped',
      'invite_created',
      'invite_refreshed',
      'invite_accepted',
      'member_revoked',
      'permissions_updated',
      'role_updated',
    ]);
  });

  it('makes no other audit schema change', () => {
    const alters = [...sql.matchAll(/ALTER TABLE public\.([a-z_]+)/g)].map((m) => m[1]);
    expect([...new Set(alters)]).toEqual(['recruiter_member_audit_log']);
  });
});

describe('RC-1J-C — existing surface ACLs remain unchanged', () => {
  it('invite / revoke / set-permissions stay authenticated-only, never anon', () => {
    for (const sig of [
      'public.invite_recruiter_member(uuid, text, public.recruiter_member_role)',
      'public.revoke_recruiter_member(uuid)',
      'public.set_recruiter_member_permissions(uuid, jsonb)',
    ]) {
      const esc = sig.replace(/[.()]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${esc} FROM PUBLIC, anon;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc} TO authenticated;`));
    }
    expect(sql).not.toMatch(/GRANT[^\n]*TO[^\n]*\banon\b/);
  });
});

describe('RC-1J-C — client UX boolean exposure', () => {
  it('declares canViewTeam and canManageTeam on the hook state', () => {
    expect(hookSrc).toMatch(/canViewTeam:\s*boolean;/);
    expect(hookSrc).toMatch(/canManageTeam:\s*boolean;/);
  });

  it('canViewTeam fails closed on team_view', () => {
    expect(hookSrc).toMatch(/canViewTeam:\s*granted && permissions\.team_view === true,/);
  });

  it('canManageTeam requires BOTH team_view and team_manage', () => {
    expect(hookSrc).toMatch(
      /canManageTeam:\s*\n?\s*granted && permissions\.team_view === true && permissions\.team_manage === true,/,
    );
  });

  it('adds no new RPC, query or Team UI to the hook', () => {
    expect(hookSrc).not.toMatch(/list_recruiter_team_members_safe/);
    expect(hookSrc).not.toMatch(/set_recruiter_member_role/);
    expect(
      hookSrc.match(/callGetMyRecruiterPermissions\(/g)!.length,
    ).toBe(1);
  });
});
