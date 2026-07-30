/**
 * Phase 1R-B — Pure effective business entitlement resolver.
 *
 * This module is intentionally PURE and runtime-neutral:
 *  - no React, react-query, Supabase, Stripe, network, storage, timers,
 *    randomness, or environment access;
 *  - no writes of any kind;
 *  - deterministic: same input → deeply equal output.
 *
 * It is NOT wired into any hook, component, dashboard, checkout, webhook,
 * pricing page, or database path in this phase. Later phases convert
 * consumers to read from here.
 *
 * Locked product rules implemented here:
 *  1. Existing Stripe contexts remain separate; this resolver mirrors nothing.
 *  2. Agency → recruiter inclusion map is fixed (see AGENCY_INCLUDED_RECRUITER_TIER).
 *  3. Recruiter Standard is free and independent of paid resolution.
 *  4. Agency-included recruiter premium is OWNER-ONLY and requires an active
 *     membership.
 *  5. Agency inclusion also requires an explicit row, a valid paid agency plan,
 *     agency status active/trialing, and an existing recruiter profile.
 *  6. manual_beta preserves the agency plan but never includes recruiter premium.
 *  7. past_due grants no premium, but may still resolve a billing-management
 *     context.
 *  8. Recruiter paid premium requires explicit row + valid paid plan +
 *     active/trialing status.
 *  9. Anything unknown/missing/malformed grants no premium.
 * 10. Dual paid business entitlement is an explicit fail-closed conflict.
 * 11. Suspension never erases a resolved tier — it only blocks standard posting.
 * 12. Standard posting is computed from recruiter-profile facts only.
 * 13. Caller input is never mutated.
 */

import type { RecruiterCapabilityTier } from '@/lib/recruiterCapabilities';
import type { AssistantAgencyPlanKey } from '@/lib/agencyPlans';

/** Resolution state of the combined business entitlement. */
export type BusinessEntitlementState =
  | 'loading'
  | 'resolved'
  | 'error'
  | 'conflict';

/** Where the resolved recruiter tier came from. */
export type BusinessEntitlementSource =
  | 'none'
  | 'free_standard'
  | 'recruiter_subscription'
  | 'agency_included';

/** Which billing surface (if any) the user should manage. */
export type BusinessBillingManagementContext =
  | 'none'
  | 'recruiter'
  | 'agency'
  | 'conflict';

/** Paid agency plans only — assistant_free is never a paid plan. */
export type PaidAgencyPlanKey = Exclude<AssistantAgencyPlanKey, 'assistant_free'>;

export interface EffectiveBusinessEntitlementInput {
  sourceState: {
    recruiterBilling: 'ready' | 'loading' | 'error';
    agencyEntitlement: 'ready' | 'loading' | 'error';
  };
  recruiterBilling: {
    hasRow: boolean;
    plan: string | null | undefined;
    status: string | null | undefined;
  };
  agencyEntitlement: {
    hasRow: boolean;
    planKey: string | null | undefined;
    status: string | null | undefined;
    source: string | null | undefined;
  };
  agencyMembership: {
    role: string | null | undefined;
    status: string | null | undefined;
  };
  recruiterProfile: {
    exists: boolean;
    readyToPost: boolean;
    suspended: boolean;
  };
}

export interface EffectiveBusinessEntitlement {
  state: BusinessEntitlementState;
  effectiveRecruiterTier: RecruiterCapabilityTier;
  effectiveAgencyPlan: PaidAgencyPlanKey | null;
  entitlementSource: BusinessEntitlementSource;
  billingManagementContext: BusinessBillingManagementContext;
  canPostStandardOpportunities: boolean;
  conflictReason: 'dual_paid_business_entitlement' | null;
}

/**
 * Fixed inclusion map: paid agency plan → included recruiter premium tier.
 * This is the ONLY source of agency-included recruiter tiers.
 */
export const AGENCY_INCLUDED_RECRUITER_TIER: Readonly<
  Record<PaidAgencyPlanKey, Exclude<RecruiterCapabilityTier, 'free_verified'>>
> = Object.freeze({
  agency_starter: 'starter',
  agency_team: 'growth',
  agency_growth: 'fleet',
} as const);

const PAID_AGENCY_PLAN_KEYS: readonly PaidAgencyPlanKey[] = [
  'agency_starter',
  'agency_team',
  'agency_growth',
];

const PAID_RECRUITER_PLANS: readonly Exclude<
  RecruiterCapabilityTier,
  'free_verified'
>[] = ['starter', 'growth', 'fleet'];

/** Statuses that count as "currently paying" in either context. */
const PREMIUM_STATUSES: readonly string[] = [
  'active',
  'trialing', // trial-allowlist: Stripe subscription status literal, not user-facing copy
];

function isPaidAgencyPlanKey(value: unknown): value is PaidAgencyPlanKey {
  return (
    typeof value === 'string' &&
    (PAID_AGENCY_PLAN_KEYS as readonly string[]).includes(value)
  );
}

function isPaidRecruiterPlan(
  value: unknown,
): value is Exclude<RecruiterCapabilityTier, 'free_verified'> {
  return (
    typeof value === 'string' &&
    (PAID_RECRUITER_PLANS as readonly string[]).includes(value)
  );
}

function isPremiumStatus(value: unknown): boolean {
  return typeof value === 'string' && PREMIUM_STATUSES.includes(value);
}

function isExactly(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value === expected;
}

