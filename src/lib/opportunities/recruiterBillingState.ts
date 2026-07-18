// Phase 1G-R1A7-R1 — single discriminated UI state for the Recruiter
// billing panel. All render, disable, and copy decisions in
// RecruiterBillingPanel MUST derive from this state. Scattered booleans
// are not permitted in the view layer.

import type { RecruiterPlan } from '@/hooks/opportunities/useRecruiterBilling';
import {
  classifyRecruiterSubscriptionStatus,
  RECRUITER_CHECKOUT_BLOCKING_STATUSES,
  RECRUITER_SUBSCRIPTION_STATUS_MESSAGES,
  type RecruiterSubscriptionStatus,
} from './recruiterCheckoutMessages';

export type PaidPlan = Exclude<RecruiterPlan, 'none'>;

export type RecruiterBillingUiState =
  // Base / gating
  | { kind: 'loading' }
  | { kind: 'missing_profile' }
  | { kind: 'suspended' }
  | { kind: 'ineligible' }
  | { kind: 'eligible_idle' }
  // Live operation
  | { kind: 'starting'; plan: PaidPlan }
  | { kind: 'portal_opening' }
  | { kind: 'popup_blocked_checkout'; url: string; plan: PaidPlan }
  | { kind: 'popup_blocked_portal'; url: string }
  // Server-progress states (no new checkout allowed)
  | { kind: 'in_progress'; cooldownActive: boolean }
  | { kind: 'processing'; cooldownActive: boolean }
  // Subscription states (no new checkout allowed for blocking ones)
  | { kind: 'sub_active' }
  | { kind: 'sub_trialing' }
  | { kind: 'sub_past_due' }
  | { kind: 'sub_unpaid' }
  | { kind: 'sub_incomplete' }
  | { kind: 'sub_paused' }
  | { kind: 'sub_canceled' }
  | { kind: 'sub_incomplete_expired' }
  | { kind: 'sub_unknown' }
  // Terminal error surfaces
  | { kind: 'retryable_error'; message: string }
  | { kind: 'support_required'; message: string };

export interface DeriveStateInput {
  profileLoading: boolean;
  billingLoading: boolean;
  profileMissing: boolean;
  suspended: boolean;
  premiumEligible: boolean;
  subscriptionStatusRaw: string | null | undefined;
  hasSubscriptionRow: boolean;
  starting: PaidPlan | null;
  portalOpening: boolean;
  popupBlockedCheckout: { url: string; plan: PaidPlan } | null;
  popupBlockedPortal: { url: string } | null;
  serverProgress: { kind: 'in_progress' | 'processing'; cooldownActive: boolean } | null;
  supportError: string | null;
  retryableError: string | null;
}

const SUBSCRIPTION_TO_STATE: Record<
  RecruiterSubscriptionStatus,
  RecruiterBillingUiState['kind']
> = {
  active: 'sub_active',
  trialing: 'sub_trialing', // trial-allowlist
  past_due: 'sub_past_due',
  unpaid: 'sub_unpaid',
  incomplete: 'sub_incomplete',
  paused: 'sub_paused',
  canceled: 'sub_canceled',
  incomplete_expired: 'sub_incomplete_expired',
  inactive: 'eligible_idle', // handled at derivation site
  unknown: 'sub_unknown',
};

export function deriveRecruiterBillingUiState(
  i: DeriveStateInput,
): RecruiterBillingUiState {
  if (i.profileLoading || i.billingLoading) return { kind: 'loading' };
  if (i.profileMissing) return { kind: 'missing_profile' };
  if (i.suspended) return { kind: 'suspended' };

  // Operation-level surfaces take priority over passive rendering
  if (i.supportError) {
    return { kind: 'support_required', message: i.supportError };
  }
  if (i.popupBlockedCheckout) {
    return {
      kind: 'popup_blocked_checkout',
      url: i.popupBlockedCheckout.url,
      plan: i.popupBlockedCheckout.plan,
    };
  }
  if (i.popupBlockedPortal) {
    return { kind: 'popup_blocked_portal', url: i.popupBlockedPortal.url };
  }
  if (i.serverProgress) {
    return {
      kind: i.serverProgress.kind,
      cooldownActive: i.serverProgress.cooldownActive,
    };
  }
  if (i.starting) return { kind: 'starting', plan: i.starting };
  if (i.portalOpening) return { kind: 'portal_opening' };

  // Subscription-state layer (only meaningful if a billing row exists)
  const status = classifyRecruiterSubscriptionStatus(i.subscriptionStatusRaw);
  if (i.hasSubscriptionRow && status !== 'inactive') {
    const kind = SUBSCRIPTION_TO_STATE[status];
    if (kind !== 'eligible_idle') {
      // Retryable error surfaces as a banner *on top of* the sub state,
      // handled by the panel — we don't override the sub_* kind here.
      return { kind } as RecruiterBillingUiState;
    }
  }

  if (i.retryableError) {
    return { kind: 'retryable_error', message: i.retryableError };
  }

  if (!i.premiumEligible) return { kind: 'ineligible' };
  return { kind: 'eligible_idle' };
}

