import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveBusinessEntitlement,
  type EffectiveBusinessEntitlementInput,
} from '@/lib/billing/effectiveBusinessEntitlement';

// Synthetic non-admin multi-workspace acceptance fixture, with no user IDs or customer data.
// All cases are pure functions: zero network calls, SQL writes, or Stripe transactions.
const base: EffectiveBusinessEntitlementInput = {
  sourceState: { recruiterBilling: 'ready', agencyEntitlement: 'ready' },
  recruiterBilling: { hasRow: false, plan: null, status: null },
  agencyEntitlement: {
    hasRow: true,
    planKey: 'agency_starter',
    status: 'manual_beta',
    source: 'manual',
  },
  agencyMembership: { role: 'agency_owner', status: 'active' },
  recruiterProfile: { exists: true, readyToPost: false, suspended: false },
};

describe('Mixed-role non-admin baseline: free recruiter + beta agency', () => {
  it('preserves a manual-beta agency plan without granting recruiter paid features', () => {
    const x = resolveEffectiveBusinessEntitlement(base);
    expect(x.state).toBe('resolved');
    expect(x.effectiveAgencyPlan).toBe('agency_starter');
    expect(x.effectiveRecruiterTier).toBe('free_verified');
    expect(x.entitlementSource).toBe('free_standard');
    expect(x.billingManagementContext).toBe('none');
    expect(x.canPostStandardOpportunities).toBe(false);
    expect(x.conflictReason).toBeNull();
  });

  it('allows standard free posting once recruiter onboarding is complete, without adding premium entitlement', () => {
    const x = resolveEffectiveBusinessEntitlement({
      ...base,
      recruiterProfile: { exists: true, readyToPost: true, suspended: false },
    });
    expect(x.canPostStandardOpportunities).toBe(true);
    expect(x.effectiveRecruiterTier).toBe('free_verified');
    expect(x.effectiveAgencyPlan).toBe('agency_starter');
    expect(x.billingManagementContext).toBe('none');
  });

  it('keeps a nonowner agency member from inheriting recruiter premium under an active manual agency plan', () => {
    const x = resolveEffectiveBusinessEntitlement({
      ...base,
      agencyEntitlement: { ...base.agencyEntitlement, status: 'active' },
      agencyMembership: { role: 'agency_member', status: 'active' },
    });
    expect(x.effectiveRecruiterTier).toBe('free_verified');
    expect(x.entitlementSource).toBe('free_standard');
    expect(x.billingManagementContext).toBe('none');
  });

  it('does not expose Stripe portal context for a manual agency entitlement', () => {
    const x = resolveEffectiveBusinessEntitlement({
      ...base,
      recruiterProfile: { ...base.recruiterProfile, readyToPost: true },
      agencyEntitlement: { ...base.agencyEntitlement, status: 'active' },
    });
    expect(x.effectiveRecruiterTier).toBe('starter');
    expect(x.effectiveAgencyPlan).toBe('agency_starter');
    expect(x.entitlementSource).toBe('agency_included');
    expect(x.billingManagementContext).toBe('none');
  });
});
