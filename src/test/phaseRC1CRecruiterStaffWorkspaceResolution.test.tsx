/**
 * Phase RC-1C — Recruiter staff workspace resolution & entry context.
 *
 * Proves: candidate migration shape/privileges, fail-closed parsing,
 * selection policy, user-scoped preference storage, useViewMode staff
 * overlay boundaries, RecruiterEntryRoute activation suppression, and
 * the RecruiterAccessRoute neutral staff home returning before every
 * owner operational child.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  parseRecruiterStaffWorkspaces,
  resolveRecruiterStaffWorkspace,
  recruiterStaffWorkspaceStorageKey,
  type RecruiterStaffWorkspace,
} from '@/lib/recruiterStaffWorkspaceResolution';

// ---------------------------------------------------------------- mocks
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/components/opportunities/recruiter/RecruiterAccessPage', () => ({
  RecruiterAccessPage: () => <div data-testid="recruiter-access-page" />,
}));
vi.mock('@/components/opportunities/RecruiterOnboarding', () => ({
  RecruiterOnboarding: () => <div data-testid="recruiter-onboarding" />,
}));
vi.mock('@/components/opportunities/RecruiterOpportunityManager', () => ({
  RecruiterOpportunityManager: () => <div data-testid="recruiter-manager" />,
}));
vi.mock('@/components/opportunities/RecruiterApplicationsDashboard', () => ({
  RecruiterApplicationsDashboard: () => <div data-testid="recruiter-apps" />,
}));
vi.mock('@/components/recruiter/RecruiterReportsPanel', () => ({
  RecruiterReportsPanel: () => <div data-testid="recruiter-reports" />,
}));

let authUser: { id: string } | null = { id: 'u1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, loading: false, signOut: vi.fn() }),
}));

let capsState: any = { rows: [], error: null, isLoading: false, beginRecruiterSetup: vi.fn() };
vi.mock('@/hooks/useUserCapabilities', () => ({
  useUserCapabilities: () => capsState,
}));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ role: null, isLoading: false }),
}));

let staffState: any = {
  workspaces: [],
  selectedWorkspace: null,
  requiresSelection: false,
  isLoading: false,
  error: null,
  selectWorkspace: vi.fn(),
  clearSelection: vi.fn(),
};
vi.mock('@/hooks/recruiter/useRecruiterStaffWorkspace', () => ({
  useRecruiterStaffWorkspace: () => staffState,
}));

import { RecruiterAccessRoute } from '@/components/opportunities/recruiter/RecruiterAccessRoute';
import { useViewMode } from '@/hooks/useViewMode';
import RecruiterEntryRoute from '@/components/opportunities/recruiter/RecruiterEntryRoute';

const WS = (i: number, role: 'recruiter_admin' | 'recruiter_staff' = 'recruiter_staff') => ({
  membership_id: `m${i}`,
  recruiter_id: `r${i}`,
  company_name: `Company ${i}`,
  recruiter_name: `Owner ${i}`,
  member_role: role,
  member_since: '2026-01-01',
});

const ws = (i: number): RecruiterStaffWorkspace => ({
  membershipId: `m${i}`,
  recruiterId: `r${i}`,
  companyName: `Company ${i}`,
  recruiterName: `Owner ${i}`,
  memberRole: 'recruiter_staff',
  memberSince: '2026-01-01',
});

beforeEach(() => {
  cleanup();
  navigateSpy.mockReset();
  localStorage.clear();
  authUser = { id: 'u1' };
  capsState = { rows: [], error: null, isLoading: false, beginRecruiterSetup: vi.fn() };
  staffState = {
    workspaces: [],
    selectedWorkspace: null,
    requiresSelection: false,
    isLoading: false,
    error: null,
    selectWorkspace: vi.fn(),
    clearSelection: vi.fn(),
  };
});

// =======================================================================
// A) Candidate migration contract
// =======================================================================
describe('RC-1C candidate migration', () => {
  const sql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'supabase/migration-candidates/20260815031000_phase_rc1c_recruiter_staff_workspace_resolution.sql',
    ),
    'utf8',
  );
  const lower = sql.toLowerCase();
  // Comment-stripped body: prose must never satisfy or break a proof.
  const body = lower
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  it('defines exactly one new function: get_my_recruiter_staff_workspaces', () => {
    const fns = [...lower.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/g)]
      .map(m => m[1]);
    expect(fns).toEqual(['get_my_recruiter_staff_workspaces']);
  });

  it('is SECURITY DEFINER / STABLE with pinned search_path', () => {
    expect(lower).toContain('security definer');
    expect(lower).toContain('stable');
    expect(lower).toContain('set search_path = public');
  });

  it('returns only active non-owner memberships of active, non-suspended workspaces', () => {
    expect(lower).toContain("'recruiter_admin'");
    expect(lower).toContain("'recruiter_staff'");
    expect(lower).not.toMatch(/member_role\s*=\s*'recruiter_owner'/);
    expect(body).toMatch(/status\s*=\s*'active'/);
    expect(body).toMatch(/verification_status[^;]*(<>|!=)\s*'suspended'/);
  });

  it('exposes safe context columns only', () => {
    for (const col of [
      'membership_id',
      'recruiter_id',
      'company_name',
      'recruiter_name',
      'member_role',
      'member_since',
    ]) {
      expect(body).toContain(col);
    }
    for (const forbidden of ['stripe', 'billing', 'contact_email', 'dot_number', 'mc_number', 'permissions']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('pins execute privileges to authenticated only', () => {
    expect(lower).toMatch(/revoke\s+all\s+on\s+function\s+public\.get_my_recruiter_staff_workspaces\(\)\s+from\s+public/);
    expect(lower).toContain('from anon');
    expect(lower).toMatch(/grant\s+execute\s+on\s+function\s+public\.get_my_recruiter_staff_workspaces\(\)\s+to\s+authenticated/);
  });

  it('touches no table, policy, grant, or existing operational function', () => {
    expect(body).not.toContain('create table');
    expect(body).not.toContain('alter table');
    expect(body).not.toContain('create policy');
    expect(body).not.toContain('drop policy');
    expect(body).not.toContain('current_user_can_manage_recruiter_opportunities');
    expect(body).not.toContain('insert into');
    expect(body).not.toContain('update public.');
    expect(body).not.toContain('delete from');
  });
});

// =======================================================================
// B) Parser fails closed
// =======================================================================
describe('parseRecruiterStaffWorkspaces', () => {
  it('accepts ONLY an empty array as zero workspaces', () => {
    expect(parseRecruiterStaffWorkspaces([])).toEqual({ ok: true, workspaces: [] });
  });

  it('treats null/undefined as malformed (never proof of zero workspaces)', () => {
    expect(parseRecruiterStaffWorkspaces(null)).toEqual({ ok: false, reason: 'malformed_payload' });
    expect(parseRecruiterStaffWorkspaces(undefined)).toEqual({
      ok: false,
      reason: 'malformed_payload',
    });
  });

  it('rejects non-array payloads', () => {
    expect(parseRecruiterStaffWorkspaces({ recruiter_id: 'r1' }).ok).toBe(false);
    expect(parseRecruiterStaffWorkspaces('rows').ok).toBe(false);
    expect(parseRecruiterStaffWorkspaces(0).ok).toBe(false);
  });


  it('rejects the WHOLE payload when any row is malformed (no silent drop)', () => {
    const res = parseRecruiterStaffWorkspaces([WS(1), { ...WS(2), member_role: 'recruiter_owner' }]);
    expect(res).toEqual({ ok: false, reason: 'malformed_row' });
  });

  it('rejects rows missing required safe fields', () => {
    expect(parseRecruiterStaffWorkspaces([{ ...WS(1), company_name: '' }]).ok).toBe(false);
    expect(parseRecruiterStaffWorkspaces([{ ...WS(1), recruiter_id: null }]).ok).toBe(false);
  });

  it('fails closed on duplicate membership or recruiter ids', () => {
    expect(parseRecruiterStaffWorkspaces([WS(1), WS(1)]).ok).toBe(false);
    expect(
      parseRecruiterStaffWorkspaces([WS(1), { ...WS(2), recruiter_id: 'r1' }]),
    ).toEqual({ ok: false, reason: 'duplicate_recruiter' });
  });
});

// =======================================================================
// C) Selection policy
// =======================================================================
describe('resolveRecruiterStaffWorkspace', () => {
  it('zero rows → none', () => {
    expect(resolveRecruiterStaffWorkspace([], null).kind).toBe('none');
  });

  it('exactly one row auto-selects', () => {
    const r = resolveRecruiterStaffWorkspace([WS(1)], null);
    expect(r.kind).toBe('selected');
    expect(r.selected?.recruiterId).toBe('r1');
  });

  it('two rows without a stored id require explicit selection', () => {
    const r = resolveRecruiterStaffWorkspace([WS(1), WS(2)], null);
    expect(r.kind).toBe('selection_required');
    expect(r.selected).toBeNull();
  });

  it('two rows with a valid stored id select that workspace', () => {
    const r = resolveRecruiterStaffWorkspace([WS(1), WS(2)], 'r2');
    expect(r.kind).toBe('selected');
    expect(r.selected?.recruiterId).toBe('r2');
  });

  it('a stored id absent from current rows grants nothing and is cleared', () => {
    const r = resolveRecruiterStaffWorkspace([WS(1), WS(2)], 'r-forged');
    expect(r.kind).toBe('selection_required');
    expect(r.selected).toBeNull();
    expect('shouldClearStoredSelection' in r && r.shouldClearStoredSelection).toBe(true);
  });

  it('malformed payload never resolves to a selection', () => {
    const r = resolveRecruiterStaffWorkspace([WS(1), { bogus: true }], 'r1');
    expect(r.kind).toBe('invalid');
    expect(r.selected).toBeNull();
    expect(r.workspaces).toEqual([]);
  });

  it('null/undefined payloads resolve invalid, never none', () => {
    for (const p of [null, undefined]) {
      const r = resolveRecruiterStaffWorkspace(p, 'r1');
      expect(r.kind).toBe('invalid');
      expect(r.selected).toBeNull();
      expect(r.workspaces).toEqual([]);
    }
  });
});

// =======================================================================
// C2) Hook lifecycle source contract (correction 2 + 3)
// =======================================================================
describe('useRecruiterStaffWorkspace lifecycle contract', () => {
  const hookSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/hooks/recruiter/useRecruiterStaffWorkspace.ts'),
    'utf8',
  );

  it('clears a stale stored preference from an effect, not during render', () => {
    // The only clearStored call driven by resolution must live inside a
    // useEffect body.
    const effectBlocks = hookSrc.split('useEffect(');
    const housekeeping = effectBlocks.filter(b => b.includes('clearStored(userId)')).pop();
    expect(housekeeping).toBeTruthy();
    expect(housekeeping).toContain('shouldClearStored');
    // No render-time conditional mutation remains.
    expect(hookSrc).not.toContain("if (userId && resolution && 'shouldClearStoredSelection' in resolution)");
  });

  it('invalidates the in-flight generation before the no-user branch', () => {
    const fetchEffect = hookSrc.slice(hookSrc.indexOf('useEffect(() => {'));
    const bumpIdx = fetchEffect.indexOf('++requestRef.current');
    const noUserIdx = fetchEffect.indexOf('if (!userId)');
    expect(bumpIdx).toBeGreaterThan(-1);
    expect(noUserIdx).toBeGreaterThan(-1);
    expect(bumpIdx).toBeLessThan(noUserIdx);
  });

  it('keeps the user-bound payload guard', () => {
    expect(hookSrc).toContain('query.userId === userId ? query.data : null');
  });

  it('rejects selecting a recruiter id outside current validated rows', () => {
    expect(hookSrc).toContain('const match = workspaces.find(w => w.recruiterId === recruiterId);');
    expect(hookSrc).toContain('if (!match) return;');
  });
});

// =======================================================================
// D) Storage key is user-scoped
// =======================================================================
describe('recruiterStaffWorkspaceStorageKey', () => {
  it('binds the preference to the user id', () => {
    expect(recruiterStaffWorkspaceStorageKey('u1')).toBe('htp_recruiter_staff_workspace:u1');
    expect(recruiterStaffWorkspaceStorageKey('u2')).not.toBe(
      recruiterStaffWorkspaceStorageKey('u1'),
    );
  });
});

// =======================================================================
// E) useViewMode staff overlay
// =======================================================================
const capRow = (type: 'driver' | 'recruiter', status: string) => ({
  capability: type,
  status,
  activated_at: null,
});

function viewModeWith(rows: any[], staff: Partial<typeof staffState>) {
  capsState = { rows, error: null, isLoading: false, beginRecruiterSetup: vi.fn() };
  staffState = { ...staffState, ...staff };
  return renderHook(() => useViewMode()).result.current;
}

describe('useViewMode staff overlay', () => {
  it('staff-only account with one workspace resolves recruiter hub, operations false', () => {
    const r = viewModeWith([], { selectedWorkspace: ws(1), workspaces: [ws(1)] });
    expect(r.recruiterHubAllowed).toBe(true);
    expect(r.recruiterOperationsAllowed).toBe(false);
    expect(r.recruiterAccessKind).toBe('staff');
    expect(r.recruiterWorkspaceStatus).toBe('active');
    expect(r.recruiterCapabilityStatus).toBeNull();
    expect(r.effectiveRole).toBe('recruiter');
  });

  it('no validated selection grants nothing', () => {
    const r = viewModeWith([], { workspaces: [ws(1), ws(2)], requiresSelection: true });
    expect(r.recruiterHubAllowed).toBe(false);
    expect(r.recruiterAccessKind).toBeNull();
    expect(r.staffSelectionRequired).toBe(true);
    expect(r.effectiveRole).toBeNull();
  });

  it('staff membership never bypasses a personal setup capability', () => {
    const r = viewModeWith([capRow('recruiter', 'setup')], {
      selectedWorkspace: ws(1),
      workspaces: [ws(1)],
    });
    expect(r.recruiterAccessKind).toBe('capability');
    expect(r.recruiterWorkspaceStatus).toBe('setup');
    expect(r.selectedStaffWorkspace).toBeNull();
  });

  it('staff membership never bypasses suspended or revoked capability', () => {
    for (const status of ['suspended', 'revoked']) {
      const r = viewModeWith([capRow('recruiter', status)], {
        selectedWorkspace: ws(1),
        workspaces: [ws(1)],
      });
      expect(r.recruiterAccessKind).toBe('capability');
      expect(r.recruiterWorkspaceStatus).toBe(status);
      expect(r.selectedStaffWorkspace).toBeNull();
      cleanup();
    }
  });

  it('driver+staff keeps driver as the default workspace', () => {
    const r = viewModeWith([capRow('driver', 'active')], {
      selectedWorkspace: ws(1),
      workspaces: [ws(1)],
    });
    expect(r.effectiveRole).toBe('driver');
    expect(r.recruiterHubAllowed).toBe(true);
    expect(r.recruiterOperationsAllowed).toBe(false);
  });

  it('staff discovery failure does not block a valid driver workspace', () => {
    const r = viewModeWith([capRow('driver', 'active')], {
      error: new Error('rpc down'),
    });
    expect(r.effectiveRole).toBe('driver');
    expect(r.driverWorkspaceAllowed).toBe(true);
    expect(r.staffWorkspaceError).toBeInstanceOf(Error);
    expect(r.error).toBeNull();
  });
});

// =======================================================================
// F) RecruiterEntryRoute
// =======================================================================
function renderEntry() {
  return render(
    <MemoryRouter>
      <RecruiterEntryRoute />
    </MemoryRouter>,
  );
}

describe('RecruiterEntryRoute staff handling', () => {
  it('does NOT call beginRecruiterSetup when a staff workspace is selected', () => {
    const begin = vi.fn();
    capsState = {
      rows: [capRow('driver', 'active')],
      error: null,
      isLoading: false,
      beginRecruiterSetup: begin,
    };
    staffState = { ...staffState, workspaces: [ws(1)], selectedWorkspace: ws(1) };
    renderEntry();
    expect(begin).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/dashboard?page=recruiter-access', { replace: true });
  });

  it('renders a neutral chooser and never activates when selection is required', () => {
    const begin = vi.fn();
    const select = vi.fn();
    capsState = {
      rows: [capRow('driver', 'active')],
      error: null,
      isLoading: false,
      beginRecruiterSetup: begin,
    };
    staffState = {
      ...staffState,
      workspaces: [ws(1), ws(2)],
      requiresSelection: true,
      selectWorkspace: select,
    };
    renderEntry();
    expect(begin).not.toHaveBeenCalled();
    expect(screen.getByTestId('recruiter-staff-workspace-chooser')).toBeTruthy();
    expect(screen.getByText('Company 1')).toBeTruthy();
    expect(screen.getByText('Company 2')).toBeTruthy();
    fireEvent.click(screen.getByText('Company 2'));
    expect(select).toHaveBeenCalledWith('r2');
  });

  it('fails closed on staff discovery error without creating a capability', () => {
    const begin = vi.fn();
    capsState = {
      rows: [capRow('driver', 'active')],
      error: null,
      isLoading: false,
      beginRecruiterSetup: begin,
    };
    staffState = { ...staffState, error: new Error('rpc down') };
    renderEntry();
    expect(begin).not.toHaveBeenCalled();
    expect(screen.getByText('Recruiter access unavailable')).toBeTruthy();
  });

  it('preserves the existing activation path when zero staff workspaces exist', () => {
    const begin = vi.fn().mockResolvedValue('setup');
    capsState = {
      rows: [capRow('driver', 'active')],
      error: null,
      isLoading: false,
      beginRecruiterSetup: begin,
    };
    renderEntry();
    expect(begin).toHaveBeenCalledTimes(1);
  });
});

// =======================================================================
// G) RecruiterAccessRoute staff branch
// =======================================================================
function renderAccess(props: any) {
  return render(
    <MemoryRouter>
      <RecruiterAccessRoute onBack={() => {}} {...props} />
    </MemoryRouter>,
  );
}

const OWNER_CHILDREN = [
  'recruiter-access-page',
  'recruiter-onboarding',
  'recruiter-manager',
  'recruiter-apps',
  'recruiter-reports',
];

describe('RecruiterAccessRoute staff mode', () => {
  it('renders the neutral staff home before any owner operational child', () => {
    renderAccess({
      recruiterAccessKind: 'staff',
      recruiterCapabilityStatus: null,
      recruiterWorkspaceStatus: 'active',
      recruiterHubAllowed: true,
      recruiterOperationsAllowed: false,
      selectedStaffWorkspace: ws(1),
    });
    expect(screen.getByTestId('recruiter-staff-workspace-home')).toBeTruthy();
    for (const id of OWNER_CHILDREN) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('collapses every requested subview to the staff home', () => {
    for (const sub of ['manager', 'applications', 'reports', 'onboarding'] as const) {
      renderAccess({
        initialView: sub,
        recruiterAccessKind: 'staff',
        recruiterCapabilityStatus: null,
        recruiterWorkspaceStatus: 'active',
        recruiterHubAllowed: true,
        recruiterOperationsAllowed: false,
        selectedStaffWorkspace: ws(1),
      });
      expect(screen.getByTestId('recruiter-staff-workspace-home')).toBeTruthy();
      for (const id of OWNER_CHILDREN) {
        expect(screen.queryByTestId(id)).toBeNull();
      }
      cleanup();
    }
  });

  it('fails closed when staff mode has no validated workspace', () => {
    renderAccess({
      recruiterAccessKind: 'staff',
      recruiterCapabilityStatus: null,
      recruiterHubAllowed: true,
      selectedStaffWorkspace: null,
    });
    expect(screen.getByTestId('recruiter-access-neutral')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-staff-workspace-home')).toBeNull();
  });

  it('offers Change recruiter workspace only when a callback is supplied', () => {
    const change = vi.fn();
    renderAccess({
      recruiterAccessKind: 'staff',
      recruiterCapabilityStatus: null,
      recruiterHubAllowed: true,
      selectedStaffWorkspace: ws(1),
      onChangeStaffWorkspace: change,
    });
    fireEvent.click(screen.getByText('Change recruiter workspace'));
    expect(change).toHaveBeenCalled();
    cleanup();
    renderAccess({
      recruiterAccessKind: 'staff',
      recruiterCapabilityStatus: null,
      recruiterHubAllowed: true,
      selectedStaffWorkspace: ws(1),
    });
    expect(screen.queryByText('Change recruiter workspace')).toBeNull();
  });

  it('leaves existing owner/capability behavior unchanged', () => {
    renderAccess({
      recruiterAccessKind: 'capability',
      recruiterCapabilityStatus: 'active',
      recruiterHubAllowed: true,
      recruiterOperationsAllowed: true,
      initialView: 'manager',
    });
    expect(screen.getByTestId('recruiter-manager')).toBeTruthy();
    expect(screen.queryByTestId('recruiter-staff-workspace-home')).toBeNull();
  });
});

// =======================================================================
// H) Index wiring
// =======================================================================
describe('Index shell wiring', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Index.tsx'), 'utf8');

  it('feeds dashboard policy and nav from recruiterWorkspaceStatus', () => {
    expect(src).toContain('recruiterCapabilityStatus: recruiterWorkspaceStatus,');
    expect(src).toContain('recruiterCapabilityStatus={recruiterWorkspaceStatus}');
  });

  it('keeps personal capability status separate and passes staff context down', () => {
    expect(src).toContain('recruiterCapabilityStatus={recruiterCapabilityStatus}');
    expect(src).toContain('recruiterAccessKind={recruiterAccessKind}');
    expect(src).toContain('selectedStaffWorkspace={selectedStaffWorkspace}');
  });
});
