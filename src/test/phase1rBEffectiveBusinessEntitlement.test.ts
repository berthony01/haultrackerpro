/**
 * Phase 1R-B — Contract tests for the pure effective business entitlement
 * resolver. These tests exercise the real module directly (no mocks).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  AGENCY_INCLUDED_RECRUITER_TIER,
  mapAgencyPlanToIncludedRecruiterTier,
  resolveEffectiveBusinessEntitlement,
  type EffectiveBusinessEntitlementInput,
} from '@/lib/billing/effectiveBusinessEntitlement';

const MODULE_PATH = path.resolve(
  process.cwd(),
  'src/lib/billing/effectiveBusinessEntitlement.ts',
);

type DeepPartialInput = {
  sourceState?: Partial<EffectiveBusinessEntitlementInput['sourceState']>;
  recruiterBilling?: Partial<EffectiveBusinessEntitlementInput['recruiterBilling']>;
  agencyEntitlement?: Partial<EffectiveBusinessEntitlementInput['agencyEntitlement']>;
  agencyMembership?: Partial<EffectiveBusinessEntitlementInput['agencyMembership']>;
  recruiterProfile?: Partial<EffectiveBusinessEntitlementInput['recruiterProfile']>;
};

function makeInput(overrides: DeepPartialInput = {}): EffectiveBusinessEntitlementInput {
  return {
    sourceState: {
      recruiterBilling: 'ready',
      agencyEntitlement: 'ready',
      ...(overrides.sourceState ?? {}),
    },
    recruiterBilling: {
      hasRow: false,
      plan: null,
      status: null,
      ...(overrides.recruiterBilling ?? {}),
    },
    agencyEntitlement: {
      hasRow: false,
      planKey: null,
      status: null,
      source: null,
      ...(overrides.agencyEntitlement ?? {}),
    },
    agencyMembership: {
      role: null,
      status: null,
      ...(overrides.agencyMembership ?? {}),
    },
    recruiterProfile: {
      exists: true,
      readyToPost: true,
      suspended: false,
      ...(overrides.recruiterProfile ?? {}),
    },
  };
}

/** Owner-with-active-membership agency shape helper. */
function agencyOwner(
  planKey: string,
  status: string,
  source: string = 'stripe',
): DeepPartialInput {
  return {
    agencyEntitlement: { hasRow: true, planKey, status, source },
    agencyMembership: { role: 'agency_owner', status: 'active' },
  };
}

describe('Phase 1R-B — mapAgencyPlanToIncludedRecruiterTier', () => {
  it('1. maps the exact three paid agency plans', () => {
    expect(mapAgencyPlanToIncludedRecruiterTier('agency_starter')).toBe('starter');
    expect(mapAgencyPlanToIncludedRecruiterTier('agency_team')).toBe('growth');
    expect(mapAgencyPlanToIncludedRecruiterTier('agency_growth')).toBe('fleet');
  });

  it('1b. AGENCY_INCLUDED_RECRUITER_TIER contains exactly those three mappings', () => {
    expect(AGENCY_INCLUDED_RECRUITER_TIER).toEqual({
      agency_starter: 'starter',
      agency_team: 'growth',
      agency_growth: 'fleet',
    });
    expect(Object.keys(AGENCY_INCLUDED_RECRUITER_TIER)).toHaveLength(3);
  });

  it.each([
    ['assistant_free', 'assistant_free'],
    ['unknown token', 'agency_enterprise'],
    ['empty string', ''],
    ['whitespace', ' agency_team '],
    ['uppercase', 'AGENCY_TEAM'],
    ['null', null],
    ['undefined', undefined],
    ['number', 3],
    ['object', { planKey: 'agency_team' }],
  ])('2. returns null for %s', (_label, value) => {
    expect(mapAgencyPlanToIncludedRecruiterTier(value)).toBeNull();
  });
});

