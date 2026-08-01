/**
 * Phase 1R-E1 — Canonical pricing, limits, and included-entitlement alignment.
 *
 * Static contract proof: the 1/5/15/25 active-opportunity matrix, Fleet
 * preview-only status, agency-included recruiter tiers, and the candidate
 * SQL that mirrors them are all consistent across the client library,
 * marketing copy, and edge functions.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS,
  RECRUITER_PREVIEW_ONLY_TIERS,
  isRecruiterTierAvailableForNewCheckout,
  getRecruiterPlanCapabilities,
} from '@/lib/recruiterCapabilities';
import { AGENCY_INCLUDED_RECRUITER_TIER } from '@/lib/billing/effectiveBusinessEntitlement';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Phase 1R-E1 — canonical recruiter limit matrix', () => {
  it('locks the 1/5/15/25 ceiling', () => {
    expect(RECRUITER_TIER_ACTIVE_OPPORTUNITY_LIMITS).toEqual({
      free_verified: 1,
      starter: 5,
      growth: 15,
      fleet: 25,
    });
  });

  it('never reports unlimited standard posting and always exposes a finite limit', () => {
    for (const [plan, expected] of [
      [null, 1],
      ['starter', 5],
      ['growth', 15],
      ['fleet', 25],
    ] as const) {
      const caps = getRecruiterPlanCapabilities({ plan, status: 'active' });
      expect(caps.unlimitedStandardPosts).toBe(false);
      expect(caps.activeOpportunityLimit).toBe(expected);
    }
  });

  it('falls back to the free ceiling for unknown or non-paying plans', () => {
    expect(
      getRecruiterPlanCapabilities({ plan: 'bogus', status: 'active' })
        .activeOpportunityLimit,
    ).toBe(1);
    expect(
      getRecruiterPlanCapabilities({ plan: 'growth', status: 'canceled' })
        .activeOpportunityLimit,
    ).toBe(1);
  });
});

describe('Phase 1R-E1 — Fleet is preview-only', () => {
  it('marks only fleet as preview-only', () => {
    expect([...RECRUITER_PREVIEW_ONLY_TIERS]).toEqual(['fleet']);
  });

  it('refuses new fleet checkout and allows the rest', () => {
    expect(isRecruiterTierAvailableForNewCheckout('fleet')).toBe(false);
    expect(isRecruiterTierAvailableForNewCheckout('starter')).toBe(true);
    expect(isRecruiterTierAvailableForNewCheckout('growth')).toBe(true);
    expect(isRecruiterTierAvailableForNewCheckout(null)).toBe(false);
    expect(isRecruiterTierAvailableForNewCheckout(undefined)).toBe(false);
  });

  it('blocks new fleet checkout in the recruiter checkout edge function', () => {
    const src = read('supabase/functions/create-recruiter-checkout/index.ts');
    expect(src).toContain('PREVIEW_ONLY_RECRUITER_PLANS');
    expect(src).toMatch(/PREVIEW_ONLY_RECRUITER_PLANS[\s\S]*?"fleet"/);
    expect(src).toContain('not open for new subscriptions yet');
  });
});

describe('Phase 1R-E1 — agency-included recruiter tiers', () => {
  it('keeps the fixed agency → recruiter inclusion map', () => {
    expect(AGENCY_INCLUDED_RECRUITER_TIER).toEqual({
      agency_starter: 'starter',
      agency_team: 'growth',
      agency_growth: 'fleet',
    });
  });

  it('states the included recruiter tier in public agency plan bullets', () => {
    const src = read('src/lib/agencyPlans.ts');
    expect(src).toContain('Includes Recruiter Starter — 5 active opportunities');
    expect(src).toContain('Includes Recruiter Growth — 15 active opportunities');
    expect(src).toContain('Includes Recruiter Fleet — 25 active opportunities');
  });
});

describe('Phase 1R-E1 — webhook and pricing copy alignment', () => {
  it('uses the canonical ceilings in the stripe webhook', () => {
    const src = read('supabase/functions/stripe-webhook/index.ts');
    expect(src).toMatch(
      /RECRUITER_PLAN_LEGACY_LIMITS[\s\S]*?none:\s*1,\s*starter:\s*5,\s*growth:\s*15,\s*fleet:\s*25/,
    );
    expect(src).not.toMatch(/none:\s*0,\s*starter:\s*1,\s*growth:\s*5/);
  });

  it('advertises the canonical ceilings on the pricing page', () => {
    const src = read('src/pages/Pricing.tsx');
    expect(src).toContain('1 active opportunity at a time');
    expect(src).toContain('5 active opportunities');
    expect(src).toContain('15 active opportunities');
    expect(src).toContain('25 active opportunities');
    expect(src).toContain('previewOnly: true');
  });
});

describe('Phase 1R-E1 — candidate SQL mirrors the client matrix', () => {
  const sql = read(
    'supabase/migration-candidates/20260801013000_phase1r_e1_pricing_entitlement_alignment.sql',
  );

  it('encodes the canonical plan ceilings', () => {
    expect(sql).toMatch(/WHEN 'starter' THEN 5/);
    expect(sql).toMatch(/WHEN 'growth'\s+THEN 15/);
    expect(sql).toMatch(/WHEN 'fleet'\s+THEN 25/);
    expect(sql).toMatch(/ELSE 1\s/);
  });

  it('encodes the agency inclusion map', () => {
    expect(sql).toMatch(/WHEN 'agency_starter' THEN 'starter'/);
    expect(sql).toMatch(/WHEN 'agency_team'\s+THEN 'growth'/);
    expect(sql).toMatch(/WHEN 'agency_growth'\s+THEN 'fleet'/);
  });

  it('fails closed on dual paid business entitlement', () => {
    expect(sql).toContain('Fail closed on dual paid business entitlement');
    expect(sql).toMatch(
      /IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN\s*RETURN 'none';/,
    );
  });

  it('gates posting on the canonical readiness helper, not on billing rows', () => {
    expect(sql).toContain('recruiter_profile_can_manage_opportunities(NEW.recruiter_id)');
    expect(sql).not.toContain('Recruiter billing required to submit opportunities');
  });

  it('requires owner-only active membership for agency inclusion', () => {
    expect(sql).toMatch(/m\.role = 'agency_owner'/);
    expect(sql).toMatch(/m\.status = 'active'/);
  });
});
