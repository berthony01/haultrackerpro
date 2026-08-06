/**
 * Phase 7 — Assistant/Agency monetization tests.
 *
 * Locks the public plan model, limit helper, and pricing-page contract so
 * later phases (especially Phase 8 Stripe wiring) can't silently change the
 * publicly displayed pricing or the safe-default beta behavior.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ASSISTANT_AGENCY_PLANS,
  ALL_AGENCY_PLAN_KEYS,
  OUTSIDE_PAYMENTS_DISCLAIMER,
  AGENCY_BILLING_NOT_ACTIVE_REASON,
  checkAgencyLimit,
  defaultUnsubscribedEntitlement,
  effectiveLimits,
  type AgencyEntitlement,
} from '@/lib/agencyPlans';

const readFile = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('Phase 7 — plan definitions', () => {
  it('assistant_free exists and is free', () => {
    const p = ASSISTANT_AGENCY_PLANS.assistant_free;
    expect(p).toBeDefined();
    expect(p.monthlyPrice).toBe(0);
  });

  it('agency plan prices are 29 / 79 / 149', () => {
    expect(ASSISTANT_AGENCY_PLANS.agency_starter.monthlyPrice).toBe(29);
    expect(ASSISTANT_AGENCY_PLANS.agency_team.monthlyPrice).toBe(79);
    expect(ASSISTANT_AGENCY_PLANS.agency_growth.monthlyPrice).toBe(149);
  });

  it('agency plans declare member / client / package limits', () => {
    for (const k of ALL_AGENCY_PLAN_KEYS) {
      const { limits } = ASSISTANT_AGENCY_PLANS[k];
      expect(limits.memberLimit).toBeTypeOf('number');
      expect(limits.activeClientLimit).toBeTypeOf('number');
      expect(limits.servicePackageLimit).toBeTypeOf('number');
    }
  });

  it('public copy does NOT promise guaranteed income or clients', () => {
    const haystack = JSON.stringify(ASSISTANT_AGENCY_PLANS).toLowerCase();
    expect(haystack).not.toMatch(/guaranteed (income|clients|customers|earnings)/);
    expect(haystack).not.toMatch(/we guarantee/);
  });

  it('OUTSIDE_PAYMENTS_DISCLAIMER explicitly notes payments are off-platform', () => {
    expect(OUTSIDE_PAYMENTS_DISCLAIMER.toLowerCase()).toContain('does not');
    expect(OUTSIDE_PAYMENTS_DISCLAIMER.toLowerCase()).toContain('payments');
  });
});

describe('Phase 7 / 1S-A2 — limit helper (grandfathered manual_beta row)', () => {
  // Explicit manual_beta entitlement — the two existing production beta
  // workspaces. These remain usable at Agency Starter numeric limits.
  const ent: AgencyEntitlement = {
    ...defaultUnsubscribedEntitlement('agency-1'),
    status: 'manual_beta',
  };

  it('blocks creating another service package above plan limit', () => {
    const usage = { members: 1, activeClients: 0, activePackages: 3 };
    const r = checkAgencyLimit(ent, 'create_service_package', usage);
    expect(r.allowed).toBe(false);
    expect(r.limit).toBe(3);
  });

  it('allows package creation when under limit', () => {
    const usage = { members: 1, activeClients: 0, activePackages: 2 };
    expect(checkAgencyLimit(ent, 'create_service_package', usage).allowed).toBe(true);
  });

  it('blocks inviting another member above plan limit', () => {
    const usage = { members: 2, activeClients: 0, activePackages: 0 };
    const r = checkAgencyLimit(ent, 'invite_member', usage);
    expect(r.allowed).toBe(false);
  });

  it('blocks activating a 6th client on Agency Starter', () => {
    const usage = { members: 1, activeClients: 5, activePackages: 0 };
    expect(checkAgencyLimit(ent, 'activate_client', usage).allowed).toBe(false);
  });

  it('grandfathered beta keeps Starter numeric limits and stays usable under them', () => {
    expect(ent.status).toBe('manual_beta');
    expect(ent.planKey).toBe('agency_starter');
    const limits = effectiveLimits(ent);
    expect(limits.activeClientLimit).toBe(5);
    expect(limits.memberLimit).toBe(2);
    expect(limits.servicePackageLimit).toBe(3);
    const usage = { members: 1, activeClients: 1, activePackages: 1 };
    expect(checkAgencyLimit(ent, 'invite_member', usage).allowed).toBe(true);
    expect(checkAgencyLimit(ent, 'activate_client', usage).allowed).toBe(true);
    expect(checkAgencyLimit(ent, 'create_service_package', usage).allowed).toBe(true);
  });
});

describe('Phase 1S-A2 — missing entitlement row fails closed', () => {
  const ent = defaultUnsubscribedEntitlement('agency-none');

  it('treats no entitlement row as Agency Starter shape in cancelled status', () => {
    expect(ent.planKey).toBe('agency_starter');
    expect(ent.status).toBe('cancelled');
    expect(ent.source).toBe('manual');
    expect(ent.stripeCustomerId).toBeNull();
    expect(ent.stripeSubscriptionId).toBeNull();
    expect(ent.memberLimit).toBeNull();
    expect(ent.activeClientLimit).toBeNull();
    expect(ent.servicePackageLimit).toBeNull();
  });

  it('blocks every billable action because billing is not active', () => {
    const usage = { members: 0, activeClients: 0, activePackages: 0 };
    for (const action of ['create_service_package', 'invite_member', 'activate_client'] as const) {
      const r = checkAgencyLimit(ent, action, usage);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(AGENCY_BILLING_NOT_ACTIVE_REASON);
    }
  });

  it('billing-not-active copy is truthful for never-started and cancelled alike', () => {
    expect(AGENCY_BILLING_NOT_ACTIVE_REASON).toMatch(/billing is not active/i);
    expect(AGENCY_BILLING_NOT_ACTIVE_REASON).toMatch(/start or restart/i);
  });
});

describe('Phase 7 — Pricing page contract', () => {
  const src = readFile('src/pages/Pricing.tsx');

  it('imports the centralized plan definitions', () => {
    expect(src).toMatch(/from ['"]@\/lib\/agencyPlans['"]/);
  });

  it('renders an outside-payments disclaimer', () => {
    expect(src).toMatch(/OUTSIDE_PAYMENTS_DISCLAIMER/);
  });

  it('uses a real billing CTA, not a fake Pay/Subscribe button', () => {
    // Phase 8B replaced "Start Agency Setup" with the real "Start Agency Billing"
    // routing CTA (auth → agency dashboard, where checkout actually starts).
    expect(src).toMatch(/Start Agency Billing/);
    expect(src).not.toMatch(/Pay Now/);
    expect(src).not.toMatch(/Subscribe Now/);
  });


  it('does NOT guarantee clients/income on the pricing page', () => {
    expect(src.toLowerCase()).not.toMatch(/guaranteed (clients|income|customers)/);
  });
});

describe('Phase 7 — capability paths preserved (Phase 5/6 regression)', () => {
  const auth = readFile('src/pages/Auth.tsx');

  it('Auth page still presents four capabilities', () => {
    expect(auth).toMatch(/Driver/);
    expect(auth).toMatch(/Recruiter/);
    expect(auth).toMatch(/Assistant/);
    expect(auth).toMatch(/Agency/);
  });

  it('no fake intent=assistant or intent=agency was reintroduced', () => {
    expect(auth).not.toMatch(/intent=assistant/);
    expect(auth).not.toMatch(/intent=agency/);
  });

  it('marketing header still includes Assistants & Agencies link', () => {
    const header = readFile('src/components/marketing/MarketingHeader.tsx');
    expect(header).toMatch(/assistants-agencies/);
  });
});

describe('Phase 7C — Plan & Limits member usage accuracy', () => {
  const card = readFile('src/components/agency/AgencyPlanLimitsCard.tsx');

  it('counts active + pending members toward the member limit', () => {
    expect(card).toMatch(
      /usedMembers\s*=\s*\(members\s*\?\?\s*\[\]\)\.filter\(\s*\(m\)\s*=>\s*m\.status\s*===\s*['"]active['"]\s*\|\|\s*m\.status\s*===\s*['"]pending['"]\s*,?\s*\)\.length/,
    );
  });

  it('does not count revoked members in the usage filter', () => {
    // The filter only includes active and pending; revoked is excluded.
    const match = card.match(/m\.status\s*===\s*['"]([^'"]+)['"]/g) ?? [];
    const statuses = match.map((s) => s.replace(/.*['"]([^'"]+)['"].*/, '$1'));
    expect(statuses).toContain('active');
    expect(statuses).toContain('pending');
    expect(statuses).not.toContain('revoked');
  });

  it('counts active clients from list length (not a non-existent status field)', () => {
    expect(card).not.toMatch(/c\.status\s*===\s*['"]active['"]/);
    expect(card).toMatch(/usedClients\s*=\s*\(clients\s*\?\?\s*\[\]\)\.length/);
  });

  it('counts only active service packages (is_active !== false)', () => {
    expect(card).toMatch(
      /usedPackages\s*=\s*\(packages\s*\?\?\s*\[\]\)\.filter\(\s*\(p:\s*any\)\s*=>\s*p\.is_active\s*!==\s*false\s*\)\.length/,
    );
  });

  it('shows a helper that pending invites reserve a member seat', () => {
    expect(card).toMatch(/Pending invites count toward your member limit/);
  });
});

