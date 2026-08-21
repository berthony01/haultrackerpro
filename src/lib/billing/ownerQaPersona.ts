/**
 * Phase TG-2E3-O2 — Owner QA Mode, pure persona vocabulary + overlays.
 *
 * This module is intentionally PURE:
 *  - no React, react-query, Supabase, Stripe, network, timers, randomness;
 *  - NO browser persistence (no localStorage / sessionStorage / cookies);
 *  - no email, no admin identity literal, no hardcoded user id;
 *  - never mutates caller input and never writes billing data.
 *
 * The server (`owner_qa_sessions` + `current_owner_qa_persona()`) is the
 * source of truth. These helpers only mirror the same persona into the UI so
 * rendered state matches what the server gates will actually enforce.
 */

import type { AssistantAgencyPlanKey } from '@/lib/agencyPlans';
import { ASSISTANT_AGENCY_PLANS } from '@/lib/agencyPlans';
import type { PlanKey } from '@/lib/billing/plans';
import type { EffectiveBusinessEntitlementInput } from '@/lib/billing/effectiveBusinessEntitlement';

export type OwnerQaDomain = 'driver' | 'recruiter' | 'agency';

export type OwnerQaDriverPersona = 'free' | 'pro_monthly' | 'pro_yearly';
export type OwnerQaRecruiterPersona =
  | 'free_verified'
  | 'starter'
  | 'growth'
  | 'fleet';
export type OwnerQaAgencyPersona =
  | 'assistant_free'
  | 'agency_starter'
  | 'agency_team'
  | 'agency_growth';

export type OwnerQaPersona =
  | OwnerQaDriverPersona
  | OwnerQaRecruiterPersona
  | OwnerQaAgencyPersona;

/** UI-only concept: no QA session at all (the real account). */
export const OWNER_QA_ACTUAL_ACCOUNT = 'actual_account' as const;

export const OWNER_QA_DRIVER_PERSONAS: readonly OwnerQaDriverPersona[] = [
  'free',
  'pro_monthly',
  'pro_yearly',
];

export const OWNER_QA_RECRUITER_PERSONAS: readonly OwnerQaRecruiterPersona[] = [
  'free_verified',
  'starter',
  'growth',
  'fleet',
];

export const OWNER_QA_AGENCY_PERSONAS: readonly OwnerQaAgencyPersona[] = [
  'assistant_free',
  'agency_starter',
  'agency_team',
  'agency_growth',
];

export const OWNER_QA_PERSONAS_BY_DOMAIN: Readonly<
  Record<OwnerQaDomain, readonly OwnerQaPersona[]>
> = Object.freeze({
  driver: OWNER_QA_DRIVER_PERSONAS,
  recruiter: OWNER_QA_RECRUITER_PERSONAS,
  agency: OWNER_QA_AGENCY_PERSONAS,
});

/** Display labels derived from existing product plan names. No pricing invented. */
export const OWNER_QA_PERSONA_LABELS: Readonly<Record<OwnerQaPersona, string>> =
  Object.freeze({
    free: 'Driver Free',
    pro_monthly: 'Driver Pro Monthly',
    pro_yearly: 'Driver Pro Annual',
    free_verified: 'Recruiter Standard (Free Verified)',
    starter: 'Recruiter Starter',
    growth: 'Recruiter Growth',
    fleet: 'Recruiter Fleet',
    assistant_free: ASSISTANT_AGENCY_PLANS.assistant_free.label,
    agency_starter: ASSISTANT_AGENCY_PLANS.agency_starter.label,
    agency_team: ASSISTANT_AGENCY_PLANS.agency_team.label,
    agency_growth: ASSISTANT_AGENCY_PLANS.agency_growth.label,
  });

export interface OwnerQaPersonaSelection {
  domain: OwnerQaDomain;
  persona: OwnerQaPersona;
}

export function isOwnerQaDomain(value: unknown): value is OwnerQaDomain {
  return value === 'driver' || value === 'recruiter' || value === 'agency';
}

/** Strict pair validation — mirrors the server-side CHECK constraint. */
export function isValidOwnerQaSelection(
  domain: unknown,
  persona: unknown,
): boolean {
  if (!isOwnerQaDomain(domain)) return false;
  if (typeof persona !== 'string') return false;
  return (OWNER_QA_PERSONAS_BY_DOMAIN[domain] as readonly string[]).includes(
    persona,
  );
}

