import { describe, it, expect } from 'vitest';
import {
  getRecruiterCapabilitiesForTier,
  getRecruiterPlanCapabilities,
  isRecruiterPaidPlanActive,
  resolveRecruiterCapabilityTier,
} from '@/lib/recruiterCapabilities';

describe('recruiterCapabilities', () => {
  it('free_verified: approved recruiter with no paid plan can post one active standard opportunity', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'none',
      status: 'inactive',
      isApprovedRecruiter: true,
    });
    expect(caps.tier).toBe('free_verified');
    expect(caps.canPostStandardOpportunities).toBe(true);
    expect(caps.unlimitedStandardPosts).toBe(false);
    expect(caps.activeOpportunityLimit).toBe(1);
    expect(caps.canUsePriorityPlacement).toBe(false);
    expect(caps.canUseFeaturedListings).toBe(false);
    expect(caps.canExportRecruiterReports).toBe(false);
    expect(caps.canViewAdvancedRecruiterReports).toBe(false);
    expect(caps.canUseContractWorkflowTools).toBe(false);
    expect(caps.canUseReferralTracking).toBe('none');
    expect(caps.canUseTeamSeats).toBe(false);
    expect(caps.canUseBulkOpportunityTools).toBe(false);
    expect(caps.canUseBasicApplicantInbox).toBe(true);
  });

  it('starter active: unlocks status history and basic referral tracking; does not unlock unbuilt notes/listing analytics', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'starter', status: 'active' });
    expect(caps.tier).toBe('starter');
    expect(caps.unlimitedStandardPosts).toBe(false);
    expect(caps.activeOpportunityLimit).toBe(5);
    expect(caps.canUseApplicantNotes).toBe(false);
    expect(caps.canUseApplicantStatusHistory).toBe(true);
    expect(caps.canUseBasicListingAnalytics).toBe(false);
    expect(caps.canUseReferralTracking).toBe('basic');
    expect(caps.canUsePriorityPlacement).toBe(false);
    expect(caps.canUseFeaturedListings).toBe(false);
    expect(caps.canExportRecruiterReports).toBe(false);
    expect(caps.canUseTeamSeats).toBe(false);
  });

  it('starter trialing: same paid capabilities as active', () => {  // trial-allowlist: test name references Stripe status, not user-facing copy
    const a = getRecruiterPlanCapabilities({ plan: 'starter', status: 'active' });
    const t = getRecruiterPlanCapabilities({ plan: 'starter', status: 'trialing' });  // trial-allowlist: Stripe status literal

    expect(t).toEqual(a);
  });

  it('growth active: unlocks priority placement, featured, reports, contract tools, full referrals', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'growth', status: 'active' });
    expect(caps.tier).toBe('growth');
    expect(caps.canUsePriorityPlacement).toBe(true);
    expect(caps.canUseFeaturedListings).toBe(true);
    expect(caps.canExportRecruiterReports).toBe(true);
    expect(caps.canViewAdvancedRecruiterReports).toBe(true);
    expect(caps.canUseContractWorkflowTools).toBe(true);
    expect(caps.canUseReferralTracking).toBe('full');
    expect(caps.canUsePipelineAnalytics).toBe(true);
    expect(caps.canUseOpportunityPerformanceInsights).toBe(true);
    expect(caps.canUseTeamSeats).toBe(false);
  });

  it('fleet active: unlocks growth capabilities plus priority support; coming-soon features stay false', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'fleet', status: 'active' });
    expect(caps.tier).toBe('fleet');
    expect(caps.canUsePriorityPlacement).toBe(true);
    expect(caps.canUseFeaturedListings).toBe(true);
    expect(caps.canExportRecruiterReports).toBe(true);
    expect(caps.canUseContractWorkflowTools).toBe(true);
    expect(caps.canUsePipelineAnalytics).toBe(true);
    expect(caps.canUsePrioritySupport).toBe(true);
    // Coming-soon features are represented in copy only — capability flags
    // must stay false until the underlying UI ships.
    expect(caps.canUseTeamSeats).toBe(false);
    expect(caps.canUseBulkOpportunityTools).toBe(false);
    expect(caps.canUseCustomRecruiterProfile).toBe(false);
    expect(caps.canUseCompanyLevelHiringDashboard).toBe(false);
  });

  it('growth canceled: falls back to free_verified capabilities', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'growth',
      status: 'canceled',
      isApprovedRecruiter: true,
    });
    expect(caps.tier).toBe('free_verified');
    expect(caps.canUsePriorityPlacement).toBe(false);
    expect(caps.canExportRecruiterReports).toBe(false);
    expect(caps.canUseContractWorkflowTools).toBe(false);
    expect(caps.canPostStandardOpportunities).toBe(true);
  });

  it('fleet past_due: does not unlock premium capabilities (matches app policy)', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'fleet', status: 'past_due' });
    expect(caps.canUseTeamSeats).toBe(false);
    expect(caps.canUsePriorityPlacement).toBe(false);
    expect(caps.canExportRecruiterReports).toBe(false);
  });

  it('unknown plan: safe restricted fallback', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'enterprise_legacy' as unknown as 'fleet',
      status: 'active',
    });
    expect(caps.tier).toBe('free_verified');
    expect(caps.canUsePriorityPlacement).toBe(false);
    expect(caps.canExportRecruiterReports).toBe(false);
    expect(caps.canUseContractWorkflowTools).toBe(false);
    expect(caps.canUseTeamSeats).toBe(false);
  });

  it('unknown status: does not unlock paid capabilities', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'growth', status: 'mystery' });
    expect(caps.tier).toBe('free_verified');
    expect(caps.canUsePriorityPlacement).toBe(false);
  });

  it('activeOpportunityLimit is the canonical finite ceiling for every tier', () => {
    const plans = [
      { input: { plan: 'none', status: 'inactive' }, limit: 1 },
      { input: { plan: 'starter', status: 'active' }, limit: 5 },
      { input: { plan: 'growth', status: 'active' }, limit: 15 },
      { input: { plan: 'fleet', status: 'active' }, limit: 25 },
    ] as const;
    for (const p of plans) {
      const caps = getRecruiterPlanCapabilities(p.input);
      expect(caps.activeOpportunityLimit).toBe(p.limit);
      expect(caps.unlimitedStandardPosts).toBe(false);
    }
  });

  it('suspended recruiter cannot post standard opportunities even if approved', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'growth',
      status: 'active',
      isApprovedRecruiter: true,
      isSuspended: true,
    });
    expect(caps.canPostStandardOpportunities).toBe(false);
    // premium capabilities still resolved from the active plan
    expect(caps.canUsePriorityPlacement).toBe(true);
  });

  it('unapproved recruiter cannot post even on a paid plan', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'starter',
      status: 'active',
      isApprovedRecruiter: false,
    });
    expect(caps.canPostStandardOpportunities).toBe(false);
  });

  it('growth active + unapproved: premium caps still resolve but posting stays false', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'growth',
      status: 'active',
      isApprovedRecruiter: false,
      isSuspended: false,
    });
    expect(caps.canPostStandardOpportunities).toBe(false);
    expect(caps.canUsePriorityPlacement).toBe(true);
    expect(caps.canExportRecruiterReports).toBe(true);
  });

  it('growth active + suspended: premium caps still resolve but posting stays false', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'growth',
      status: 'active',
      isApprovedRecruiter: true,
      isSuspended: true,
    });
    expect(caps.canPostStandardOpportunities).toBe(false);
    expect(caps.canUsePriorityPlacement).toBe(true);
    expect(caps.canViewAdvancedRecruiterReports).toBe(true);
  });


  it('resolveRecruiterCapabilityTier + isRecruiterPaidPlanActive helpers', () => {
    expect(isRecruiterPaidPlanActive('growth', 'active')).toBe(true);
    expect(isRecruiterPaidPlanActive('growth', 'trialing')).toBe(true);  // trial-allowlist: Stripe status literal
    expect(isRecruiterPaidPlanActive('growth', 'past_due')).toBe(false);
    expect(isRecruiterPaidPlanActive('none', 'active')).toBe(false);
    expect(isRecruiterPaidPlanActive(null, null)).toBe(false);
    expect(resolveRecruiterCapabilityTier('fleet', 'active')).toBe('fleet');
    expect(resolveRecruiterCapabilityTier('fleet', 'canceled')).toBe('free_verified');
  });
});

