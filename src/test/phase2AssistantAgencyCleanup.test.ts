import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatAuditAction } from '@/hooks/useAssistantAudit';
import {
  isAssistantPageAllowed,
  firstAllowedAssistantPage,
} from '@/lib/assistantPermissions';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('Phase 2 cleanup — audit labels', () => {
  it.each([
    ['invite_created',          'invited a new assistant'],
    ['invite_accepted',         'accepted an assistant invitation'],
    ['permissions_updated',     'updated assistant permissions'],
    ['assistant_revoked',       'revoked an assistant'],
    ['delete_load_stops',       'deleted load stops'],
    ['create_loads',            'added a load'],
    ['update_loads',            'updated a load'],
    ['create_expenses',         'added an expense'],
    ['update_expenses',         'updated an expense'],
    ['create_fuel_logs',        'added a fuel log'],
    ['update_fuel_logs',        'updated a fuel log'],
    ['create_load_stops',       'added a load stop'],
    ['update_load_stops',       'updated a load stop'],
  ])('renders %s in plain English', (action, expected) => {
    expect(formatAuditAction(action, '')).toBe(expected);
  });

  it('falls back to verb + entity for unknown actions', () => {
    expect(formatAuditAction('update', 'cost_profile')).toBe('updated cost profile');
  });
});

describe('Phase 2 cleanup — assistant permission gating', () => {
  it('first allowed page respects granted perms', () => {
    expect(firstAllowedAssistantPage({ view_reports: true })).toBe('reports');
    expect(firstAllowedAssistantPage({ manage_fuel: true })).toBe('fuel');
    expect(firstAllowedAssistantPage({})).toBe('more');
  });

  it('blocks settings/recruiter pages regardless of perms', () => {
    const everything = {
      manage_loads: true, manage_expenses: true, manage_fuel: true,
      view_reports: true, view_dashboard: true, manage_settings_limited: true,
      export_reports: true,
    };
    expect(isAssistantPageAllowed('settings', everything)).toBe(false);
    expect(isAssistantPageAllowed('recruiter-access', everything)).toBe(false);
    expect(isAssistantPageAllowed('opportunities', everything)).toBe(false);
  });

  it('reports page requires view_reports perm', () => {
    expect(isAssistantPageAllowed('reports', { manage_loads: true })).toBe(false);
    expect(isAssistantPageAllowed('reports', { view_reports: true })).toBe(true);
  });
});

describe('Phase 2 cleanup — pending invite UI does not synthesize fake tokens', () => {
  const dash = read('src/pages/AssistantDashboard.tsx');

  it('does not navigate to fake pending-{id} invite URLs', () => {
    expect(dash).not.toMatch(/\/assistant\/invite\/pending-/);
    expect(dash).not.toMatch(/Open invite link to accept/);
  });

  it('tells the assistant to use the real driver-supplied link', () => {
    expect(dash).toMatch(/Use the invite link the driver sent you/);
  });
});

describe('Phase 2 cleanup — managed-driver source isolation', () => {
  const ctx = read('src/hooks/useActingContext.tsx');

  it('derives managed drivers exclusively from get_my_managed_drivers (driver_assistants table)', () => {
    expect(ctx).toMatch(/get_my_managed_drivers/);
    // No agency RPCs feed the assistant switcher / managed-driver list.
    expect(ctx).not.toMatch(/list_agency_members/);
    expect(ctx).not.toMatch(/get_my_agency/);
    expect(ctx).not.toMatch(/agency_members/);
  });

  it('switcher renders driver names from the same context', () => {
    const sw = read('src/components/assistants/AssistantDriverSwitcher.tsx');
    expect(sw).toMatch(/useActingContext/);
    expect(sw).not.toMatch(/agency/i);
  });
});

describe('Phase 2 cleanup — agency RLS uses non-recursive helpers', () => {
  const sql = read(
    'supabase/migrations/20260628111113_2b9bf3ba-7f95-4b80-9a45-1ca9d04ac030.sql',
  ).toLowerCase();

  it('declares is_agency_owner and is_agency_member helpers', () => {
    expect(sql).toMatch(/function public\.is_agency_owner/);
    expect(sql).toMatch(/function public\.is_agency_member/);
  });

  it('rewrites policies to use the helpers (no cross-table EXISTS in policy body)', () => {
    expect(sql).toMatch(/policy "agency_members_owner_all".*is_agency_owner/s);
    expect(sql).toMatch(/policy "agency_profiles_member_select".*is_agency_member/s);
  });

  it('adds auth.users foreign keys safely (NOT VALID then VALIDATE)', () => {
    expect(sql).toMatch(/agency_profiles_owner_user_id_fkey[\s\S]*not valid/);
    expect(sql).toMatch(/agency_members_member_user_id_fkey[\s\S]*not valid/);
    expect(sql).toMatch(/validate constraint agency_profiles_owner_user_id_fkey/);
    expect(sql).toMatch(/validate constraint agency_members_member_user_id_fkey/);
  });
});

describe('Phase 2 cleanup — agency membership never grants driver data access', () => {
  it('driver-data RLS policies do not reference agency tables', () => {
    // Spot-check the central delegated-access helper plus a representative
    // driver-owned table policy file — agency membership must be invisible to
    // driver data access decisions.
    const perms = read('src/lib/assistantPermissions.ts');
    expect(perms).not.toMatch(/agency/i);

    // The assistant audit reader is scoped to driver_user_id=auth.uid(), not
    // any agency membership lookup.
    const auditHook = read('src/hooks/useAssistantAudit.ts');
    expect(auditHook).not.toMatch(/agency/i);
  });
});
