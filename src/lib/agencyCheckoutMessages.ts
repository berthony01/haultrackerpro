// Phase 1R-D1 — client-side mapping of `create-agency-checkout` response
// `code` values (see supabase/functions/_shared/agency-checkout.ts
// AgencyCheckoutPublicCode) to agency-owner-facing UI messages, plus an exact
// Stripe Checkout URL validator.
//
// Mirrors the recruiter parser pattern in
// src/lib/opportunities/recruiterCheckoutMessages.ts.

export type AgencyCheckoutCode =
  | 'checkout_ready'
  | 'in_progress'
  | 'checkout_processing'
  | 'not_owner'
  | 'not_eligible'
  | 'invalid_plan'
  | 'invalid_origin'
  | 'invalid_price'
  | 'recruiter_subscription_exists'
  | 'opposing_entitlement_unknown'
  | 'customer_conflict'
  | 'customer_not_found'
  | 'customer_ambiguous'
  | 'subscription_exists'
  | 'unknown_subscription_status'
  | 'session_invalid'
  | 'transient_error'
  | 'support_required'
  | 'internal_error';

export interface ParsedAgencyCheckoutError {
  code: AgencyCheckoutCode | 'unknown_error';
  message: string;
}

/** Server-code → human, non-technical, actionable message. No IDs, no URLs. */
export const AGENCY_CHECKOUT_MESSAGES: Record<
  AgencyCheckoutCode | 'unknown_error',
  string
> = {
  checkout_ready: 'Opening secure checkout…',
  in_progress:
    'A checkout is already being prepared. Please wait a moment and try again.',
  checkout_processing:
    'Your previous checkout is still being processed. Please try again shortly.',
  session_invalid:
    'The previous checkout could not be reused. Please try again.',
  transient_error:
    'A temporary problem interrupted checkout. Please try again.',
  recruiter_subscription_exists:
    'You already have recruiter premium billing. Manage or end that subscription before starting agency billing.',
  opposing_entitlement_unknown:
    'We could not safely confirm your existing business billing. Please contact support.',
  subscription_exists:
    'Agency billing already exists. Use Manage Billing to review it.',
  unknown_subscription_status:
    'Your agency subscription status is currently syncing. Please refresh in a moment.',
  customer_conflict:
    'We could not reconcile your agency billing profile. Please contact support.',
  customer_not_found:
    'Your agency billing profile is missing required information. Please contact support.',
  customer_ambiguous:
    'Your agency billing profile needs review. Please contact support.',
  support_required: 'This action needs support assistance. Please contact us.',
  not_owner: 'Only the agency owner can manage billing.',
  not_eligible: 'This agency is not currently eligible for billing.',
  invalid_plan: 'That plan is not available. Please choose a valid plan.',
  invalid_price: 'Pricing is temporarily unavailable. Please try again later.',
  invalid_origin: 'Checkout could not be started from this location.',
  internal_error: 'Billing is temporarily unavailable. Please try again later.',
  unknown_error: 'Something went wrong. Please try again.',
};

/** Codes that require a human/support path. */
export const AGENCY_SUPPORT_CODES: ReadonlySet<
  AgencyCheckoutCode | 'unknown_error'
> = new Set([
  'customer_conflict',
  'customer_not_found',
  'customer_ambiguous',
  'support_required',
  'opposing_entitlement_unknown',
]);

/** Codes where the server made progress and the client should retry later. */
export const AGENCY_COOLDOWN_CODES: ReadonlySet<
  AgencyCheckoutCode | 'unknown_error'
> = new Set(['in_progress', 'checkout_processing']);

// ---------------------------------------------------------------------------
// Safe URL validator
// ---------------------------------------------------------------------------

/** Only `https://checkout.stripe.com/...` is accepted. Exact host match only —
 *  no permissive suffix matching, so `checkout.stripe.com.evil.example` and
 *  `evilcheckout.stripe.com` are both rejected. */
export function isSafeAgencyStripeCheckoutUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return u.hostname.toLowerCase() === 'checkout.stripe.com';
}

// ---------------------------------------------------------------------------
// Safe error parsing
// ---------------------------------------------------------------------------

/**
 * Extract a structured { code, message } from either a Supabase FunctionsError
 * (which wraps the Response in `context`) or a plain rejected value. Never
 * throws. Never surfaces raw IDs, URLs, session tokens, or stack details.
 */
export async function parseAgencyCheckoutError(
  raw: unknown,
): Promise<ParsedAgencyCheckoutError> {
  const ctx = (raw as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as { json?: unknown }).json === 'function') {
    try {
      const body = await (ctx as { json: () => Promise<unknown> }).json();
      const code = (body as { code?: string } | null)?.code;
      if (typeof code === 'string' && code in AGENCY_CHECKOUT_MESSAGES) {
        const key = code as AgencyCheckoutCode;
        return { code: key, message: AGENCY_CHECKOUT_MESSAGES[key] };
      }
    } catch {
      /* fall through to unknown */
    }
  }
  return {
    code: 'unknown_error',
    message: AGENCY_CHECKOUT_MESSAGES.unknown_error,
  };
}

/** Map a successful-but-non-URL response body to a safe message. */
export function agencyCheckoutMessageForCode(
  code: unknown,
): ParsedAgencyCheckoutError {
  if (typeof code === 'string' && code in AGENCY_CHECKOUT_MESSAGES) {
    const key = code as AgencyCheckoutCode;
    return { code: key, message: AGENCY_CHECKOUT_MESSAGES[key] };
  }
  return {
    code: 'unknown_error',
    message: AGENCY_CHECKOUT_MESSAGES.unknown_error,
  };
}
