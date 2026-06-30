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
  checkAgencyLimit,
  defaultBetaEntitlement,
  effectiveLimits,
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

describe('Phase 7 — limit helper', () => {
  const ent = defaultBetaEntitlement('agency-1'); // Agency Starter defaults

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

  it('treats no entitlement row as Agency Starter / manual_beta (safe default)', () => {
    expect(ent.status).toBe('manual_beta');
    expect(ent.planKey).toBe('agency_starter');
    const limits = effectiveLimits(ent);
    expect(limits.activeClientLimit).toBe(5);
    expect(limits.memberLimit).toBe(2);
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

  it('does NOT render a fake Pay/Subscribe button for agency plans', () => {
    // The Phase 7 CTA is "Start Agency Setup", not a Stripe-style button.
    expect(src).toMatch(/Start Agency Setup/);
    // Make sure no hardcoded "Pay Now" / "Subscribe Now" CTA leaked into the agency section.
    expect(src).not.toMatch(/Pay Now/);
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