describe('Phase 1R-B — explicit recruiter paid entitlement', () => {
  it.each([
    ['starter', 'starter'],
    ['growth', 'growth'],
    ['fleet', 'fleet'],
  ] as const)('3. active recruiter %s maps exactly', (plan, tier) => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({ recruiterBilling: { hasRow: true, plan, status: 'active' } }),
    );
    expect(result.state).toBe('resolved');
    expect(result.effectiveRecruiterTier).toBe(tier);
    expect(result.entitlementSource).toBe('recruiter_subscription');
    expect(result.billingManagementContext).toBe('recruiter');
    expect(result.conflictReason).toBeNull();
  });

  it.each(['starter', 'growth', 'fleet'] as const)(
    '4. trialing recruiter %s maps exactly',  // trial-allowlist: Stripe subscription status literal, not user-facing copy
    (plan) => {
      const result = resolveEffectiveBusinessEntitlement(
        makeInput({ recruiterBilling: { hasRow: true, plan, status: 'trialing' } }),  // trial-allowlist: Stripe subscription status literal, not user-facing copy
      );
      expect(result.effectiveRecruiterTier).toBe(plan);
      expect(result.entitlementSource).toBe('recruiter_subscription');
      expect(result.billingManagementContext).toBe('recruiter');
    },
  );

  it('5. past_due recruiter grants no premium but selects recruiter billing context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({ recruiterBilling: { hasRow: true, plan: 'growth', status: 'past_due' } }),
    );
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.entitlementSource).toBe('free_standard');
    expect(result.billingManagementContext).toBe('recruiter');
  });

  it.each([
    ['inactive', { hasRow: true, plan: 'growth', status: 'inactive' }],
    ['canceled', { hasRow: true, plan: 'growth', status: 'canceled' }],
    ['cancelled', { hasRow: true, plan: 'growth', status: 'cancelled' }],
    ['incomplete', { hasRow: true, plan: 'growth', status: 'incomplete' }],
    ['incomplete_expired', { hasRow: true, plan: 'growth', status: 'incomplete_expired' }],
    ['unknown status', { hasRow: true, plan: 'growth', status: 'wat' }],
    ['unknown plan', { hasRow: true, plan: 'enterprise', status: 'active' }],
    ['null plan', { hasRow: true, plan: null, status: 'active' }],
    ['missing row', { hasRow: false, plan: 'growth', status: 'active' }],
  ])('6. %s grants no recruiter premium', (_label, recruiterBilling) => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({ recruiterBilling: recruiterBilling as never }),
    );
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.entitlementSource).toBe('free_standard');
    expect(result.billingManagementContext).toBe('none');
  });
});

