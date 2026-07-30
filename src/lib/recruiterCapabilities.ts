/**
 * Recruiter capability layer.
 *
 * Centralized model of what a recruiter can do based on their plan and
 * billing status. This is the future source of truth for recruiter feature
 * gating. Unlimited standard posting is represented by capability semantics
 * (`unlimitedStandardPosts: true`, `activeOpportunityLimit: null`) — never
 * by a fake numeric ceiling.
 *
 * This file is intentionally pure (no react-query, no Supabase). It is safe
 * to import from hooks, components, and unit tests.
 *
 * NOTE: Backend enforcement (opportunities_billing_guard, stripe-webhook,
 * recruiter_plan_limit) is unchanged. This layer is consumed by the UI in
 * later phases — Phase 1 only introduces the model + tests.
 */

import type { RecruiterPlan } from '@/hooks/opportunities/useRecruiterBilling';

export type RecruiterBillingStatus =
  | 'inactive'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'  // trial-allowlist: Stripe subscription status literal, not user-facing copy
  | (string & {});

export type RecruiterCapabilityTier =
  | 'free_verified'
  | 'starter'
  | 'growth'
  | 'fleet';

export type ReferralTrackingLevel = 'none' | 'basic' | 'full';

export interface RecruiterCapabilities {
  tier: RecruiterCapabilityTier;

  // Standard posting
  canPostStandardOpportunities: boolean;
  unlimitedStandardPosts: boolean;
  /** null = unlimited under the new capability model. */
  activeOpportunityLimit: number | null;

  // Visibility / premium placement
  canUsePriorityPlacement: boolean;
  canUseFeaturedListings: boolean;

  // Reporting / analytics
  canExportRecruiterReports: boolean;
  canViewAdvancedRecruiterReports: boolean;
  canUseBasicListingAnalytics: boolean;
  canUsePipelineAnalytics: boolean;
  canUseOpportunityPerformanceInsights: boolean;

  // Applicant management
  canUseBasicApplicantInbox: boolean;
  canUseApplicantNotes: boolean;
  canUseApplicantStatusHistory: boolean;

  // Workflow tools
  canUseContractWorkflowTools: boolean;
  canUseReferralTracking: ReferralTrackingLevel;

  // Team / scale
  canUseTeamSeats: boolean;
  canUseBulkOpportunityTools: boolean;
  canUseCustomRecruiterProfile: boolean;
  canUsePrioritySupport: boolean;
  canUseCompanyLevelHiringDashboard: boolean;
}

export interface ResolveCapabilitiesInput {
  plan: RecruiterPlan | string | null | undefined;
  status: RecruiterBillingStatus | string | null | undefined;
  /** Approved / verified recruiter profile. Defaults to true so callers
   *  that don't yet thread approval state through don't accidentally lock
   *  posting off. UI gates should pass the real value. */
  isApprovedRecruiter?: boolean;
  /** Suspension flag on the recruiter profile. */
  isSuspended?: boolean;
}

const PAID_PLANS: ReadonlySet<RecruiterPlan> = new Set([
  'starter',
  'growth',
  'fleet',
]);

const ACTIVE_BILLING_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',  // trial-allowlist: Stripe subscription status literal, not user-facing copy
]);

/** True if the recruiter has an active or trialing paid plan. */  // trial-allowlist: internal helper doc, not user-facing copy

export function isRecruiterPaidPlanActive(
  plan: RecruiterPlan | string | null | undefined,
  status: RecruiterBillingStatus | string | null | undefined,
): boolean {
  if (!plan || !status) return false;
  if (!PAID_PLANS.has(plan as RecruiterPlan)) return false;
  return ACTIVE_BILLING_STATUSES.has(status);
}

/** Resolves the capability tier given plan + status. Falls back to
 *  free_verified for any non-active paid state or unknown plan. */
export function resolveRecruiterCapabilityTier(
  plan: RecruiterPlan | string | null | undefined,
  status: RecruiterBillingStatus | string | null | undefined,
): RecruiterCapabilityTier {
  if (!isRecruiterPaidPlanActive(plan, status)) return 'free_verified';
  if (plan === 'starter') return 'starter';
  if (plan === 'growth') return 'growth';
  if (plan === 'fleet') return 'fleet';
  return 'free_verified';
}

