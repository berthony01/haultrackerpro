import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function findCleanupMigration(): string {
  const dir = 'supabase/migrations';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const txt = readFileSync(join(process.cwd(), dir, f), 'utf8');
    if (txt.includes('agency_delegation_id uuid')) return join(dir, f);
  }
  throw new Error('Cleanup migration not found');
}

const MIGRATION = read(findCleanupMigration());

describe('Access integrity — assistant access center copy', () => {
  const dash = read('src/pages/AssistantDashboard.tsx');

  it('positions /assistant as an Access Center, not a dashboard', () => {
    expect(dash).toContain('Assistant Access Center');
    expect(dash).not.toMatch(/Assistant operations/);
  });

  it('reduces stat cards to access-only summary', () => {
    expect(dash).toMatch(/Approved drivers/);
    expect(dash).toMatch(/Pending invites/);
    expect(dash).not.toMatch(/Reports access/);
    expect(dash).not.toMatch(/Active past 7d/);
  });

  it('keeps a secondary Agency CTA but never a primary monetized dashboard CTA', () => {
    expect(dash).toMatch(/assistant-agency-cta/);
    expect(dash).toMatch(/Want to manage multiple drivers as a business\?/);
  });
});

describe('Access integrity — direct assistant limits in panel UI', () => {
  const panel = read('src/components/assistants/AssistantsPanel.tsx');

  it('uses source-aware data and counts only direct assistants against the slot', () => {
    expect(panel).toMatch(/useAssistantsWithSource/);
    expect(panel).toMatch(/source === 'direct_invite'/);
    expect(panel).toMatch(/Agency-delegated helpers don't count/);
  });

  it('labels rows as via agency vs direct invite', () => {
    expect(panel).toMatch(/via agency/);
    expect(panel).toMatch(/direct invite/);
  });
});

describe('Access integrity — agency dashboard workspace-permission gating', () => {
  const agency = read('src/pages/AgencyDashboard.tsx');

  it('gates Packages/Requests tabs on granular workspace permissions, never on role', () => {
    expect(agency).toMatch(/const showPackages = canViewPackages \|\| canManagePackages;/);
    expect(agency).toMatch(/const showRequests = canViewClientRequests \|\| canManageClientRequests;/);
    expect(agency).toMatch(/label: 'Packages', show: showPackages/);
    expect(agency).toMatch(/label: 'Requests', show: showRequests/);
    // Durable anti-shortcut: role labels are never workspace authority here.
    expect(agency).not.toMatch(/isOwnerOrAdmin/);
  });

  it('gates Clients and Activity on exact read permissions', () => {
    expect(agency).toMatch(/label: 'Clients', show: canViewClients/);
    expect(agency).toMatch(/label: 'Activity', show: canViewAudit/);
    expect(agency).not.toMatch(/show: isOwnerOrAdmin/);
    expect(agency).not.toMatch(/'activity', label: 'Activity', show: isOwner\b/);
  });

  it('hides plan limits card from non-owners and explains billing ownership', () => {
    expect(agency).toMatch(/isOwner && <AgencyPlanLimitsCard/);
    expect(agency).toMatch(/Billing and plan limits are managed by the agency owner/);
  });
});


describe('Access integrity — migration: explicit agency delegation link', () => {
  it('adds agency_delegation_id column with FK', () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS agency_delegation_id uuid/);
    expect(MIGRATION).toMatch(/REFERENCES public\.agency_delegation_requests\(id\) ON DELETE SET NULL/);
  });

  it('backfills only unambiguous matches', () => {
    expect(MIGRATION).toMatch(/WHERE c\.da_id = da\.id AND c\.n = 1/);
  });

  it('list_my_assistants_with_source prefers the explicit link', () => {
    expect(MIGRATION).toMatch(/linked AS \(/);
    expect(MIGRATION).toMatch(/JOIN public\.agency_delegation_requests d ON d\.id = m\.agency_delegation_id/);
  });

  it('driver_decide_delegation writes agency_delegation_id', () => {
    expect(MIGRATION).toMatch(/agency_delegation_id\s*=\s*EXCLUDED\.agency_delegation_id/);
  });
});

describe('Access integrity — migration: agency_profiles writes locked', () => {
  it('drops the broad owner_all policy', () => {
    expect(MIGRATION).toMatch(/DROP POLICY IF EXISTS agency_profiles_owner_all/);
  });

  it('only restores SELECT and UPDATE for owner — no INSERT/DELETE', () => {
    expect(MIGRATION).toMatch(/CREATE POLICY agency_profiles_owner_update[\s\S]+FOR UPDATE/);
    expect(MIGRATION).toMatch(/CREATE POLICY agency_profiles_owner_select[\s\S]+FOR SELECT/);
    expect(MIGRATION).not.toMatch(/agency_profiles_owner_insert/);
    expect(MIGRATION).not.toMatch(/agency_profiles_owner_delete/);
  });
});

describe('Access integrity — migration: server-side direct assistant limits', () => {
  it('invite_assistant excludes agency-delegated rows from the slot count', () => {
    expect(MIGRATION).toMatch(/agency_delegation_id IS NULL/);
    expect(MIGRATION).toMatch(/Your Pro plan includes 1 direct assistant/);
  });

  it('invite_assistant blocks free drivers with a clear friendly error', () => {
    expect(MIGRATION).toMatch(/Inviting assistants requires Pro/);
  });

  it('accept_assistant_invite re-checks the cap at activation', () => {
    expect(MIGRATION).toMatch(/Re-check the driver's direct assistant cap/);
    expect(MIGRATION).toMatch(/already has an active direct assistant/);
  });
});

describe('Access integrity — migration: agency creation integrity', () => {
  it('create_agency is idempotent for the same owner', () => {
    expect(MIGRATION).toMatch(/if user already owns an agency, return it/i);
  });

  it('create_agency provisions a beta entitlement row', () => {
    expect(MIGRATION).toMatch(/INSERT INTO public\.agency_entitlements[\s\S]+'agency_starter', 'manual_beta', 'manual'/);
  });

  it('get_my_agency prioritizes owner over admin over member', () => {
    expect(MIGRATION).toMatch(/WHEN 'agency_owner'\s+THEN 0/);
    expect(MIGRATION).toMatch(/WHEN 'agency_admin'\s+THEN 1/);
    expect(MIGRATION).toMatch(/WHEN 'agency_member' THEN 2/);
  });
});

describe('Access integrity — agency value is not replaced by direct assistant path', () => {
  it('AssistantsPanel exposes no agency-only surfaces (packages, requests, clients, members)', () => {
    const panel = read('src/components/assistants/AssistantsPanel.tsx');
    expect(panel).not.toMatch(/Packages/);
    expect(panel).not.toMatch(/Client Requests/);
    expect(panel).not.toMatch(/Service Package/);
  });
});

describe('Regression — phase 5–8 invariants intact', () => {
  it('no intent= shortcuts re-introduced for assistant/agency', () => {
    const auth = read('src/pages/Auth.tsx');
    expect(auth).not.toMatch(/intent=assistant/);
    expect(auth).not.toMatch(/intent=agency/);
  });

  it('AppShell remains wrapping /assistant and /agency', () => {
    expect(read('src/pages/AssistantDashboard.tsx')).toMatch(/<AppShell>/);
    expect(read('src/pages/AgencyDashboard.tsx')).toMatch(/<AppShell>/);
  });
});
