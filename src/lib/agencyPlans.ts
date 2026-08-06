/**
 * Phase 7 — Assistant/Agency monetization (capability-based, not role-based).
 *
 * This file is the SINGLE source of truth for assistant & agency plan
 * definitions, public display copy, and entitlement limits. Components,
 * hooks, edge functions, and tests must read from here — do NOT hardcode
 * limits anywhere else.
 *
 * IMPORTANT
 *  - Agency Stripe checkout shipped in Phase 8B. Subscribe/Pay CTAs are live
 *    through the agency checkout edge function.
 *  - Phase 1S-A2: agency plans are paid-only. An agency with no entitlement
 *    row, or a row in `cancelled` status, has NO active billing and cannot
 *    use paid Agency Workspace operations — private request link, public
 *    agency/package visibility, new client-request intake and positive
 *    progression, delegation creation, new work items, and adding members,
 *    driver clients, or service packages. Viewing existing data, cleanup,
 *    declines/cancellations, revocation, and billing management stay open.
 *    Only agencies holding an explicit `manual_beta` row (existing
 *    grandfathered beta workspaces) keep free access at their plan's limits.
 *  - HaulTrackerPro does not process service payments between drivers and
 *    assistants/agencies. Charges defined here are for software access only.
 *  - assistant_free is a capability with no software fee — accepting a
 *    driver invite is always free.
 */

export type AssistantAgencyPlanKey =
  | 'assistant_free'
  | 'agency_starter'
  | 'agency_team'
  | 'agency_growth';

export interface AgencyPlanLimits {
  /** Max agency members (including owner). null = unlimited. */
  memberLimit: number | null;
  /** Max active driver clients. null = unlimited. */
  activeClientLimit: number | null;
  /** Max active service packages. null = unlimited. */
  servicePackageLimit: number | null;
  workQueue: boolean;
  privateRequestLink: boolean;
  auditLog: boolean;
  notifications: boolean;
}

export interface AssistantAgencyPlan {
  key: AssistantAgencyPlanKey;
  /** Public display name. */
  label: string;
  /** Short audience descriptor for cards. */
  tagline: string;
  /** Monthly price in USD. 0 for free plans. */
  monthlyPrice: number;
  /** Annual price placeholder. null = annual not exposed publicly yet. */
  annualPrice: number | null;
  limits: AgencyPlanLimits;
  /** Public-facing bullet list for the pricing page. */
  publicBullets: string[];
  /** Disclaimer / limitation copy. */
  limitationsCopy: string;
}

export const ASSISTANT_AGENCY_PLANS: Record<AssistantAgencyPlanKey, AssistantAgencyPlan> = {
  assistant_free: {
    key: 'assistant_free',
    label: 'Driver Assistant',
    tagline: 'Free to accept approved driver invitations',
    monthlyPrice: 0,
    annualPrice: 0,
    limits: {
      memberLimit: 1,
      activeClientLimit: null, // an assistant can be invited by any number of drivers
      servicePackageLimit: 0, // packages are an agency feature
      workQueue: false,
      privateRequestLink: false,
      auditLog: true,
      notifications: true,
    },
    publicBullets: [
      'Free — no HaulTracker Pro fee just to assist a driver',
      'Access begins only after a driver-approved delegation',
      'Help with loads, expenses, fuel logs, and reports (per-driver permissions)',
      'Service payments handled outside HaulTracker Pro',
    ],
    limitationsCopy:
      'Driver Assistants cannot publish service packages or a private agency request link. To run a multi-driver back-office business, create an Agency Workspace.',
  },
  agency_starter: {
    key: 'agency_starter',
    label: 'Agency Starter',
    tagline: 'Solo back-office side hustle',
    monthlyPrice: 29,
    annualPrice: null,
    limits: {
      memberLimit: 2,
      activeClientLimit: 5,
      servicePackageLimit: 3,
      workQueue: true,
      privateRequestLink: true,
      auditLog: true,
      notifications: true,
    },
    publicBullets: [
      '2 agency members total, including the owner',
      'Up to 5 active driver clients',
      'Up to 3 active service packages',
      'Includes Recruiter Starter — 5 active opportunities for the agency owner',
      'Private agency request link',
      'Client requests, work queue, audit log',
      'Driver-approved delegation only',
    ],

    limitationsCopy:
      'Software access only. HaulTracker Pro does not process service payments between you and your driver clients.',
  },
  agency_team: {
    key: 'agency_team',
    label: 'Agency Team',
    tagline: 'Small back-office team',
    monthlyPrice: 79,
    annualPrice: null,
    limits: {
      memberLimit: 5,
      activeClientLimit: 25,
      servicePackageLimit: 25,
      workQueue: true,
      privateRequestLink: true,
      auditLog: true,
      notifications: true,
    },
    publicBullets: [
      'Up to 5 agency members',
      'Up to 25 active driver clients',
      'Up to 25 active service packages',
      'Includes Recruiter Growth — 15 active opportunities for the agency owner',
      'Shared work queue and notifications',
      'Private agency request link',
      'Full agency audit log',
    ],

    limitationsCopy:
      'Software access only. HaulTracker Pro does not process service payments between you and your driver clients.',
  },
  agency_growth: {
    key: 'agency_growth',
    label: 'Agency Growth',
    tagline: 'Larger back-office operations',
    monthlyPrice: 149,
    annualPrice: null,
    limits: {
      memberLimit: 15,
      activeClientLimit: 100,
      servicePackageLimit: 100,
      workQueue: true,
      privateRequestLink: true,
      auditLog: true,
      notifications: true,
    },
    publicBullets: [
      'Up to 15 agency members',
      'Up to 100 active driver clients',
      'Up to 100 active service packages',
      'Includes Recruiter Fleet — 25 active opportunities for the agency owner',
      'Shared work queue and notifications',
      'Private agency request link',
      'Full agency audit log',
    ],

    limitationsCopy:
      'Software access only. HaulTracker Pro does not process service payments between you and your driver clients.',
  },
};

