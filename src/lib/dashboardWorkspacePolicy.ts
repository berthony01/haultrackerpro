/**
 * Phase 1J-B2B — Pure dashboard shell workspace policy.
 *
 * Single source of truth for translating a REQUESTED page/subview into a
 * SAFE page/subview given the account's currently validated capabilities.
 *
 * Import boundary: capability/workspace types + the pure recruiter
 * subview resolver only. NO React, Supabase, admin, billing, Stripe,
 * subscription, recruiter profile, URL APIs, localStorage, or
 * sessionStorage imports. All decisions are total pure functions.
 *
 * Product model (authorization inputs only):
 *   - effectiveWorkspace: 'driver' | 'recruiter' | null (loading/fail-closed)
 *   - recruiterCapabilityStatus: 'setup' | 'active' | 'suspended' | 'revoked' | null
 *   - recruiterHubAllowed: setup | active | suspended
 *   - recruiterOperationsAllowed: active only
 *
 * Admin / billing / plan status NEVER decide dashboard workspace. URL
 * or session intent is only a NAVIGATION HINT that must round-trip
 * through this policy — it never authorizes anything on its own.
 */

import {
  RECRUITER_SUBVIEWS,
  resolveRecruiterSubviewForStatus,
  type RecruiterSubview,
  type WorkspaceRole,
} from '@/lib/workspaceAccess';
import type { UserCapabilityStatus } from '@/lib/userCapabilities';

export type DashboardPage = string;
export type RecruiterNavTier = 'none' | 'hub_only' | 'active';

/** Canonical driver-only dashboard pages. Kept here (not duplicated in
 *  Index) so every guard uses the same list. */
export const DRIVER_ONLY_PAGES: ReadonlySet<DashboardPage> = new Set([
  'dashboard',
  'loads',
  'expenses',
  'fuel',
  'reports',
  'monthly',
  'alerts',
  'scorecard',
  'opportunities',
  'add',
  'add_expense',
  'add_fuel',
  'closeout',
  'recurring_expenses',
  'settlements',
  'opportunity-preferences',

]);

/** Pages that render either driver OR recruiter content based on the
 *  active workspace. In driver workspace they are ALWAYS driver
 *  variants; in recruiter workspace they are recruiter variants — but
 *  only when the recruiter is fully OPERATIONAL. */
export const SHARED_PAGES: ReadonlySet<DashboardPage> = new Set([
  'contracts',
  'settings',
]);

export function isRecruiterPageId(id: DashboardPage): boolean {
  return id === 'recruiter-access' || id.startsWith('recruiter-access:');
}

/** Extract the recruiter subview segment from a page id. Returns
 *  `'hub'` for a bare `'recruiter-access'` and null when `id` is not a
 *  recruiter page id. Unknown subviews collapse to `'hub'`. */
export function parseRecruiterSubviewFromPage(
  id: DashboardPage,
): RecruiterSubview | null {
  if (!isRecruiterPageId(id)) return null;
  const seg = id.split(':')[1];
  if (!seg) return 'hub';
  return (RECRUITER_SUBVIEWS as readonly string[]).includes(seg)
    ? (seg as RecruiterSubview)
    : 'hub';
}

/**
 * Which recruiter navigation shell tier this capability yields:
 *   - 'active'   → full recruiter nav (hub, manager, applications,
 *                  reports, contracts, settings).
 *   - 'hub_only' → recruiter hub/home only (setup, suspended, and the
 *                  adversarial active-without-operations state).
 *   - 'none'     → no recruiter items at all (revoked / missing /
 *                  unknown).
 * Admin / billing / plan NEVER change this tier.
 */
export function resolveRecruiterNavTier(
  status: UserCapabilityStatus | null,
  operationsAllowed: boolean,
): RecruiterNavTier {
  if (!status) return 'none';
  if (status === 'active' && operationsAllowed) return 'active';
  if (status === 'setup' || status === 'suspended' || status === 'active') {
    return 'hub_only';
  }
  return 'none';
}

export interface DashboardNavigationInput {
  requestedPage: DashboardPage;
  /** Optional explicit subview request (overrides the segment in
   *  `requestedPage` when both are present). */
  requestedRecruiterSubview?: RecruiterSubview | string | null;
  effectiveWorkspace: WorkspaceRole | null;
  recruiterCapabilityStatus: UserCapabilityStatus | null;
  recruiterHubAllowed: boolean;
  recruiterOperationsAllowed: boolean;
}

export interface DashboardNavigationResult {
  /** Page id that is SAFE to mount right now, or the neutral
   *  fallback (`'dashboard'`) when `unresolved` is true. */
  page: DashboardPage;
  /** Recruiter subview when `page === 'recruiter-access'`, else null. */
  recruiterSubview: RecruiterSubview | null;
  /** True when no child can be authorized (loading / fail-closed).
   *  Caller must render a neutral/gate UI, NOT the returned page. */
  unresolved: boolean;
}

