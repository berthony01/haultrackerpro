// Phase 1G-R1A7-R1 corrected — client-side mapping of server response `code`
// values (see supabase/functions/_shared/recruiter-checkout.ts
// RecruiterCheckoutPublicCode) to Recruiter-facing UI messages, plus
// destination-specific safe URL validators for Stripe Checkout and Stripe
// Billing Portal, plus subscription-state classification used by the
// discriminated client UI state machine.

export type RecruiterCheckoutCode =
  | 'checkout_ready'
  | 'in_progress'
  | 'not_owner'
  | 'not_eligible'
  | 'invalid_plan'
  // Phase 1R-E1-R1 — a recognized plan that is not open for new subscriptions.
  | 'plan_unavailable'
  | 'invalid_origin'

  | 'invalid_price'
  | 'customer_conflict'
  | 'customer_not_found'
  | 'customer_ambiguous'
  | 'subscription_exists'
  | 'unknown_subscription_status'
  | 'checkout_processing'
  | 'session_invalid'
  | 'transient_error'
  | 'support_required'
  // Phase 1R-D1 — cross-context business billing guard codes.
  | 'agency_entitlement_exists'
  | 'agency_billing_requires_management'
  | 'opposing_entitlement_unknown'
  | 'internal_error';

export interface ParsedCheckoutError {
  code: RecruiterCheckoutCode | 'unknown_error';
  message: string;
}

/** Server-code → human, non-technical, actionable message. No IDs, no URLs. */
export const RECRUITER_CHECKOUT_MESSAGES: Record<
  RecruiterCheckoutCode | 'unknown_error',
  string
> = {
  checkout_ready: 'Opening secure checkout in a new tab…',
  in_progress:
    'A checkout is already being prepared. Please wait a moment and try again.',
  checkout_processing:
    'Your previous checkout is still being processed. Please try again shortly.',
  session_invalid:
    'The previous checkout could not be reused. Please try again.',
  transient_error:
    'A temporary problem interrupted checkout. Please try again.',
  subscription_exists:
    'You already have an active recruiter subscription. Use Manage Billing to change plans.',
  unknown_subscription_status:
    'Your subscription status is currently syncing. Please refresh in a moment.',
  customer_conflict:
    'We could not reconcile your billing profile. Please contact support.',
  customer_not_found:
    'Your billing profile is missing required information. Please contact support.',
  customer_ambiguous:
    'Your billing profile needs review. Please contact support.',
  support_required: 'This action needs support assistance. Please contact us.',
  not_owner: 'You are not authorized to start this checkout.',
  not_eligible:
    'Your recruiter profile is not currently eligible for premium checkout.',
  invalid_plan: 'That plan is not available. Please choose a valid plan.',
  invalid_price: 'Pricing is temporarily unavailable. Please try again later.',
  invalid_origin: 'Checkout could not be started from this location.',
  // Phase 1R-D1 — cross-context business billing guard.
  agency_entitlement_exists:
    'Your agency plan already includes recruiter premium. Manage billing from the agency workspace.',
  agency_billing_requires_management:
    'Your agency subscription needs billing attention. Manage it from the agency workspace before starting recruiter billing.',
  opposing_entitlement_unknown:
    'We could not safely confirm your existing business billing. Please contact support.',
  internal_error: 'Billing is temporarily unavailable. Please try again later.',
  unknown_error: 'Something went wrong. Please try again.',
};

/** Codes that require a human/support path — no retry loop should suggest
 *  the user try again themselves. */
export const RECRUITER_SUPPORT_CODES: ReadonlySet<
  RecruiterCheckoutCode | 'unknown_error'
> = new Set([
  'customer_conflict',
  'customer_not_found',
  'customer_ambiguous',
  'support_required',
  'opposing_entitlement_unknown',
]);

/** Codes that indicate the server made progress on billing state and the
 *  client should refetch billing after a short cooldown. */
export const RECRUITER_COOLDOWN_CODES: ReadonlySet<
  RecruiterCheckoutCode | 'unknown_error'
> = new Set(['in_progress', 'checkout_processing']);

/** Cooldown before the "Check Status" action becomes clickable. Kept short
 *  so a legitimate user is not blocked, but long enough that a server that
 *  just returned in_progress has time to settle. */
export const RECRUITER_CHECKOUT_COOLDOWN_MS = 5000;

/** Deterministic name for the single checkout/portal popup. Reusing the
 *  same name across window.open() calls guarantees rapid clicks target the
 *  same tab, never a second one. */
export const RECRUITER_BILLING_POPUP_NAME = 'recruiter_billing_flow';

// ---------------------------------------------------------------------------
// Subscription-status classification
// ---------------------------------------------------------------------------

/** Every Stripe subscription status we recognize plus our internal
 *  "inactive" (no billing row) and "unknown" (unrecognized upstream). */
