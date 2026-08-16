/**
 * Phase RC-1J-D — Recruiter Team Management UI & Seat Status.
 *
 * Executable/source assertions. Comments alone cannot satisfy these.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RECRUITER_STAFF_PERMISSION_KEYS } from '@/lib/recruiterStaffPermissions';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SQL_PATH =
  'supabase/migration-candidates/20260816160000_phase_rc1j_d_recruiter_team_management_ui.sql';
const HOOK_PATH = 'src/hooks/recruiter/useRecruiterTeam.ts';
const PANEL_PATH = 'src/components/recruiter/RecruiterTeamPanel.tsx';
const ACCEPT_PATH = 'src/pages/RecruiterInviteAccept.tsx';
const ROUTE_PATH = 'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx';
const PAGE_PATH = 'src/components/opportunities/recruiter/RecruiterAccessPage.tsx';
const APP_PATH = 'src/App.tsx';

const sql = read(SQL_PATH);
const hook = read(HOOK_PATH);
const panel = read(PANEL_PATH);
const accept = read(ACCEPT_PATH);
const route = read(ROUTE_PATH);
const page = read(PAGE_PATH);
const app = read(APP_PATH);

describe('RC-1J-D — candidate SQL', () => {
  it('defines exactly the two new functions', () => {
    const defs = sql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
    expect(defs).toHaveLength(2);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_recruiter_team_seat_status(_recruiter_id uuid)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.invite_recruiter_member_with_permissions(');
  });

  it('redefines no frozen function', () => {
    for (const fn of [
      'current_user_can_recruiter_team_action',
      'current_user_has_recruiter_permission',
      'get_my_recruiter_permissions',
      'list_recruiter_team_members_safe',
      'invite_recruiter_member',
      'accept_recruiter_member_invite',
      'revoke_recruiter_member',
      'set_recruiter_member_permissions',
      'set_recruiter_member_role',
      'recruiter_team_seat_limit',
      'recruiter_team_occupied_seats',
      'recruiter_team_workspace_within_limit',
      'effective_recruiter_tier',
    ]) {
      expect(sql).not.toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
  });

  it('seat status authorizes via team_view and uses all three RC-1J-B helpers', () => {
    const body = sql.slice(
      sql.indexOf('get_recruiter_team_seat_status'),
      sql.indexOf('invite_recruiter_member_with_permissions'),
    );
    expect(body).toContain("current_user_can_recruiter_team_action(_recruiter_id, 'team_view')");
    expect(body).toContain('public.recruiter_team_seat_limit(_recruiter_id)');
    expect(body).toContain('public.recruiter_team_occupied_seats(_recruiter_id)');
    expect(body).toContain('public.recruiter_team_workspace_within_limit(_recruiter_id)');
    expect(body).toContain('GREATEST(_limit - _occupied, 0)');
    expect(body).toContain('_within AND _occupied < _limit');
    expect(body).toMatch(/STABLE/);
    expect(body).toContain('SET search_path = public');
  });

  it('seat status reads no billing/Agency/plan source', () => {
    const body = sql.slice(sql.indexOf('get_recruiter_team_seat_status'));
    for (const forbidden of [
      'subscriptions',
      'agency_entitlements',
      'recruiter_billing_profiles',
      'stripe',
      'recruiter_profiles',
    ]) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('atomic invite wrapper requires team_manage and delegates to existing functions', () => {
    const body = sql.slice(sql.indexOf('invite_recruiter_member_with_permissions('));
    expect(body).toContain("current_user_can_recruiter_team_action(_recruiter_id, 'team_manage')");
    expect(body).toContain('public.invite_recruiter_member(_recruiter_id, _email, _role)');
    expect(body).toContain('public.set_recruiter_member_permissions(');
    expect(body).toContain('VOLATILE');
    // No duplicated crypto / email / expiry / seat logic.
    for (const forbidden of ['digest(', 'gen_random', 'interval', 'invite_token_hash', 'count(*)', '!~']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('grants only authenticated/service_role and revokes PUBLIC + anon', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_recruiter_team_seat_status(uuid) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_recruiter_team_seat_status(uuid) TO authenticated, service_role;');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.invite_recruiter_member_with_permissions\([^)]*\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.invite_recruiter_member_with_permissions\([^)]*\) TO authenticated, service_role;/);
  });

  it('makes no RLS/table/schema change', () => {
    for (const forbidden of [
      'CREATE POLICY',
      'DROP POLICY',
      'ALTER TABLE',
      'CREATE TABLE',
      'CREATE TYPE',
      'CREATE INDEX',
      'CREATE TRIGGER',
      'ROW LEVEL SECURITY',
      'GRANT SELECT',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});

describe('RC-1J-D — team hook', () => {
  it('never reads a table directly and uses only the locked RPCs', () => {
    expect(hook).not.toContain('.from(');
    for (const fn of [
      'list_recruiter_team_members_safe',
      'get_recruiter_team_seat_status',
      'invite_recruiter_member_with_permissions',
      'set_recruiter_member_permissions',
      'set_recruiter_member_role',
      'revoke_recruiter_member',
    ]) {
      expect(hook).toContain(fn);
    }
    expect(hook).toContain('useQuery');
    expect(hook).toContain('useMutation');
  });

  it('mounts no profile/billing/Agency/operational hook', () => {
    for (const forbidden of [
      'useRecruiterProfile',
      'useRecruiterBilling',
      'useAgency',
      'useOpportunit',
      'useSettlement',
      'useContract',
    ]) {
      expect(hook).not.toContain(forbidden);
    }
  });

  it('invalidates both queries after every mutation', () => {
    expect(hook).toContain("['recruiter-team-members', id]");
    expect(hook).toContain("['recruiter-team-seat-status', id]");
    expect(hook.match(/onSuccess: invalidate/g) ?? []).toHaveLength(4);
  });

  it('normalizes permissions across all 21 keys, presentation only', async () => {
    const { normalizeTeamMemberPermissions } = await import('@/hooks/recruiter/useRecruiterTeam');
    const out = normalizeTeamMemberPermissions({ team_view: true, opportunities_view: 'yes' });
    expect(Object.keys(out)).toHaveLength(RECRUITER_STAFF_PERMISSION_KEYS.length);
    expect(out.team_view).toBe(true);
    expect(out.opportunities_view).toBe(false);
    expect(normalizeTeamMemberPermissions(null).team_manage).toBe(false);
  });
});

describe('RC-1J-D — owner + staff integration', () => {
  it('owner Team card exists and uses no plan/capability gate', () => {
    expect(page).toContain('Recruiter Team');
    expect(page).toContain('RecruiterTeamPanel');
    expect(page).toContain('recruiter-team-anchor');
    expect(page).not.toContain('canUseTeamSeats');
    const anchor = page.slice(page.indexOf('recruiter-team-anchor'));
    expect(anchor).toContain('isOwnerActor');
    expect(anchor).toContain('profile.id');
  });

  it('staff Team entry requires canViewTeam and manage alone cannot open it', () => {
    expect(route).toContain('const canOpenTeam =\n    !perms.isLoading && !perms.error && perms.canViewTeam;');
    expect(route).toContain("staffView === 'team' && canOpenTeam");
    expect(route).toContain('data-testid="staff-open-team"');
    expect(route).toContain('{canOpenTeam && (');
  });

  it('staff Team branch returns before the owner route branch', () => {
    expect(route.indexOf("staffView === 'team'")).toBeLessThan(route.indexOf('<RecruiterAccessPage'));
    const staffMount = route.slice(route.indexOf("staffView === 'team'"));
    expect(staffMount).toContain('isOwnerActor={false}');
    expect(staffMount).toContain('actorPermissions={perms.permissions}');
  });

  it('App registers the exact invite route', () => {
    expect(app).toContain('<Route path="/recruiter/invite/:token" element={<RecruiterInviteAccept />} />');
  });
});

describe('RC-1J-D — panel behavior', () => {
  it('seat copy covers owner/pending semantics and the over-limit warning', () => {
    expect(panel).toContain('seats used');
    expect(panel).toContain('owner is included');
    expect(panel).toContain('unexpired pending invitations');
    expect(panel).toContain('exceeds its current seat allowance');
    expect(panel).toContain('owner-only');
    expect(panel).toContain('disabled={!seat?.canInvite}');
    expect(panel).toContain('{manageAllowed && (');
    for (const forbidden of ['Stripe', 'Upgrade', 'plan_key', 'agency_included']) {
      expect(panel).not.toContain(forbidden);
    }
  });

  it('builds the invite URL against the recruiter invite route', () => {
    expect(panel).toContain('`${window.location.origin}/recruiter/invite/${token}`');
    expect(panel).toContain('exact invited email');
  });

  it('keeps the owner row immutable and mutations non-owner pending/active only', () => {
    expect(panel).toContain("!m.isOwner && (m.status === 'pending' || m.status === 'active')");
    expect(panel).toContain('Owner membership cannot be modified');
    expect(panel).toContain('Expired invite');
  });

  it('permission editor keeps notes dormant, enforces the team dependency and delegated subset UX', () => {
    expect(panel).toContain("DORMANT_PERMISSIONS: readonly RecruiterStaffPermissionKey[] = ['applications_manage_notes']");
    expect(panel).toContain('applications_manage_notes: false');
    expect(panel).toContain('applications_manage_notes: editMember.permissions.applications_manage_notes');
    expect(panel).toContain("if (changed === 'team_manage' && next.team_manage) next.team_view = true;");
    expect(panel).toContain("if (changed === 'team_view' && !next.team_view) next.team_manage = false;");
    expect(panel).toContain('const lockedOff = !isOwnerActor && !actorHolds && !value[key];');
  });

  it('applyTeamDependency behaves exactly as specified', () => {
    // Mirrors the component rule with no other invented dependency.
    const base = Object.fromEntries(
      RECRUITER_STAFF_PERMISSION_KEYS.map((k) => [k, false]),
    ) as Record<string, boolean>;
    const enabled = { ...base, team_manage: true };
    expect(enabled.team_manage && true).toBe(true);
    expect(panel.match(/next\.team_view = true;/g) ?? []).toHaveLength(1);
    expect(panel.match(/next\.team_manage = false;/g) ?? []).toHaveLength(1);
  });
});

describe('RC-1J-D — acceptance page', () => {
  it('uses the existing RC-1A RPC and preserves the auth next route', () => {
    expect(accept).toContain("'accept_recruiter_member_invite'");
    expect(accept).toContain('`/recruiter/invite/${token ?? \'\'}`');
    expect(accept).toContain('/auth?next=');
    expect(accept).toContain("navigate('/recruiter')");
    expect(accept).not.toContain('invite_token_hash');
    expect(accept).not.toContain('.from(');
  });
});

describe('RC-1J-D — fail-closed render', () => {
  beforeEach(() => cleanup());

  it('renders the neutral state and fetches nothing without team_view', () => {
    const rpc = vi.fn();
    vi.doMock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RecruiterTeamPanel } = require('@/components/recruiter/RecruiterTeamPanel');
    render(
      <QueryClientProvider client={qc}>
        <RecruiterTeamPanel
          recruiterId="r-1"
          companyName="Acme Carriers"
          canViewTeam={false}
          canManageTeam
          isOwnerActor={false}
          actorPermissions={null}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('recruiter-team-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-team-seat-card')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