describe('Phase 1R-B — agency-included recruiter entitlement', () => {
  it.each([
    ['agency_starter', 'starter'],
    ['agency_team', 'growth'],
    ['agency_growth', 'fleet'],
  ] as const)('7. active owner on %s includes %s', (planKey, tier) => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner(planKey, 'active')),
    );
    expect(result.state).toBe('resolved');
    expect(result.effectiveRecruiterTier).toBe(tier);
    expect(result.effectiveAgencyPlan).toBe(planKey);
    expect(result.entitlementSource).toBe('agency_included');
    expect(result.billingManagementContext).toBe('agency');
  });

  it.each([
    ['agency_starter', 'starter'],
    ['agency_team', 'growth'],
    ['agency_growth', 'fleet'],
  ] as const)('8. trialing owner on %s includes %s', (planKey, tier) => {  // trial-allowlist: Stripe subscription status literal, not user-facing copy
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner(planKey, 'trialing')),  // trial-allowlist: Stripe subscription status literal, not user-facing copy
    );
    expect(result.effectiveRecruiterTier).toBe(tier);
    expect(result.effectiveAgencyPlan).toBe(planKey);
    expect(result.entitlementSource).toBe('agency_included');
  });

  it('9. manual_beta preserves the agency plan but includes no recruiter premium and no billing context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner('agency_team', 'manual_beta', 'manual')),
    );
    expect(result.effectiveAgencyPlan).toBe('agency_team');
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.entitlementSource).toBe('free_standard');
    expect(result.billingManagementContext).toBe('none');
  });

  it('9b. manual_beta with stripe source still exposes no billing context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner('agency_team', 'manual_beta', 'stripe')),
    );
    expect(result.billingManagementContext).toBe('none');
    expect(result.effectiveRecruiterTier).toBe('free_verified');
  });

  it('10. past_due agency grants nothing but Stripe source selects agency billing context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner('agency_growth', 'past_due', 'stripe')),
    );
    expect(result.effectiveAgencyPlan).toBeNull();
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.entitlementSource).toBe('free_standard');
    expect(result.billingManagementContext).toBe('agency');
  });

  it('10b. past_due agency with non-stripe source exposes no billing context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner('agency_growth', 'past_due', 'manual')),
    );
    expect(result.billingManagementContext).toBe('none');
  });

  it('11. assistant_free never grants agency plan or recruiter premium', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner('assistant_free', 'active', 'stripe')),
    );
    expect(result.effectiveAgencyPlan).toBeNull();
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.entitlementSource).toBe('free_standard');
    expect(result.billingManagementContext).toBe('none');
  });

  it.each(['agency_admin', 'agency_member', 'assistant', '', null, undefined])(
    '12/13. role %s never receives included recruiter premium',
    (role) => {
      const result = resolveEffectiveBusinessEntitlement(
        makeInput({
          agencyEntitlement: {
            hasRow: true,
            planKey: 'agency_team',
            status: 'active',
            source: 'stripe',
          },
          agencyMembership: { role: role as never, status: 'active' },
        }),
      );
      expect(result.effectiveRecruiterTier).toBe('free_verified');
      expect(result.entitlementSource).toBe('free_standard');
      expect(result.effectiveAgencyPlan).toBe('agency_team');
    },
  );

  it.each(['inactive', 'pending', 'removed', 'suspended', '', null, undefined])(
    '13b. membership status %s never receives included recruiter premium',
    (status) => {
      const result = resolveEffectiveBusinessEntitlement(
        makeInput({
          agencyEntitlement: {
            hasRow: true,
            planKey: 'agency_team',
            status: 'active',
            source: 'stripe',
          },
          agencyMembership: { role: 'agency_owner', status: status as never },
        }),
      );
      expect(result.effectiveRecruiterTier).toBe('free_verified');
      expect(result.entitlementSource).toBe('free_standard');
    },
  );

  it('14. missing recruiter profile prevents inclusion but preserves active Stripe agency plan/context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        ...agencyOwner('agency_growth', 'active', 'stripe'),
        recruiterProfile: { exists: false, readyToPost: false, suspended: false },
      }),
    );
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.effectiveAgencyPlan).toBe('agency_growth');
    expect(result.entitlementSource).toBe('none');
    expect(result.billingManagementContext).toBe('agency');
    expect(result.canPostStandardOpportunities).toBe(false);
  });

  it('15. missing explicit agency row prevents all agency entitlement', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        agencyEntitlement: {
          hasRow: false,
          planKey: 'agency_team',
          status: 'active',
          source: 'stripe',
        },
        agencyMembership: { role: 'agency_owner', status: 'active' },
      }),
    );
    expect(result.effectiveAgencyPlan).toBeNull();
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.billingManagementContext).toBe('none');
  });

  it.each([
    ['unknown plan', { hasRow: true, planKey: 'agency_ultra', status: 'active', source: 'stripe' }],
    ['unknown status', { hasRow: true, planKey: 'agency_team', status: 'wat', source: 'stripe' }],
    ['unknown source', { hasRow: true, planKey: 'agency_team', status: 'past_due', source: 'wat' }],
    ['null plan', { hasRow: true, planKey: null, status: 'active', source: 'stripe' }],
    ['undefined status', { hasRow: true, planKey: 'agency_team', status: undefined, source: 'stripe' }],
  ])('16. %s fails safely', (_label, agencyEntitlement) => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        agencyEntitlement: agencyEntitlement as never,
        agencyMembership: { role: 'agency_owner', status: 'active' },
      }),
    );
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.entitlementSource).toBe('free_standard');
    if (_label !== 'unknown status') {
      expect(result.effectiveAgencyPlan).toBeNull();
    }
  });
});

describe('Phase 1R-B — conflict and precedence', () => {
  it('17. dual active paid recruiter + includable agency returns fail-closed conflict', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        ...agencyOwner('agency_team', 'active', 'stripe'),
        recruiterBilling: { hasRow: true, plan: 'starter', status: 'active' },
      }),
    );
    expect(result).toEqual({
      state: 'conflict',
      effectiveRecruiterTier: 'free_verified',
      effectiveAgencyPlan: null,
      entitlementSource: 'none',
      billingManagementContext: 'conflict',
      canPostStandardOpportunities: true,
      conflictReason: 'dual_paid_business_entitlement',
    });
  });

  it('18. paid recruiter + manual_beta agency is not a conflict; recruiter wins, agency plan preserved', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        ...agencyOwner('agency_growth', 'manual_beta', 'manual'),
        recruiterBilling: { hasRow: true, plan: 'starter', status: 'active' },
      }),
    );
    expect(result.state).toBe('resolved');
    expect(result.conflictReason).toBeNull();
    expect(result.effectiveRecruiterTier).toBe('starter');
    expect(result.entitlementSource).toBe('recruiter_subscription');
    expect(result.billingManagementContext).toBe('recruiter');
    expect(result.effectiveAgencyPlan).toBe('agency_growth');
  });
});