export type RecruiterSubscriptionStatus =
  | 'active'
  | 'trialing' // trial-allowlist: Stripe subscription status literal
  | 'past_due'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'
  | 'canceled'
  | 'inactive'
  | 'unknown';

const RECOGNIZED_STATUSES: ReadonlySet<string> = new Set<string>([
  'active',
  'trialing', // trial-allowlist: Stripe subscription status literal
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
  'canceled',
  'inactive',
]);

/** Normalize any raw status string (or missing billing row) to one of the
 *  RecruiterSubscriptionStatus literals. Anything unrecognized is treated
 *  as `unknown` and MUST fail closed. */
export function classifyRecruiterSubscriptionStatus(
  raw: string | null | undefined,
): RecruiterSubscriptionStatus {
  if (!raw) return 'inactive';
  if (RECOGNIZED_STATUSES.has(raw)) return raw as RecruiterSubscriptionStatus;
  return 'unknown';
}

/** States that MUST block starting a new checkout regardless of any other
 *  client signal. This is the authoritative allow/deny map. */
export const RECRUITER_CHECKOUT_BLOCKING_STATUSES: ReadonlySet<RecruiterSubscriptionStatus> =
  new Set([
    'active',
    'trialing', // trial-allowlist: Stripe subscription status literal
    'past_due',
    'unpaid',
    'incomplete',
    'paused',
    'unknown',
  ]);

/** States where a fresh checkout is permitted (subject to eligibility). */
export const RECRUITER_CHECKOUT_ALLOWED_STATUSES: ReadonlySet<RecruiterSubscriptionStatus> =
  new Set(['canceled', 'incomplete_expired', 'inactive']);

/** Accurate per-status public copy. NEVER call past_due/unpaid/incomplete
 *  etc. "active". */
export const RECRUITER_SUBSCRIPTION_STATUS_MESSAGES: Record<
  RecruiterSubscriptionStatus,
  string
> = {
  active: 'Your recruiter subscription is active.',
  trialing: // trial-allowlist
    'Your recruiter subscription is currently in a trial. Use Manage Billing to review or change plans.', // trial-allowlist
  past_due:
    'Your last payment did not go through. Please update your payment method in Manage Billing to keep premium features.',
  unpaid:
    'Your subscription is unpaid. Please update your payment method in Manage Billing to restore premium features.',
  incomplete:
    'Your last checkout was not completed. Please finish payment from Manage Billing, or wait for it to expire before starting a new one.',
  incomplete_expired:
    'Your previous checkout expired. You can start a new checkout below.',
  paused:
    'Your subscription is paused. Use Manage Billing to resume premium features.',
  canceled:
    'Your subscription has been canceled. You can start a new plan below.',
  inactive: 'You do not have an active premium plan.',
  unknown:
    'Your subscription status is currently syncing. Please refresh in a moment.',
};

// ---------------------------------------------------------------------------
// Safe URL validators
// ---------------------------------------------------------------------------

function isHttpsUrlWithHost(raw: unknown, allowedHost: string): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  // Exact hostname match only — no endsWith('.stripe.com'), so a hostile
  // subdomain like `checkout.stripe.com.evil.example` cannot slip through.
  return u.hostname.toLowerCase() === allowedHost;
}

/** Only `https://checkout.stripe.com/...` is accepted. */
export function isSafeStripeCheckoutUrl(raw: unknown): raw is string {
  return isHttpsUrlWithHost(raw, 'checkout.stripe.com');
}

/** Only `https://billing.stripe.com/...` is accepted. */
export function isSafeStripeBillingPortalUrl(raw: unknown): raw is string {
  return isHttpsUrlWithHost(raw, 'billing.stripe.com');
}

// ---------------------------------------------------------------------------
// Safe error parsing
// ---------------------------------------------------------------------------

/**
 * Extract a structured { code, message } from either a Supabase FunctionsError
 * (which wraps the Response in `context`) or a plain rejected value. Never
 * throws. Never surfaces raw IDs, URLs, session tokens, or stack details.
 */
export async function parseCheckoutError(
  raw: unknown,
): Promise<ParsedCheckoutError> {
  const ctx = (raw as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as { json?: unknown }).json === 'function') {
    try {
      const body = await (ctx as { json: () => Promise<unknown> }).json();
      const code = (body as { code?: string } | null)?.code;
      if (typeof code === 'string' && code in RECRUITER_CHECKOUT_MESSAGES) {
        const key = code as RecruiterCheckoutCode;
        return { code: key, message: RECRUITER_CHECKOUT_MESSAGES[key] };
      }
    } catch {
      /* fall through to unknown */
    }
  }
  return {
    code: 'unknown_error',
    message: RECRUITER_CHECKOUT_MESSAGES.unknown_error,
  };
}