export function ownerQaPersonaLabel(
  domain: unknown,
  persona: unknown,
): string | null {
  if (!isValidOwnerQaSelection(domain, persona)) return null;
  return OWNER_QA_PERSONA_LABELS[persona as OwnerQaPersona] ?? null;
}

// ---------------------------------------------------------------------------
// Driver overlay
// ---------------------------------------------------------------------------

export interface DriverQaOverlay {
  planKey: PlanKey;
  status: string;
  isPro: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

/**
 * Synthetic driver plan state for display/effective hook output ONLY.
 * Never persisted; `subscriptions` is untouched.
 */
export function driverQaOverlay(persona: unknown): DriverQaOverlay | null {
  if (!isValidOwnerQaSelection('driver', persona)) return null;
  const p = persona as OwnerQaDriverPersona;
  if (p === 'free') {
    return {
      planKey: 'free',
      status: 'free',
      isPro: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };
  }
  return {
    planKey: p,
    status: 'active',
    isPro: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  };
}

// ---------------------------------------------------------------------------
// Business (recruiter / agency) resolver-input overlay
// ---------------------------------------------------------------------------

/**
 * Transform the INPUT handed to `resolveEffectiveBusinessEntitlement` so the
 * client mirrors the server QA persona. Pure: the caller's object is never
 * mutated, and no billing row is written anywhere.
 *
 * Single-domain semantics:
 *  - recruiter QA neutralizes the agency paid input so the real agency plan
 *    cannot produce a false dual-paid conflict during QA evaluation;
 *  - agency QA neutralizes the recruiter paid input for the same reason.
 */
export function applyBusinessQaOverlay(
  input: EffectiveBusinessEntitlementInput,
  selection: OwnerQaPersonaSelection | null,
): EffectiveBusinessEntitlementInput {
  if (
    !selection ||
    !isValidOwnerQaSelection(selection.domain, selection.persona) ||
    selection.domain === 'driver'
  ) {
    return input;
  }

  const neutralAgency = {
    hasRow: false,
    planKey: null,
    status: null,
    source: null,
  };
  const neutralRecruiter = { hasRow: false, plan: null, status: null };

  if (selection.domain === 'recruiter') {
    const persona = selection.persona as OwnerQaRecruiterPersona;
    return {
      ...input,
      recruiterBilling:
        persona === 'free_verified'
          ? neutralRecruiter
          : { hasRow: true, plan: persona, status: 'active' },
      agencyEntitlement: neutralAgency,
    };
  }

  const persona = selection.persona as OwnerQaAgencyPersona;
  return {
    ...input,
    recruiterBilling: neutralRecruiter,
    agencyEntitlement:
      persona === 'assistant_free'
        ? neutralAgency
        : {
            hasRow: true,
            planKey: persona,
            status: 'active',
            source: 'manual',
          },
  };
}

// ---------------------------------------------------------------------------
// Agency entitlement overlay (UI display of plan / status / limits)
// ---------------------------------------------------------------------------

export interface AgencyQaOverlay {
  planKey: AssistantAgencyPlanKey;
  status: 'active' | 'cancelled';
  memberLimit: number | null;
  activeClientLimit: number | null;
  servicePackageLimit: number | null;
  hasRow: boolean;
}

/**
 * Mirror the server `get_effective_agency_limits` QA branch using the plan
 * defaults already declared in `@/lib/agencyPlans`. In-memory only.
 */
export function agencyQaOverlay(persona: unknown): AgencyQaOverlay | null {
  if (!isValidOwnerQaSelection('agency', persona)) return null;
  const p = persona as OwnerQaAgencyPersona;

  if (p === 'assistant_free') {
    const limits = ASSISTANT_AGENCY_PLANS.agency_starter.limits;
    return {
      planKey: 'agency_starter',
      status: 'cancelled',
      memberLimit: limits.memberLimit,
      activeClientLimit: limits.activeClientLimit,
      servicePackageLimit: limits.servicePackageLimit,
      hasRow: false,
    };
  }

  const limits = ASSISTANT_AGENCY_PLANS[p].limits;
  return {
    planKey: p,
    status: 'active',
    memberLimit: limits.memberLimit,
    activeClientLimit: limits.activeClientLimit,
    servicePackageLimit: limits.servicePackageLimit,
    hasRow: true,
  };
}