/**
 * Map a paid agency plan to its included recruiter premium tier.
 * Returns null for assistant_free, unknown, malformed, null, or undefined.
 */
export function mapAgencyPlanToIncludedRecruiterTier(
  planKey: unknown,
): Exclude<RecruiterCapabilityTier, 'free_verified'> | null {
  if (!isPaidAgencyPlanKey(planKey)) return null;
  return AGENCY_INCLUDED_RECRUITER_TIER[planKey];
}

/**
 * Resolve the combined, effective business entitlement.
 * Pure, deterministic, non-mutating.
 */
export function resolveEffectiveBusinessEntitlement(
  input: EffectiveBusinessEntitlementInput,
): EffectiveBusinessEntitlement {
  const { sourceState, recruiterBilling, agencyEntitlement, agencyMembership, recruiterProfile } =
    input;

  // Rule 12 / semantics A — standard posting depends ONLY on recruiter-profile
  // facts, and is preserved through loading, error, and conflict states.
  const canPostStandardOpportunities =
    recruiterProfile.exists === true &&
    recruiterProfile.readyToPost === true &&
    recruiterProfile.suspended !== true;

  // Semantics B — loading/error fail closed on every premium field.
  const hasError =
    sourceState.recruiterBilling === 'error' ||
    sourceState.agencyEntitlement === 'error';
  const hasLoading =
    sourceState.recruiterBilling === 'loading' ||
    sourceState.agencyEntitlement === 'loading';

  if (hasError || hasLoading) {
    return {
      state: hasError ? 'error' : 'loading',
      effectiveRecruiterTier: 'free_verified',
      effectiveAgencyPlan: null,
      entitlementSource: 'none',
      billingManagementContext: 'none',
      canPostStandardOpportunities,
      conflictReason: null,
    };
  }

  const agencyPlanKey = isPaidAgencyPlanKey(agencyEntitlement.planKey)
    ? agencyEntitlement.planKey
    : null;
  const agencyRowValid = agencyEntitlement.hasRow === true && agencyPlanKey !== null;
  const agencyStatusPremium = isPremiumStatus(agencyEntitlement.status);
  const agencyStatusManualBeta = isExactly(agencyEntitlement.status, 'manual_beta');
  const agencyStatusPastDue = isExactly(agencyEntitlement.status, 'past_due');
  const agencySourceStripe = isExactly(agencyEntitlement.source, 'stripe');

  // Semantics C — effective agency plan (active/trialing/manual_beta only).
  const effectiveAgencyPlan: PaidAgencyPlanKey | null =
    agencyRowValid && (agencyStatusPremium || agencyStatusManualBeta)
      ? (agencyPlanKey as PaidAgencyPlanKey)
      : null;

  // Semantics D — explicit recruiter premium grant.
  const recruiterPlanPaid = isPaidRecruiterPlan(recruiterBilling.plan);
  const recruiterRowValid = recruiterBilling.hasRow === true && recruiterPlanPaid;
  const recruiterPremium =
    recruiterRowValid && isPremiumStatus(recruiterBilling.status);
  const recruiterPremiumTier = recruiterPremium
    ? (recruiterBilling.plan as Exclude<RecruiterCapabilityTier, 'free_verified'>)
    : null;

  // Semantics E — agency-included recruiter premium grant (owner-only).
  const agencyIncludedTier =
    agencyRowValid &&
    agencyStatusPremium &&
    isExactly(agencyMembership.role, 'agency_owner') &&
    isExactly(agencyMembership.status, 'active') &&
    recruiterProfile.exists === true
      ? mapAgencyPlanToIncludedRecruiterTier(agencyPlanKey)
      : null;

  // Semantics F — dual paid business entitlement is a fail-closed conflict.
  if (recruiterPremiumTier !== null && agencyIncludedTier !== null) {
    return {
      state: 'conflict',
      effectiveRecruiterTier: 'free_verified',
      effectiveAgencyPlan: null,
      entitlementSource: 'none',
      billingManagementContext: 'conflict',
      canPostStandardOpportunities,
      conflictReason: 'dual_paid_business_entitlement',
    };
  }

  // Semantics G — non-conflict precedence.
  let effectiveRecruiterTier: RecruiterCapabilityTier = 'free_verified';
  let entitlementSource: BusinessEntitlementSource;
  let billingManagementContext: BusinessBillingManagementContext;

  if (recruiterPremiumTier !== null) {
    effectiveRecruiterTier = recruiterPremiumTier;
    entitlementSource = 'recruiter_subscription';
    billingManagementContext = 'recruiter';
  } else if (agencyIncludedTier !== null) {
    effectiveRecruiterTier = agencyIncludedTier;
    entitlementSource = 'agency_included';
    billingManagementContext = 'agency';
  } else {
    entitlementSource = recruiterProfile.exists === true ? 'free_standard' : 'none';

    // Semantics H — billing-management context when no premium was granted.
    if (recruiterRowValid && isExactly(recruiterBilling.status, 'past_due')) {
      billingManagementContext = 'recruiter';
    } else if (
      agencyRowValid &&
      agencySourceStripe &&
      (agencyStatusPastDue || agencyStatusPremium)
    ) {
      billingManagementContext = 'agency';
    } else {
      billingManagementContext = 'none';
    }
  }

  // Semantics I — suspension already handled: it only affects posting.
  return {
    state: 'resolved',
    effectiveRecruiterTier,
    effectiveAgencyPlan,
    entitlementSource,
    billingManagementContext,
    canPostStandardOpportunities,
    conflictReason: null,
  };
}