const UNRESOLVED: DashboardNavigationResult = {
  page: 'dashboard',
  recruiterSubview: null,
  unresolved: true,
};

/**
 * Pure settlement check. Returns true when the CURRENT page/subview
 * exactly matches what the policy would resolve to right now — meaning
 * it is safe to mount the workspace child for `currentPage`. Anything
 * else (unresolved, page mismatch, or recruiter subview mismatch) must
 * render a neutral fallback and let the reconciliation effect update
 * page/recruiterView state before children mount. Callers must never
 * rely on this alone: they must first gate on loading/error/null role.
 */
export function isDashboardNavigationSettled(
  currentPage: DashboardPage,
  currentRecruiterSubview: RecruiterSubview | null | undefined,
  decision: DashboardNavigationResult | null | undefined,
): boolean {
  if (!decision) return false;
  if (decision.unresolved) return false;
  if (decision.page !== currentPage) return false;
  if (decision.page === 'recruiter-access') {
    return decision.recruiterSubview === (currentRecruiterSubview ?? null);
  }
  return true;
}

/**
 * Full policy matrix. Returns the SAFE page + recruiter subview for the
 * caller to render. Callers MUST honor `unresolved === true` by
 * rendering a neutral/blocked state and NOT the returned `page`.
 */
export function resolveDashboardNavigation(
  input: DashboardNavigationInput,
): DashboardNavigationResult {
  const {
    requestedPage,
    effectiveWorkspace,
    recruiterCapabilityStatus,
    recruiterHubAllowed,
    recruiterOperationsAllowed,
  } = input;

  // A. Workspace not yet resolved → fail closed. Never synthesize driver.
  if (effectiveWorkspace !== 'driver' && effectiveWorkspace !== 'recruiter') {
    return UNRESOLVED;
  }

  const isRecruiterTarget = isRecruiterPageId(requestedPage);
  const requestedSub =
    input.requestedRecruiterSubview ??
    parseRecruiterSubviewFromPage(requestedPage);

  // B. Driver workspace: recruiter targets collapse to driver dashboard.
  //    Driver-only pages remain allowed. Shared pages resolve to their
  //    driver variant. Anything else passes through as-is.
  if (effectiveWorkspace === 'driver') {
    if (isRecruiterTarget) {
      return { page: 'dashboard', recruiterSubview: null, unresolved: false };
    }
    return { page: requestedPage, recruiterSubview: null, unresolved: false };
  }

  // C–G. Recruiter workspace guardrails. Any inconsistency between the
  // caller-declared workspace and the raw capability status must fail
  // closed rather than authorize a recruiter child mount.
  if (
    !recruiterHubAllowed ||
    !recruiterCapabilityStatus ||
    recruiterCapabilityStatus === 'revoked'
  ) {
    return UNRESOLVED;
  }

  const status = recruiterCapabilityStatus;

  // Driver-only pages inside recruiter workspace collapse to hub.
  if (DRIVER_ONLY_PAGES.has(requestedPage)) {
    return { page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false };
  }

  const isContracts = requestedPage === 'contracts';
  const isSettings = requestedPage === 'settings';

  // F. Suspended: hub only. Every recruiter subview, contracts, and
  //    settings collapse to the hub suspension surface.
  if (status === 'suspended') {
    return { page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false };
  }

  // C. Setup: hub / onboarding only. Contracts + settings collapse to hub.
  if (status === 'setup') {
    if (isContracts || isSettings) {
      return { page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false };
    }
    const sub = resolveRecruiterSubviewForStatus('setup', requestedSub);
    return {
      page: 'recruiter-access',
      recruiterSubview: sub ?? 'hub',
      unresolved: false,
    };
  }

  // status === 'active' from here.
  // E. Adversarial: active status but operations flag says false. Hub only.
  if (!recruiterOperationsAllowed) {
    return { page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false };
  }

  // D. Active + operations: preserve every valid recruiter target.
  if (isContracts) {
    return { page: 'contracts', recruiterSubview: null, unresolved: false };
  }
  if (isSettings) {
    return { page: 'settings', recruiterSubview: null, unresolved: false };
  }
  if (isRecruiterTarget) {
    const sub = resolveRecruiterSubviewForStatus('active', requestedSub);
    return {
      page: 'recruiter-access',
      recruiterSubview: sub ?? 'hub',
      unresolved: false,
    };
  }
  // Unknown/other page id in recruiter workspace → hub.
  return { page: 'recruiter-access', recruiterSubview: 'hub', unresolved: false };
}