describe('Phase 1R-B — loading, error, posting, and suspension', () => {
  it.each([
    ['recruiterBilling loading', { recruiterBilling: 'loading' as const }, 'loading'],
    ['agencyEntitlement loading', { agencyEntitlement: 'loading' as const }, 'loading'],
    ['recruiterBilling error', { recruiterBilling: 'error' as const }, 'error'],
    ['agencyEntitlement error', { agencyEntitlement: 'error' as const }, 'error'],
  ])('19. %s fails closed while preserving standard posting', (_label, sourceState, state) => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        sourceState,
        ...agencyOwner('agency_team', 'active', 'stripe'),
        recruiterBilling: { hasRow: true, plan: 'fleet', status: 'active' },
      }),
    );
    expect(result.state).toBe(state);
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.effectiveAgencyPlan).toBeNull();
    expect(result.entitlementSource).toBe('none');
    expect(result.billingManagementContext).toBe('none');
    expect(result.conflictReason).toBeNull();
    expect(result.canPostStandardOpportunities).toBe(true);
  });

  it('19b. error takes precedence over loading', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({ sourceState: { recruiterBilling: 'loading', agencyEntitlement: 'error' } }),
    );
    expect(result.state).toBe('error');
  });

  it.each([
    [true, true, false, true],
    [false, true, false, false],
    [true, false, false, false],
    [true, true, true, false],
    [false, false, true, false],
  ])(
    '20/21. profile(exists=%s, readyToPost=%s, suspended=%s) → canPost=%s',
    (exists, readyToPost, suspended, expected) => {
      const result = resolveEffectiveBusinessEntitlement(
        makeInput({ recruiterProfile: { exists, readyToPost, suspended } }),
      );
      expect(result.canPostStandardOpportunities).toBe(expected);
    },
  );

  it('21b. suspension blocks posting but preserves the explicit recruiter tier', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        recruiterBilling: { hasRow: true, plan: 'fleet', status: 'active' },
        recruiterProfile: { exists: true, readyToPost: true, suspended: true },
      }),
    );
    expect(result.canPostStandardOpportunities).toBe(false);
    expect(result.effectiveRecruiterTier).toBe('fleet');
    expect(result.entitlementSource).toBe('recruiter_subscription');
    expect(result.billingManagementContext).toBe('recruiter');
  });

  it('22. suspension blocks posting but preserves the agency-included tier', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        ...agencyOwner('agency_team', 'active', 'stripe'),
        recruiterProfile: { exists: true, readyToPost: true, suspended: true },
      }),
    );
    expect(result.canPostStandardOpportunities).toBe(false);
    expect(result.effectiveRecruiterTier).toBe('growth');
    expect(result.entitlementSource).toBe('agency_included');
    expect(result.billingManagementContext).toBe('agency');
  });
});