describe('Phase 1S-A2 — Plan & Limits card no longer implies open beta access', () => {
  const card = readFile('src/components/agency/AgencyPlanLimitsCard.tsx');

  it('does not claim a missing entitlement row opens the workspace at Starter limits', () => {
    expect(card).not.toMatch(/your agency workspace is open at Agency Starter limits/i);
    expect(card).not.toMatch(/\{!hasRow &&/);
  });

  it('reserves beta copy for explicitly grandfathered manual_beta workspaces', () => {
    expect(card).toContain('isGrandfatheredBeta');
    expect(card).toMatch(/Grandfathered beta workspace/);
    expect(card).toMatch(/New agencies must start a paid plan/);
  });
});

describe('Phase 7 Cleanup — entitlement visibility', () => {
  // The migration grants every active agency member read access to the
  // entitlement row so the dashboard cannot show a fake beta fallback
  // while a real entitlement exists.
  const migrations = fs
    .readdirSync(path.join(process.cwd(), 'supabase/migrations'))
    .map((f) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8'))
    .join('\n');

  it('latest get_agency_entitlement allows any active member, not only owner/admin', () => {
    // Latest definition no longer restricts to ('agency_owner','agency_admin').
    const lastIdx = migrations.lastIndexOf('FUNCTION public.get_agency_entitlement');
    expect(lastIdx).toBeGreaterThan(-1);
    const tail = migrations.slice(lastIdx);
    expect(tail).not.toMatch(/agency_owner['"]?\s*,\s*['"]agency_admin/);
  });

  it('plan_key check constraint excludes assistant_free', () => {
    const lastIdx = migrations.lastIndexOf('agency_entitlements_plan_key_check');
    expect(lastIdx).toBeGreaterThan(-1);
    const tail = migrations.slice(lastIdx, lastIdx + 400);
    expect(tail).toMatch(/agency_starter/);
    expect(tail).toMatch(/agency_team/);
    expect(tail).toMatch(/agency_growth/);
    expect(tail).not.toMatch(/assistant_free/);
  });
});

describe('Phase 7 Cleanup — server-side limit enforcement', () => {
  const migrations = fs
    .readdirSync(path.join(process.cwd(), 'supabase/migrations'))
    .map((f) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8'))
    .join('\n');

  it('defines assert_agency_limit helper', () => {
    expect(migrations).toMatch(/FUNCTION public\.assert_agency_limit/);
  });

  it('defines get_effective_agency_limits helper', () => {
    expect(migrations).toMatch(/FUNCTION public\.get_effective_agency_limits/);
  });

  it('create_agency_package calls assert_agency_limit', () => {
    const idx = migrations.lastIndexOf('CREATE OR REPLACE FUNCTION public.create_agency_package');
    expect(idx).toBeGreaterThan(-1);
    const body = migrations.slice(idx, idx + 2500);
    expect(body).toMatch(/assert_agency_limit\([^)]*'create_service_package'\)/);
  });

  it('invite_agency_member calls assert_agency_limit for net-new invites', () => {
    const idx = migrations.lastIndexOf('CREATE OR REPLACE FUNCTION public.invite_agency_member');
    expect(idx).toBeGreaterThan(-1);
    const body = migrations.slice(idx, idx + 2500);
    expect(body).toMatch(/assert_agency_limit\([^)]*'invite_member'\)/);
  });

  it('driver_decide_delegation calls assert_agency_limit for new clients', () => {
    const idx = migrations.lastIndexOf('CREATE OR REPLACE FUNCTION public.driver_decide_delegation');
    expect(idx).toBeGreaterThan(-1);
    const body = migrations.slice(idx, idx + 5000);
    expect(body).toMatch(/assert_agency_limit\([^)]*'activate_client'\)/);
  });

  it('does not enforce agency limits on direct driver_assistants invites', () => {
    // Direct driver→assistant invites live in src/hooks/useAssistants.ts /
    // driver-assistant RPCs and must remain independent of agency limits.
    const hook = readFile('src/hooks/useAssistants.ts');
    expect(hook).not.toMatch(/assert_agency_limit/);
  });
});

describe('Phase 7 Cleanup — driver-facing payment clarity', () => {
  const src = readFile('src/pages/DriverAssistantControl.tsx');
  it('includes outside-payment disclaimer wording', () => {
    const lc = src.toLowerCase();
    expect(lc).toMatch(/does\s*<b>\s*not\s*<\/b>|does not/);
    expect(lc).toMatch(/outside the platform/);
    expect(lc).toMatch(/revoke/);
  });
});

describe('Phase 7 Cleanup — Phase 5/6 invariants still intact', () => {
  it('auth continuation still uses `next` param sanitization', () => {
    const auth = readFile('src/lib/authNavigation.ts');
    expect(auth).toMatch(/sanitizeNextPath|isSafeInternalPath/);
  });

  it('AppShell wrapper is still applied to authenticated agency/assistant pages', () => {
    for (const f of [
      'src/pages/AgencyDashboard.tsx',
      'src/pages/AssistantDashboard.tsx',
      'src/pages/DriverAssistantControl.tsx',
    ]) {
      expect(readFile(f)).toMatch(/AppShell/);
    }
  });

  it('Pricing page still has no fake Stripe Subscribe/Pay button', () => {
    const src = readFile('src/pages/Pricing.tsx');
    expect(src).not.toMatch(/Pay Now/);
    expect(src).not.toMatch(/Subscribe Now/);
  });

  it('Agency Plan & Limits card does not render a Stripe pay/subscribe button', () => {
    const card = readFile('src/components/agency/AgencyPlanLimitsCard.tsx');
    expect(card).not.toMatch(/Subscribe\s*Now/);
    expect(card).not.toMatch(/Pay\s*Now/);
  });
});
