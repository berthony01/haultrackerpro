import { describe, it, expect } from 'vitest';
import {
  getRecruiterPlanCapabilities,
  isRecruiterPaidPlanActive,
  resolveRecruiterCapabilityTier,
} from '@/lib/recruiterCapabilities';

describe('recruiterCapabilities', () => {
  it('free_verified: approved recruiter with no paid plan can post unlimited standard opportunities', () => {
    const caps = getRecruiterPlanCapabilities({
      plan: 'none',
      status: 'inactive',
      isApprovedRecruiter: true,
    });
    expect(caps.tier).toBe('free_verified');
    expect(caps.canPostStandardOpportunities).toBe(true);
    expect(caps.unlimitedStandardPosts).toBe(true);
    expect(caps.activeOpportunityLimit).toBeNull();
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

  it('starter active: unlocks notes, status history, basic analytics and basic referral tracking', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'starter', status: 'active' });
    expect(caps.tier).toBe('starter');
    expect(caps.unlimitedStandardPosts).toBe(true);
    expect(caps.activeOpportunityLimit).toBeNull();
    expect(caps.canUseApplicantNotes).toBe(true);
    expect(caps.canUseApplicantStatusHistory).toBe(true);
    expect(caps.canUseBasicListingAnalytics).toBe(true);
    expect(caps.canUseReferralTracking).toBe('basic');
    expect(caps.canUsePriorityPlacement).toBe(false);
    expect(caps.canUseFeaturedListings).toBe(false);
    expect(caps.canExportRecruiterReports).toBe(false);
    expect(caps.canUseTeamSeats).toBe(false);
  });

  it('starter trialing: same paid capabilities as active', () => {
    const a = getRecruiterPlanCapabilities({ plan: 'starter', status: 'active' });
    const t = getRecruiterPlanCapabilities({ plan: 'starter', status: 'trialing' });
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

  it('fleet active: all growth capabilities plus team/bulk/custom profile/priority support', () => {
    const caps = getRecruiterPlanCapabilities({ plan: 'fleet', status: 'active' });
    expect(caps.tier).toBe('fleet');
    expect(caps.canUsePriorityPlacement).toBe(true);
    expect(caps.canUseFeaturedListings).toBe(true);
    expect(caps.canExportRecruiterReports).toBe(true);
    expect(caps.canUseContractWorkflowTools).toBe(true);
    expect(caps.canUseTeamSeats).toBe(true);
    expect(caps.canUseBulkOpportunityTools).toBe(true);
    expect(caps.canUseCustomRecruiterProfile).toBe(true);
    expect(caps.canUsePrioritySupport).toBe(true);
    expect(caps.canUseCompanyLevelHiringDashboard).toBe(true);
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

  it('activeOpportunityLimit is null for every tier — no fake unlimited numbers', () => {
    const plans = [
      { plan: 'none', status: 'inactive' },
      { plan: 'starter', status: 'active' },
      { plan: 'growth', status: 'active' },
      { plan: 'fleet', status: 'active' },
    ] as const;
    for (const p of plans) {
      const caps = getRecruiterPlanCapabilities(p);
      expect(caps.activeOpportunityLimit).toBeNull();
      expect(caps.unlimitedStandardPosts).toBe(true);
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
    expect(isRecruiterPaidPlanActive('growth', 'trialing')).toBe(true);
    expect(isRecruiterPaidPlanActive('growth', 'past_due')).toBe(false);
    expect(isRecruiterPaidPlanActive('none', 'active')).toBe(false);
    expect(isRecruiterPaidPlanActive(null, null)).toBe(false);
    expect(resolveRecruiterCapabilityTier('fleet', 'active')).toBe('fleet');
    expect(resolveRecruiterCapabilityTier('fleet', 'canceled')).toBe('free_verified');
  });
});