export const ALL_AGENCY_PLAN_KEYS: AssistantAgencyPlanKey[] = [
  'agency_starter',
  'agency_team',
  'agency_growth',
];

export type AgencyEntitlementStatus =
  | 'trialing' // trial-allowlist — Stripe subscription status, not user-facing copy
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'manual_beta';

export interface AgencyEntitlement {
  agencyId: string;
  planKey: AssistantAgencyPlanKey;
  status: AgencyEntitlementStatus;
  source: 'manual' | 'stripe' | 'admin_seed';
  /** Overrides on top of plan defaults (admin/beta only). null = use plan default. */
  activeClientLimit: number | null;
  memberLimit: number | null;
  servicePackageLimit: number | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/**
 * Phase 1S-A2 — fail-closed default for agencies with NO entitlement row.
 *
 * A missing row means billing was never started, so it is NOT beta access:
 * we return the Agency Starter *shape* (so plan copy and numeric ceilings
 * still render) in `cancelled` status with no Stripe identity and no
 * override limits. Callers must treat this as "billing not active".
 *
 * Agencies that hold an explicit `manual_beta` row remain grandfathered and
 * fully usable at their plan's limits — that path never reaches this helper.
 */
export function defaultUnsubscribedEntitlement(agencyId: string): AgencyEntitlement {
  return {
    agencyId,
    planKey: 'agency_starter',
    status: 'cancelled',
    source: 'manual',
    activeClientLimit: null,
    memberLimit: null,
    servicePackageLimit: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}

/** Resolve effective limits for an entitlement, applying overrides. */
export function effectiveLimits(ent: AgencyEntitlement): AgencyPlanLimits {
  const plan = ASSISTANT_AGENCY_PLANS[ent.planKey];
  return {
    ...plan.limits,
    activeClientLimit:
      ent.activeClientLimit ?? plan.limits.activeClientLimit,
    memberLimit: ent.memberLimit ?? plan.limits.memberLimit,
    servicePackageLimit:
      ent.servicePackageLimit ?? plan.limits.servicePackageLimit,
  };
}

export type AgencyLimitedAction =
  | 'create_service_package'
  | 'invite_member'
  | 'activate_client';

/**
 * Phase 1S-A2 — single truthful reason used when an agency has no active
 * billing. Worded so it is correct for a never-started placeholder and for a
 * previously cancelled subscription.
 */
export const AGENCY_BILLING_NOT_ACTIVE_REASON =
  'Agency billing is not active. Start or restart your plan from the Plan & Limits card to continue this action.';

/**
 * Pure helper: does the agency have headroom for `action` given current usage?
 *
 * Returns { allowed, limit, used, reason }. When `limit` is null the plan
 * is unlimited for that action.
 */
export function checkAgencyLimit(
  ent: AgencyEntitlement,
  action: AgencyLimitedAction,
  usage: { members: number; activeClients: number; activePackages: number },
): { allowed: boolean; limit: number | null; used: number; reason?: string } {
  const limits = effectiveLimits(ent);
  // Phase 1S-A2 — fail closed before any numeric check when billing is not
  // active. `cancelled` covers both never-started placeholders and lapsed
  // subscriptions. Grandfathered `manual_beta` rows stay usable.
  if (ent.status === 'cancelled') {
    return {
      allowed: false,
      limit: null,
      used: 0,
      reason: AGENCY_BILLING_NOT_ACTIVE_REASON,
    };
  }
  switch (action) {
    case 'create_service_package': {
      const limit = limits.servicePackageLimit;
      const used = usage.activePackages;
      if (limit === null) return { allowed: true, limit, used };
      return limit > used
        ? { allowed: true, limit, used }
        : {
            allowed: false,
            limit,
            used,
            reason: `Your ${ASSISTANT_AGENCY_PLANS[ent.planKey].label} plan allows ${limit} active service packages.`,
          };
    }
    case 'invite_member': {
      const limit = limits.memberLimit;
      const used = usage.members;
      if (limit === null) return { allowed: true, limit, used };
      return limit > used
        ? { allowed: true, limit, used }
        : {
            allowed: false,
            limit,
            used,
            reason: `Your ${ASSISTANT_AGENCY_PLANS[ent.planKey].label} plan allows ${limit} agency members.`,
          };
    }
    case 'activate_client': {
      const limit = limits.activeClientLimit;
      const used = usage.activeClients;
      if (limit === null) return { allowed: true, limit, used };
      return limit > used
        ? { allowed: true, limit, used }
        : {
            allowed: false,
            limit,
            used,
            reason: `Your ${ASSISTANT_AGENCY_PLANS[ent.planKey].label} plan allows ${limit} active driver clients.`,
          };
    }
  }
}

export const OUTSIDE_PAYMENTS_DISCLAIMER =
  'HaulTracker Pro does not currently process payments between drivers and assistants or agencies. Service agreements and payments are handled outside the platform for now.';
