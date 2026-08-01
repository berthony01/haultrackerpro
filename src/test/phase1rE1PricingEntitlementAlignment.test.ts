/**
 * Phase 1R-E1-R1 — Canonical pricing, limits, and included-entitlement
 * alignment: STATIC CONTRACT PROOF.
 *
 * This suite is written to REJECT every known-bad implementation of the
 * candidate SQL and the surrounding client/edge contracts:
 *   - missing candidate header or transaction envelope
 *   - extra helper functions or trigger DDL
 *   - wrong agency member column (`user_id` instead of `member_user_id`)
 *   - missing agency profile ownership proof
 *   - dual paid entitlement resolving to a free (non-zero) limit
 *   - missing advisory locking or unstructured guard errors
 *   - backfill touching anything other than `active_opportunity_limit`
 *   - wrong Fleet checkout code/message, or Fleet rejected too late
 *   - incomplete public pricing copy or generic agency CTAs
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
import {
  RECRUITER_CHECKOUT_MESSAGES,
  RECRUITER_SUPPORT_CODES,
} from '@/lib/opportunities/recruiterCheckoutMessages';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CANDIDATE_PATH =
  'supabase/migration-candidates/20260801013000_phase1r_e1_pricing_entitlement_alignment.sql';
const sql = read(CANDIDATE_PATH);

// ---------------------------------------------------------------------------
// Client matrix
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — canonical recruiter limit matrix', () => {
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

  it('keeps the fixed agency → recruiter inclusion map', () => {
    expect(AGENCY_INCLUDED_RECRUITER_TIER).toEqual({
      agency_starter: 'starter',
      agency_team: 'growth',
      agency_growth: 'fleet',
    });
  });

  it('marks only fleet as preview-only and refuses new fleet checkout', () => {
    expect([...RECRUITER_PREVIEW_ONLY_TIERS]).toEqual(['fleet']);
    expect(isRecruiterTierAvailableForNewCheckout('fleet')).toBe(false);
    expect(isRecruiterTierAvailableForNewCheckout('starter')).toBe(true);
    expect(isRecruiterTierAvailableForNewCheckout('growth')).toBe(true);
    expect(isRecruiterTierAvailableForNewCheckout(null)).toBe(false);
    expect(isRecruiterTierAvailableForNewCheckout(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Candidate SQL — structure
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — candidate SQL structure', () => {
  it('begins with the exact candidate header', () => {
    expect(sql.split('\n')[0]).toBe(
      '-- CANDIDATE MIGRATION — NOT APPLIED LIVE.',
    );
  });

  it('wraps everything in exactly one explicit transaction', () => {
    expect(sql.match(/^BEGIN;$/gm) ?? []).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm) ?? []).toHaveLength(1);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('COMMIT;'));
    expect(sql).not.toMatch(/^ROLLBACK;/m);
  });

  it('defines exactly the five contracted functions and nothing else', () => {
    const defined = [
      ...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-z_]+)\s*\(/g),
    ].map((m) => m[1]);
    expect(defined.sort()).toEqual(
      [
        'effective_recruiter_active_opportunity_limit',
        'effective_recruiter_tier',
        'opportunities_billing_guard',
        'recruiter_has_priority_plan',
        'recruiter_plan_limit',
      ].sort(),
    );
    expect(sql).not.toMatch(/\bCREATE FUNCTION\b/);
  });

  it('defines no agency helper function', () => {
    expect(sql).not.toMatch(/FUNCTION\s+public\.agency_included_recruiter_tier/);
  });

  it('performs no trigger, table, index, policy, drop, or delete DDL/DML', () => {
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql).not.toMatch(/DROP\s+TRIGGER/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|POLICY|TYPE)/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it('pins search_path on every defined function', () => {
    const defs = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$/g) ?? [];
    expect(defs).toHaveLength(5);
    for (const d of defs) {
      expect(d).toMatch(/SET search_path = public/);
    }
  });
});

// ---------------------------------------------------------------------------
// Candidate SQL — entitlement semantics
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — candidate entitlement semantics', () => {
  it('encodes the canonical plan ceilings', () => {
    expect(sql).toMatch(/WHEN 'starter' THEN 5/);
    expect(sql).toMatch(/WHEN 'growth'\s+THEN 15/);
    expect(sql).toMatch(/WHEN 'fleet'\s+THEN 25/);
    expect(sql).toMatch(/ELSE 1\s/);
  });

  it('uses the exact tier vocabulary including conflict', () => {
    for (const tier of [
      'free_standard',
      'starter',
      'growth',
      'fleet',
      'conflict',
    ]) {
      expect(sql).toContain(`'${tier}'`);
    }
    // The retired vocabulary must be gone.
    expect(sql).not.toMatch(/RETURN 'none';/);
  });

  it('requires agency profile ownership and the production member column', () => {
    expect(sql).toMatch(/public\.agency_profiles ap/);
    expect(sql).toMatch(/ap\.owner_user_id = _owner_id/);
    expect(sql).toMatch(/am\.member_user_id = _owner_id/);
    expect(sql).toMatch(/am\.agency_id = ap\.id/);
    expect(sql).toMatch(/ae\.agency_id = ap\.id/);
    expect(sql).not.toMatch(/\bam\.user_id\b/);
    expect(sql).not.toMatch(/\bm\.user_id\b/);
  });

  it('requires owner-only active membership and paid, non-beta agency status', () => {
    expect(sql).toMatch(/am\.role::text = 'agency_owner'/);
    expect(sql).toMatch(/am\.status::text = 'active'/);
    expect(sql).toMatch(/ae\.source IN \('stripe', 'manual', 'admin_seed'\)/);
    expect(sql).toMatch(/ae\.status IN \('active', 'trialing'\)/);
    expect(sql).not.toMatch(/'manual_beta'/);
  });

  it('encodes the agency inclusion map inline', () => {
    expect(sql).toMatch(/WHEN 'agency_starter' THEN 'starter'/);
    expect(sql).toMatch(/WHEN 'agency_team'\s+THEN 'growth'/);
    expect(sql).toMatch(/WHEN 'agency_growth'\s+THEN 'fleet'/);
  });

  it('resolves multiple qualifying rows deterministically, never by bare LIMIT 1', () => {
    const limitOnes = sql.match(/LIMIT 1/g) ?? [];
    const orderedLimits = sql.match(/ORDER BY[\s\S]{0,320}?LIMIT 1/g) ?? [];
    expect(limitOnes.length).toBeGreaterThan(0);
    expect(orderedLimits.length).toBe(limitOnes.length);
  });

  it('returns conflict — not a free tier — for dual paid business entitlement', () => {
    expect(sql).toMatch(
      /IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN\s*RETURN 'conflict';/,
    );
    expect(sql).not.toMatch(
      /IF _recruiter_tier IS NOT NULL AND _agency_tier IS NOT NULL THEN\s*RETURN 'none';/,
    );
  });

  it('maps conflict to zero and fails closed on unknown tiers', () => {
    expect(sql).toMatch(/WHEN 'conflict'\s+THEN 0/);
    expect(sql).toMatch(/WHEN 'free_standard' THEN 1/);
    expect(sql).toMatch(/ELSE 0\s*\n\s*END/);
  });

  it('treats only growth and fleet as priority plans', () => {
    expect(sql).toMatch(
      /public\.effective_recruiter_tier\(_recruiter_id\) IN \('growth', 'fleet'\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Candidate SQL — guard behavior
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — candidate guard behavior', () => {
  it('keeps the admin bypass and the canonical readiness helper', () => {
    expect(sql).toMatch(/IF public\.is_admin\(auth\.uid\(\)\) THEN\s*RETURN NEW;/);
    expect(sql).toContain(
      'public.current_user_can_manage_recruiter_opportunities(NEW.recruiter_id)',
    );
    expect(sql).toContain(
      'Complete your recruiter profile to publish opportunities.',
    );
    expect(sql).not.toContain(
      'recruiter_profile_can_manage_opportunities(NEW.recruiter_id)',
    );
  });

  it('only consumes a slot on a real transition into active', () => {
    expect(sql).toMatch(/_is_becoming_active := \(NEW\.status = 'active'\);/);
    expect(sql).toMatch(
      /_is_becoming_active := \(NEW\.status = 'active' AND OLD\.status IS DISTINCT FROM 'active'\);/,
    );
    expect(sql).toMatch(/IF NOT _is_becoming_active THEN\s*RETURN NEW;/);
  });

  it('acquires a transaction-scoped advisory lock keyed by recruiter before counting', () => {
    expect(sql).toMatch(
      /pg_advisory_xact_lock\(_lock_namespace, hashtext\(NEW\.recruiter_id::text\)\)/,
    );
    expect(sql).toMatch(/_lock_namespace\s+constant integer := \d+;/);
    expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      sql.indexOf('SELECT COUNT(*)::int INTO _active_count'),
    );
  });

  it('raises a structured fail-closed error when the effective limit is zero', () => {
    expect(sql).toMatch(
      /_limit IS NULL OR _limit <= 0 THEN[\s\S]*?ERRCODE = '23514'[\s\S]*?"code": "business_entitlement_conflict"/,
    );
  });

  it('raises the exact limit-reached message and structured detail', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Active opportunity limit reached.'");
    expect(sql).toMatch(
      /'Active opportunity limit reached\.'[\s\S]*?ERRCODE = '23514'[\s\S]*?'code', 'active_opportunity_limit_reached'[\s\S]*?'limit', _limit[\s\S]*?'active_count', _active_count/,
    );
  });

  it('excludes the row under change from the active count', () => {
    expect(sql).toMatch(/o\.id IS DISTINCT FROM NEW\.id/);
  });
});

// ---------------------------------------------------------------------------
// Candidate SQL — backfill + privileges
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — candidate backfill and privileges', () => {
  it('performs exactly one UPDATE and touches only active_opportunity_limit', () => {
    const updates = sql.match(/^UPDATE /gm) ?? [];
    expect(updates).toHaveLength(1);
    expect(sql).toMatch(
      /UPDATE public\.recruiter_billing_profiles b\s*\nSET active_opportunity_limit = public\.recruiter_plan_limit\(b\.plan\)\s*\nWHERE b\.active_opportunity_limit IS DISTINCT FROM public\.recruiter_plan_limit\(b\.plan\);/,
    );
    expect(sql).not.toMatch(/SET[\s\S]{0,200}updated_at/);
  });

  it('leaves recruiter_plan_limit privileges untouched', () => {
    expect(sql).not.toMatch(/ON FUNCTION public\.recruiter_plan_limit/);
  });

  it('locks the new helpers down to service_role only', () => {
    for (const fn of [
      'effective_recruiter_tier(uuid)',
      'effective_recruiter_active_opportunity_limit(uuid)',
      'recruiter_has_priority_plan(uuid)',
      'opportunities_billing_guard()',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon;`);
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM authenticated;`,
      );
      expect(sql).toContain(
        `GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`,
      );
    }
  });

  it('grants PGlite test roles only when they exist', () => {
    expect(sql).toMatch(/ARRAY\['pglite_test', 'postgres_test_runner'\]/);
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = _role\)/);
  });
});

// ---------------------------------------------------------------------------
// Fleet checkout contract
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — Fleet checkout contract', () => {
  const src = read('supabase/functions/create-recruiter-checkout/index.ts');

  it('rejects fleet with the exact status, code, and message', () => {
    expect(src).toContain('PREVIEW_ONLY_RECRUITER_PLANS');
    expect(src).toMatch(/PREVIEW_ONLY_RECRUITER_PLANS[\s\S]*?"fleet"/);
    expect(src).toMatch(
      /PREVIEW_ONLY_RECRUITER_PLANS\.has\(plan\)[\s\S]{0,400}?code: "plan_unavailable"[\s\S]{0,200}?message: "Fleet is not available for new subscriptions yet\."[\s\S]{0,200}?status: 400/,
    );
    expect(src).not.toContain('not open for new subscriptions yet');
  });

  it('rejects fleet before any price lookup, claim, customer, or Stripe use', () => {
    const rejectIdx = src.indexOf('PREVIEW_ONLY_RECRUITER_PLANS.has(plan)');
    expect(rejectIdx).toBeGreaterThan(0);
    for (const later of [
      'Deno.env.get(PLAN_TO_ENV[plan])',
      'createBusinessCheckoutClaimStore',
      'claim_recruiter_checkout_intent',
      'new Stripe(stripeKey',
    ]) {
      const idx = src.indexOf(later);
      expect(idx).toBeGreaterThan(rejectIdx);
    }
  });

  it('surfaces plan_unavailable as a safe, non-support client message', () => {
    expect(RECRUITER_CHECKOUT_MESSAGES.plan_unavailable).toBe(
      'Fleet is not available for new subscriptions yet.',
    );
    expect(RECRUITER_SUPPORT_CODES.has('plan_unavailable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Public copy + webhook alignment
// ---------------------------------------------------------------------------

describe('Phase 1R-E1-R1 — public copy and webhook alignment', () => {
  it('uses the canonical ceilings in the stripe webhook', () => {
    const src = read('supabase/functions/stripe-webhook/index.ts');
    expect(src).toMatch(
      /RECRUITER_PLAN_LEGACY_LIMITS[\s\S]*?none:\s*1,\s*starter:\s*5,\s*growth:\s*15,\s*fleet:\s*25/,
    );
    expect(src).not.toMatch(/none:\s*0,\s*starter:\s*1,\s*growth:\s*5/);
  });

  it('states standard limits and unlimited drafts on the pricing page', () => {
    const src = read('src/pages/Pricing.tsx');
    expect(src).toContain('1 active opportunity at a time');
    expect(src).toContain('Unlimited drafts');
    expect(src).toContain('Up to 5 active opportunities');
    expect(src).toContain('Up to 15 active opportunities');
    expect(src).toContain('Up to 25 active opportunities');
    expect(src).toContain(
      'New standalone Fleet subscriptions are not available yet',
    );
    expect(src).toContain('previewOnly: true');
  });

  it('uses plan-specific agency CTAs', () => {
    const src = read('src/pages/Pricing.tsx');
    expect(src).toContain('Choose {p.label}');
    const plans = read('src/lib/agencyPlans.ts');
    for (const label of ['Agency Starter', 'Agency Team', 'Agency Growth']) {
      expect(plans).toContain(`label: '${label}'`);
    }
  });

  it('preserves the legal, referral, and service-payment disclaimers', () => {
    const src = read('src/pages/Pricing.tsx');
    expect(src).toContain('OUTSIDE_PAYMENTS_DISCLAIMER');
    expect(src).toMatch(/Payments for assistant/);
  });

  it('states the included recruiter tier in public agency plan bullets', () => {
    const src = read('src/lib/agencyPlans.ts');
    expect(src).toContain('Includes Recruiter Starter — 5 active opportunities');
    expect(src).toContain('Includes Recruiter Growth — 15 active opportunities');
    expect(src).toContain('Includes Recruiter Fleet — 25 active opportunities');
  });

  it('shows Fleet as a disabled preview action in the recruiter dashboard', () => {
    const panel = read('src/components/opportunities/RecruiterBillingPanel.tsx');
    expect(panel).toContain("'Fleet Preview'");
    expect(panel).toMatch(/previewOnlyBlocked = p\.previewOnly === true && !isCurrent/);
    expect(panel).toMatch(/disabled =[\s\S]{0,200}previewOnlyBlocked/);
    expect(panel).not.toContain("'Not available yet'");
  });
});
