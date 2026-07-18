// Phase 1G-R1A7 — client-side mapping of server response `code` values
// (see supabase/functions/_shared/recruiter-checkout.ts RecruiterCheckoutPublicCode)
// to Recruiter-facing UI messages, plus a safe checkout-URL validator.

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

/** Human, non-technical, actionable messages. No IDs, no URLs, no raw errors. */
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

/**
 * Validate a checkout URL before opening. Must be https and hosted on Stripe
 * checkout to protect against unsafe/stale redirects returned by an
 * unexpected server response shape (acceptance criterion #6).
 */
export function isSafeStripeCheckoutUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return host === 'checkout.stripe.com' || host.endsWith('.stripe.com');
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