function freeVerified(): Omit<RecruiterCapabilities, 'canPostStandardOpportunities'> {
  return {
    tier: 'free_verified',
    unlimitedStandardPosts: true,
    activeOpportunityLimit: null,
    canUsePriorityPlacement: false,
    canUseFeaturedListings: false,
    canExportRecruiterReports: false,
    canViewAdvancedRecruiterReports: false,
    canUseBasicListingAnalytics: false,
    canUsePipelineAnalytics: false,
    canUseOpportunityPerformanceInsights: false,
    canUseBasicApplicantInbox: true,
    canUseApplicantNotes: false,
    canUseApplicantStatusHistory: false,
    canUseContractWorkflowTools: false,
    canUseReferralTracking: 'none',
    canUseTeamSeats: false,
    canUseBulkOpportunityTools: false,
    canUseCustomRecruiterProfile: false,
    canUsePrioritySupport: false,
    canUseCompanyLevelHiringDashboard: false,
  };
}

function starter(): Omit<RecruiterCapabilities, 'canPostStandardOpportunities'> {
  return {
    ...freeVerified(),
    tier: 'starter',
    // canUseApplicantNotes intentionally false until a private notes UI ships.
    canUseApplicantStatusHistory: true,
    // canUseBasicListingAnalytics intentionally false — true listing impression
    // analytics are not built; "basic applicant pipeline analytics" is shown
    // in copy only.
    canUseReferralTracking: 'basic',
  };
}

function growth(): Omit<RecruiterCapabilities, 'canPostStandardOpportunities'> {
  return {
    ...starter(),
    tier: 'growth',
    canUsePriorityPlacement: true,
    canUseFeaturedListings: true,
    canExportRecruiterReports: true,
    canViewAdvancedRecruiterReports: true,
    canUseContractWorkflowTools: true,
    canUseReferralTracking: 'full',
    canUsePipelineAnalytics: true,
    canUseOpportunityPerformanceInsights: true,
  };
}

function fleet(): Omit<RecruiterCapabilities, 'canPostStandardOpportunities'> {
  return {
    ...growth(),
    tier: 'fleet',
    // Coming-soon capabilities. Kept false until the underlying features ship
    // so capability checks never silently unlock unbuilt UI.
    canUseTeamSeats: false,
    canUseBulkOpportunityTools: false,
    canUseCustomRecruiterProfile: false,
    canUseCompanyLevelHiringDashboard: false,
    // Priority support is a manual support promise the business honors today.
    canUsePrioritySupport: true,
  };
}

const TIER_BUILDERS: Record<
  RecruiterCapabilityTier,
  () => Omit<RecruiterCapabilities, 'canPostStandardOpportunities'>
> = {
  free_verified: freeVerified,
  starter,
  growth,
  fleet,
};

export interface RecruiterCapabilitiesForTierInput {
  /** Already-resolved capability tier. Unknown values fail closed. */
  tier: RecruiterCapabilityTier | string | null | undefined;
  /** Posting permission decided by the caller — preserved exactly. */
  canPostStandardOpportunities: boolean;
}

/**
 * Phase 1R-C — build a capability object from an ALREADY-RESOLVED tier.
 *
 * This is the single builder used by both the raw plan/status path
 * (`getRecruiterPlanCapabilities`) and the effective business entitlement
 * path (agency-included recruiter premium). Unknown, malformed, null, or
 * undefined tiers fail closed to `free_verified`. The supplied posting
 * boolean is preserved exactly and never re-derived here.
 */
export function getRecruiterCapabilitiesForTier(
  input: RecruiterCapabilitiesForTierInput,
): RecruiterCapabilities {
  const raw = input.tier;
  const key: RecruiterCapabilityTier =
    typeof raw === 'string' &&
    Object.prototype.hasOwnProperty.call(TIER_BUILDERS, raw)
      ? (raw as RecruiterCapabilityTier)
      : 'free_verified';
  const base = TIER_BUILDERS[key]();
  return {
    ...base,
    canPostStandardOpportunities: input.canPostStandardOpportunities,
  };
}

/** Main entry point. Resolves the full capability object for a recruiter. */
export function getRecruiterPlanCapabilities(
  input: ResolveCapabilitiesInput,
): RecruiterCapabilities {
  const { plan, status, isApprovedRecruiter = true, isSuspended = false } = input;
  const tier = resolveRecruiterCapabilityTier(plan, status);
  const canPost = isApprovedRecruiter === true && isSuspended !== true;
  return getRecruiterCapabilitiesForTier({
    tier,
    canPostStandardOpportunities: canPost,
  });
}


/** Typed capability accessor — useful for call sites that want a single key. */
export function hasRecruiterCapability<
  K extends keyof RecruiterCapabilities,
>(capabilities: RecruiterCapabilities, key: K): RecruiterCapabilities[K] {
  return capabilities[key];
}