// ---------------------------------------------------------------------------
// Phase 1R-C — tier-first capability builder
// ---------------------------------------------------------------------------

describe('getRecruiterCapabilitiesForTier', () => {
  it('produces the same capabilities as the plan/status path for every tier', () => {
    const pairs = [
      { tier: 'free_verified', plan: 'none', status: 'inactive' },
      { tier: 'starter', plan: 'starter', status: 'active' },
      { tier: 'growth', plan: 'growth', status: 'active' },
      { tier: 'fleet', plan: 'fleet', status: 'active' },
    ] as const;
    for (const p of pairs) {
      const viaPlan = getRecruiterPlanCapabilities({
        plan: p.plan,
        status: p.status,
        isApprovedRecruiter: true,
      });
      const viaTier = getRecruiterCapabilitiesForTier({
        tier: p.tier,
        canPostStandardOpportunities: true,
      });
      expect(viaTier).toEqual(viaPlan);
    }
  });

  it('agency-included growth tier unlocks growth premium capabilities without a recruiter plan', () => {
    const caps = getRecruiterCapabilitiesForTier({
      tier: 'growth',
      canPostStandardOpportunities: true,
    });
    expect(caps.tier).toBe('growth');
    expect(caps.canUsePriorityPlacement).toBe(true);
    expect(caps.canExportRecruiterReports).toBe(true);
    expect(caps.canViewAdvancedRecruiterReports).toBe(true);
    expect(caps.canUseContractWorkflowTools).toBe(true);
    expect(caps.canUseTeamSeats).toBe(false);
  });

  it('preserves the supplied posting boolean exactly and never re-derives it', () => {
    const blocked = getRecruiterCapabilitiesForTier({
      tier: 'fleet',
      canPostStandardOpportunities: false,
    });
    expect(blocked.canPostStandardOpportunities).toBe(false);
    expect(blocked.canUsePrioritySupport).toBe(true);

    const allowed = getRecruiterCapabilitiesForTier({
      tier: 'free_verified',
      canPostStandardOpportunities: true,
    });
    expect(allowed.canPostStandardOpportunities).toBe(true);
  });

  it('unknown, malformed, null, and undefined tiers fail closed to free_verified', () => {
    const inputs = ['enterprise', '', 'GROWTH', null, undefined, 'agency_growth'];
    for (const tier of inputs) {
      const caps = getRecruiterCapabilitiesForTier({
        tier: tier as never,
        canPostStandardOpportunities: true,
      });
      expect(caps.tier).toBe('free_verified');
      expect(caps.canUsePriorityPlacement).toBe(false);
      expect(caps.canExportRecruiterReports).toBe(false);
      expect(caps.canUseContractWorkflowTools).toBe(false);
    }
  });

  it('applies the canonical finite ceiling for every resolved tier', () => {
    const expected = { free_verified: 1, starter: 5, growth: 15, fleet: 25 } as const;
    for (const tier of ['free_verified', 'starter', 'growth', 'fleet'] as const) {
      const caps = getRecruiterCapabilitiesForTier({
        tier,
        canPostStandardOpportunities: true,
      });
      expect(caps.activeOpportunityLimit).toBe(expected[tier]);
      expect(caps.unlimitedStandardPosts).toBe(false);
    }
  });
});
