import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function findProRecheckMigration(): string {
  const dir = 'supabase/migrations';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const txt = readFileSync(join(process.cwd(), dir, f), 'utf8');
    if (
      txt.includes('CREATE OR REPLACE FUNCTION public.accept_assistant_invite') &&
      txt.includes('This driver no longer has Pro')
    ) {
      return join(dir, f);
    }
  }
  throw new Error('Cleanup B migration with Pro re-check not found');
}

const MIGRATION = read(findProRecheckMigration());

describe('Cleanup B — accept_assistant_invite Pro re-check', () => {
  it('only applies to direct (non agency-delegated) rows', () => {
    expect(MIGRATION).toMatch(/IF _row\.agency_delegation_id IS NULL THEN/);
  });
  it('checks current driver subscription status pro_monthly/pro_yearly', () => {
    expect(MIGRATION).toMatch(/plan_key IN \('pro_monthly','pro_yearly'\)/);
  });
  it('raises a clear error when the driver no longer has Pro', () => {
    expect(MIGRATION).toMatch(/This driver no longer has Pro\. Direct assistant access requires Pro\./);
  });
  it('still re-checks the direct assistant cap', () => {
    expect(MIGRATION).toMatch(/already has an active direct assistant/);
  });
  it('admin override remains via is_admin', () => {
    expect(MIGRATION).toMatch(/public\.is_admin\(_row\.driver_user_id\)/);
  });
});

describe('Cleanup B — WorkQueueSection permission-aware UI', () => {
  const wq = read('src/components/agency/WorkQueueSection.tsx');
  const dash = read('src/pages/AgencyDashboard.tsx');

  it('requires exact granular permission props, not a generic canManage flag', () => {
    expect(wq).toMatch(/canViewAllWorkItems:\s*boolean/);
    expect(wq).toMatch(/canManageWorkItems:\s*boolean/);
    expect(wq).not.toMatch(/canManage\?:\s*boolean/);
  });
  it('gates New task button behind canManageWorkItems', () => {
    expect(wq).toMatch(/\{canManageWorkItems && \(\s*<Button[\s\S]+New task/);
  });
  it('gates the create dialog behind canManageWorkItems', () => {
    expect(wq).toMatch(/\{canManageWorkItems && \(\s*<CreateWorkItemDialog/);
  });
  it('gates driver and member filters behind canViewAllWorkItems, not the manage gate', () => {
    expect(wq).toMatch(/\{canViewAllWorkItems && \(\s*<>[\s\S]+All drivers[\s\S]+All members[\s\S]+<\/>/);
  });
  it('shows member-facing copy when canViewAllWorkItems is false', () => {
    expect(wq).toMatch(/You'll only see work items assigned to you\. Driver account access still requires driver-approved delegation\./);
  });
  it('AgencyDashboard wires the exact granular work-item permissions', () => {
    expect(dash).toMatch(/<WorkQueueSection[\s\S]+canViewAllWorkItems=\{canViewAllWorkItems\}/);
    expect(dash).toMatch(/<WorkQueueSection[\s\S]+canManageWorkItems=\{canManageWorkItems\}/);
    expect(dash).not.toMatch(/canManage=\{isOwnerOrAdmin\}/);
    expect(dash).not.toMatch(/isOwnerOrAdmin/);
  });
});


describe('Cleanup B — CreateAgencyCard copy', () => {
  const dash = read('src/pages/AgencyDashboard.tsx');
  it('no longer says drivers invite you individually', () => {
    expect(dash).not.toMatch(/Drivers still invite you individually/);
  });
  it('says drivers approve each delegation', () => {
    expect(dash).toMatch(/Drivers still approve each delegation/);
  });
});

describe('Cleanup B — regression: phase 5–8 invariants intact', () => {
  it('no intent= shortcuts re-introduced for assistant/agency', () => {
    const auth = read('src/pages/Auth.tsx');
    expect(auth).not.toMatch(/intent=assistant/);
    expect(auth).not.toMatch(/intent=agency/);
  });
  it('AppShell still wraps /assistant and /agency', () => {
    expect(read('src/pages/AssistantDashboard.tsx')).toMatch(/<AppShell>/);
    expect(read('src/pages/AgencyDashboard.tsx')).toMatch(/<AppShell>/);
  });
});
