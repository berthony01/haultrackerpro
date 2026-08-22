/**
 * Phase RW-1 — Agency Team & permission management surface.
 *
 * Proves the UX-gating contract of the new surface. The database remains the
 * only authority; these tests assert the client never invents authority.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AgencyTeamPanel } from '@/components/agency/AgencyTeamPanel';
import { AGENCY_WORKSPACE_PERMISSION_KEYS } from '@/lib/agencyWorkspacePermissions';

const setPermissionsMutate = vi.fn().mockResolvedValue({});
const inviteMutate = vi.fn().mockResolvedValue({ invite_token: 'tok' });
const revokeMutate = vi.fn().mockResolvedValue(undefined);

const members = [
  {
    id: 'm1',
    agency_id: 'a1',
    member_user_id: 'u1',
    invite_email: 'member@example.com',
    role: 'agency_member',
    status: 'active',
    invited_at: '2026-01-01',
    accepted_at: '2026-01-02',
    revoked_at: null,
  },
];

let memberPermissions: Record<string, boolean> | undefined;

vi.mock('@/hooks/useAgency', () => ({
  useAgencyMembers: () => ({ data: members }),
  useAgencyMemberPermissions: () => ({
    data: memberPermissions,
    isLoading: false,
    isError: false,
  }),
  useAgencyMutations: () => ({
    invite: { mutateAsync: inviteMutate, isPending: false },
    revoke: { mutateAsync: revokeMutate, isPending: false },
    setPermissions: { mutateAsync: setPermissionsMutate, isPending: false },
  }),
}));

vi.mock('@/hooks/useProfessionalProfile', () => ({
  useAuthorizedProfessionalProfiles: () => ({ data: {} }),
}));

vi.mock('@/components/profiles/ProfessionalProfileCard', () => ({
  ProfessionalProfileSummaryCard: () => null,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  memberPermissions = Object.fromEntries(
    AGENCY_WORKSPACE_PERMISSION_KEYS.map((k) => [k, false]),
  );
});

describe('RW-1 — Agency team surface gating', () => {
  it('non-owner with team_view sees the roster but no write controls', () => {
    render(<AgencyTeamPanel agencyId="a1" isOwner={false} canViewTeam />);
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Invite')).not.toBeInTheDocument();
    expect(screen.queryByText('Revoke')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agency-edit-permissions-m1')).not.toBeInTheDocument();
    expect(screen.getByTestId('agency-team-readonly-note')).toBeInTheDocument();
  });

  it('canonical owner sees invite, revoke and permission editing', () => {
    render(<AgencyTeamPanel agencyId="a1" isOwner canViewTeam />);
    expect(screen.getByText('Invite')).toBeInTheDocument();
    expect(screen.getByText('Revoke')).toBeInTheDocument();
    expect(screen.getByTestId('agency-edit-permissions-m1')).toBeInTheDocument();
  });

  it('states that workspace permissions never grant driver-account access', () => {
    render(<AgencyTeamPanel agencyId="a1" isOwner canViewTeam />);
    expect(
      screen.getAllByText(/never grant access to a driver's account/i).length,
    ).toBeGreaterThan(0);
  });

  it('exposes exactly the 11 known permission toggles, all independent', async () => {
    render(<AgencyTeamPanel agencyId="a1" isOwner canViewTeam />);
    fireEvent.click(screen.getByTestId('agency-edit-permissions-m1'));
    await waitFor(() => expect(screen.getByTestId('agency-permission-editor')).toBeInTheDocument());

    for (const key of AGENCY_WORKSPACE_PERMISSION_KEYS) {
      expect(screen.getByTestId(`agency-permission-${key}`)).toBeInTheDocument();
    }
    expect(
      screen.getByTestId('agency-permission-editor').querySelectorAll('[data-testid^="agency-permission-"]').length,
    ).toBe(AGENCY_WORKSPACE_PERMISSION_KEYS.length);

    // Toggling one permission never enables another.
    fireEvent.click(screen.getByTestId('agency-permission-work_items_manage'));
    fireEvent.click(screen.getByTestId('agency-permission-save'));

    await waitFor(() => expect(setPermissionsMutate).toHaveBeenCalledTimes(1));
    const payload = setPermissionsMutate.mock.calls[0][0].permissions;
    expect(Object.keys(payload).sort()).toEqual([...AGENCY_WORKSPACE_PERMISSION_KEYS].sort());
    expect(payload.work_items_manage).toBe(true);
    expect(payload.work_items_view_all).toBe(false);
    expect(Object.values(payload).filter((v) => v === true)).toHaveLength(1);
  });

  it('sends a complete map even when nothing is toggled', async () => {
    memberPermissions = Object.fromEntries(
      AGENCY_WORKSPACE_PERMISSION_KEYS.map((k) => [k, k === 'audit_view']),
    );
    render(<AgencyTeamPanel agencyId="a1" isOwner canViewTeam />);
    fireEvent.click(screen.getByTestId('agency-edit-permissions-m1'));
    await waitFor(() => expect(screen.getByTestId('agency-permission-editor')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('agency-permission-save'));
    await waitFor(() => expect(setPermissionsMutate).toHaveBeenCalledTimes(1));
    const payload = setPermissionsMutate.mock.calls[0][0].permissions;
    expect(payload.audit_view).toBe(true);
    expect(Object.keys(payload)).toHaveLength(AGENCY_WORKSPACE_PERMISSION_KEYS.length);
  });
});

describe('RW-1 — source contract', () => {
  const panel = readFileSync('src/components/agency/AgencyTeamPanel.tsx', 'utf8');
  const hooks = readFileSync('src/hooks/useAgency.ts', 'utf8');
  const dash = readFileSync('src/pages/AgencyDashboard.tsx', 'utf8');

  it('uses only the authorized RPCs and never reads agency_members directly', () => {
    expect(hooks).toContain('get_agency_member_permissions');
    expect(hooks).toContain('set_agency_member_permissions');
    expect(panel).not.toContain(".from('agency_members')");
    expect(panel).not.toContain('supabase');
  });

  it('never offers agency_owner as an invitable role and keeps roles descriptive', () => {
    expect(panel).toContain("value: 'agency_member'");
    expect(panel).toContain("value: 'agency_admin'");
    expect(panel).not.toMatch(/value:\s*'agency_owner'/);
    expect(panel).toMatch(/descriptive only/i);
  });

  it('has no role presets or bulk permission shortcuts', () => {
    expect(panel).not.toMatch(/preset/i);
    expect(panel).not.toMatch(/selectAll|grantAll|applyRole/i);
  });

  it('does not touch billing, plan, or slug surfaces', () => {
    expect(panel).not.toMatch(/stripe|checkout|billing|subscription|entitlement/i);
    expect(panel).not.toContain('AgencySlugCard');
  });

  it('gates the Team tab on the team_view permission', () => {
    expect(dash).toContain("{ value: 'team', label: 'Team', show: canViewTeam }");
    expect(dash).toContain('<AgencyTeamPanel');
  });
});