describe('Phase 1R-B — free standard, none, and source semantics', () => {
  it('23. recruiter profile without paid entitlement resolves free_standard', () => {
    const result = resolveEffectiveBusinessEntitlement(makeInput());
    expect(result.state).toBe('resolved');
    expect(result.entitlementSource).toBe('free_standard');
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.billingManagementContext).toBe('none');
  });

  it('24. no recruiter profile and no paid recruiter entitlement resolves none', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({ recruiterProfile: { exists: false, readyToPost: false, suspended: false } }),
    );
    expect(result.entitlementSource).toBe('none');
    expect(result.effectiveRecruiterTier).toBe('free_verified');
    expect(result.billingManagementContext).toBe('none');
    expect(result.canPostStandardOpportunities).toBe(false);
  });

  it.each(['active', 'trialing'])(  // trial-allowlist: Stripe subscription status literal, not user-facing copy
    '25. %s Stripe agency entitlement without a recruiter profile selects agency billing context only',
    (status) => {
      const result = resolveEffectiveBusinessEntitlement(
        makeInput({
          ...agencyOwner('agency_starter', status, 'stripe'),
          recruiterProfile: { exists: false, readyToPost: false, suspended: false },
        }),
      );
      expect(result.billingManagementContext).toBe('agency');
      expect(result.effectiveRecruiterTier).toBe('free_verified');
      expect(result.effectiveAgencyPlan).toBe('agency_starter');
      expect(result.entitlementSource).toBe('none');
    },
  );

  it('26a. non-Stripe admin_seed active agency without inclusion conditions preserves the plan but exposes no billing portal context', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput({
        agencyEntitlement: {
          hasRow: true,
          planKey: 'agency_team',
          status: 'active',
          source: 'admin_seed',
        },
        agencyMembership: { role: 'agency_member', status: 'active' },
      }),
    );
    expect(result.effectiveAgencyPlan).toBe('agency_team');
    expect(result.billingManagementContext).toBe('none');
    expect(result.effectiveRecruiterTier).toBe('free_verified');
  });

  it('26b. non-Stripe admin_seed active agency still includes recruiter premium when every inclusion condition is met', () => {
    const result = resolveEffectiveBusinessEntitlement(
      makeInput(agencyOwner('agency_team', 'active', 'admin_seed')),
    );
    expect(result.entitlementSource).toBe('agency_included');
    expect(result.effectiveRecruiterTier).toBe('growth');
    expect(result.effectiveAgencyPlan).toBe('agency_team');
  });
});

describe('Phase 1R-B — purity, immutability, determinism', () => {
  it('27. does not mutate caller input', () => {
    const input = makeInput({
      ...agencyOwner('agency_team', 'active', 'stripe'),
      recruiterBilling: { hasRow: true, plan: 'starter', status: 'past_due' },
    });
    const before = JSON.parse(JSON.stringify(input));
    Object.freeze(input);
    Object.freeze(input.sourceState);
    Object.freeze(input.recruiterBilling);
    Object.freeze(input.agencyEntitlement);
    Object.freeze(input.agencyMembership);
    Object.freeze(input.recruiterProfile);

    resolveEffectiveBusinessEntitlement(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
  });

  it('28. is deterministic across repeated calls', () => {
    const input = makeInput({
      ...agencyOwner('agency_growth', 'trialing', 'stripe'),  // trial-allowlist: Stripe subscription status literal, not user-facing copy
      recruiterProfile: { exists: true, readyToPost: false, suspended: false },
    });
    const first = resolveEffectiveBusinessEntitlement(input);
    for (let i = 0; i < 5; i += 1) {
      expect(resolveEffectiveBusinessEntitlement(input)).toEqual(first);
    }
  });

  it('29. module source contains no runtime/environment dependencies', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    // Strip comments so documentation prose cannot trip the guard.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');

    const forbiddenRuntime = [
      'window.',
      'document.',
      'localStorage',
      'sessionStorage',
      'fetch(',
      'Date.now',
      'new Date',
      'Math.random',
      'Deno.env',
      'process.env',
      'require(',
      'createClient',
      'useState',
      'useMemo',
      'useQuery',
    ];
    for (const token of forbiddenRuntime) {
      expect(code.includes(token), `module must not reference ${token}`).toBe(
        false,
      );
    }

    // Only type-only imports are permitted, and only from approved modules.
    const importLines = code
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    const allowedSpecifiers = [
      '@/lib/recruiterCapabilities',
      '@/lib/agencyPlans',
    ];
    for (const line of importLines) {
      expect(line.trimStart().startsWith('import type ')).toBe(true);
      const specifier = line.match(/from\s+'([^']+)'/)?.[1];
      expect(allowedSpecifiers).toContain(specifier);
    }

    const forbiddenSpecifiers = [
      'react',
      '@tanstack/react-query',
      '@/integrations/supabase/client',
      '@supabase/supabase-js',
      'stripe',
    ];
    for (const specifier of forbiddenSpecifiers) {
      expect(code.includes(`from '${specifier}'`)).toBe(false);
      expect(code.includes(`from "${specifier}"`)).toBe(false);
    }
  });
});