/** True iff, in this state, the user is allowed to click a plan button
 *  and start a new checkout. Blocking sub states (active/trialing/past_due/  // trial-allowlist
 *  unpaid/incomplete/paused/unknown), operation states, and gating states
 *  (loading/missing/suspended/ineligible/support_required) leave plan
 *  buttons disabled. Canceled, incomplete_expired, retryable_error, and
 *  eligible_idle all permit a fresh checkout. */
export function canStartCheckout(state: RecruiterBillingUiState): boolean {
  switch (state.kind) {
    case 'eligible_idle':
    case 'sub_canceled':
    case 'sub_incomplete_expired':
    case 'retryable_error':
      return true;
    default:
      return false;
  }
}

/** True iff, in this state, "Manage Billing" is a meaningful action for
 *  the user. Manage Billing is only shown once the user has any billing
 *  history — never proactively. */
export function shouldShowManageBilling(
  state: RecruiterBillingUiState,
  hasStripeSubscriptionId: boolean,
): boolean {
  if (!hasStripeSubscriptionId) return false;
  switch (state.kind) {
    case 'loading':
    case 'missing_profile':
    case 'suspended':
    case 'support_required':
      return false;
    default:
      return true;
  }
}

/** Human-facing status headline (top of the panel). Never leaks IDs. */
export function stateHeadline(state: RecruiterBillingUiState): string | null {
  switch (state.kind) {
    case 'loading':
      return 'Loading your billing status…';
    case 'missing_profile':
      return 'Complete your recruiter profile to unlock premium checkout.';
    case 'suspended':
      return 'Your recruiter access is suspended. Premium checkout is not available while suspended.';
    case 'ineligible':
      return 'Finish your recruiter profile to become eligible for premium checkout.';
    case 'starting':
      return 'Preparing secure checkout…';
    case 'portal_opening':
      return 'Opening billing portal…';
    case 'popup_blocked_checkout':
      return 'Your browser blocked the checkout tab. Use the button below to continue.';
    case 'popup_blocked_portal':
      return 'Your browser blocked the billing portal tab. Use the button below to continue.';
    case 'in_progress':
      return 'A checkout is already being prepared. Please wait a moment before trying again.';
    case 'processing':
      return 'Your previous checkout is still being processed. Please wait a moment before trying again.';
    case 'sub_unknown':
      return RECRUITER_SUBSCRIPTION_STATUS_MESSAGES.unknown;
    case 'sub_active':
    case 'sub_trialing':
    case 'sub_past_due':
    case 'sub_unpaid':
    case 'sub_incomplete':
    case 'sub_paused':
    case 'sub_canceled':
    case 'sub_incomplete_expired':
      return RECRUITER_SUBSCRIPTION_STATUS_MESSAGES[
        state.kind.replace('sub_', '') as RecruiterSubscriptionStatus
      ];
    case 'retryable_error':
    case 'support_required':
      return state.message;
    case 'eligible_idle':
      return null;
  }
}

/** True iff the "Check Status" cooldown button should be visible AND
 *  clickable. `visible` may be true while `clickable` is false during the
 *  short debounce window. */
export function checkStatusVisibility(
  state: RecruiterBillingUiState,
): { visible: boolean; clickable: boolean } {
  if (state.kind === 'in_progress' || state.kind === 'processing') {
    return { visible: true, clickable: !state.cooldownActive };
  }
  if (state.kind === 'sub_unknown') {
    return { visible: true, clickable: true };
  }
  return { visible: false, clickable: false };
}

export const RECRUITER_BLOCKING_STATUSES = RECRUITER_CHECKOUT_BLOCKING_STATUSES;
