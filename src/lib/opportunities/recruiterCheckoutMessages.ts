// Phase 1G-R1A7-R1 — client-side mapping of server response `code` values
// (see supabase/functions/_shared/recruiter-checkout.ts RecruiterCheckoutPublicCode)
// to Recruiter-facing UI messages, plus destination-specific safe URL
// validators for Stripe Checkout and Stripe Billing Portal.

export type RecruiterCheckoutCode =
  | 'checkout_ready'
  | 'in_progress'
  | 'not_owner'
  | 'not_eligible'
  | 'invalid_plan'
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
  internal_error: 'Billing is temporarily unavailable. Please try again later.',
  unknown_error: 'Something went wrong. Please try again.',
};

/** Per-subscription-status accurate public copy. */
export const RECRUITER_SUBSCRIPTION_STATUS_MESSAGES: Record<string, string> = {
  active: 'Your recruiter subscription is active.',
  trialing: 'Your recruiter subscription is currently active.', // trial-allowlist
  past_due:
    'Your last payment did not go through. Please update your payment method in Manage Billing.',
  unpaid:
    'Your subscription is unpaid. Please update your payment method in Manage Billing to restore premium features.',
  incomplete:
    'Your last checkout was not completed. Please finish payment or start a new checkout.',
  incomplete_expired:
    'Your previous checkout expired. Please start a new checkout.',
  paused:
    'Your subscription is paused. Use Manage Billing to resume premium features.',
  canceled:
    'Your subscription has been canceled. You can start a new plan at any time.',
  inactive: 'You do not have an active premium plan.',
};

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

/**
 * Extract a structured { code, message } from either a Supabase FunctionsError
 * (which wraps the Response in `context`) or a plain rejected value. Never
 * throws. Never surfaces raw IDs, URLs, or stack details.
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
