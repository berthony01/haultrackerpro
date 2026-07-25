/**
 * Phase 1P-A1 — Shared pure recruiter-readiness selector.
 *
 * This is the SINGLE canonical source of truth for whether a recruiter
 * profile is ready to publish a standard opportunity. Every client gate
 * (Post Opportunity button, Publish button, RecruiterReadinessDialog,
 * onboarding validation) MUST resolve through this function. It never
 * touches the network, never reads any external state, and never mutates
 * anything. The server-side authorization (SECURITY DEFINER RPCs) mirrors
 * this rule but is authoritative — this selector is a client mirror.
 *
 * Deterministic missing-token order:
 *   1. suspended
 *   2. recruiter_name
 *   3. company_name
 *   4. recruiter_email_missing  OR  recruiter_email_invalid
 *   5. company_type
 *   6. dot_or_mc                (ONLY for `carrier`)
 *   7. posting_terms
 *
 * DOT/MC rule:
 *   * `carrier` requires at least one of DOT or MC.
 *   * `third_party_recruiter`, `staffing_agency`, `independent_recruiter`
 *     do NOT require DOT or MC for standard posting.
 *   * NULL company_type is always incomplete (`company_type` token) —
 *     never inferred from other fields.
 */

import type { RecruiterProfile } from './recruiterEligibility';

export const COMPANY_TYPE_VALUES = [
  'carrier',
  'third_party_recruiter',
  'staffing_agency',
  'independent_recruiter',
] as const;
export type CompanyType = (typeof COMPANY_TYPE_VALUES)[number];

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  carrier: 'Carrier / Motor Carrier',
  third_party_recruiter: 'Third-Party Recruiting Company',
  staffing_agency: 'Staffing Agency',
  independent_recruiter: 'Independent Recruiter',
};

export type ReadinessToken =
  | 'suspended'
  | 'recruiter_name'
  | 'company_name'
  | 'recruiter_email_missing'
  | 'recruiter_email_invalid'
  | 'company_type'
  | 'dot_or_mc'
  | 'posting_terms';

export const READINESS_MESSAGES: Record<ReadinessToken, string> = {
  suspended:
    'Recruiter access is suspended. Contact support for assistance.',
  recruiter_name: 'Add your recruiter name.',
  company_name: 'Add your company name.',
  recruiter_email_missing: 'Add a recruiter email address.',
  recruiter_email_invalid: 'Enter a valid recruiter email address.',
  company_type: 'Choose your company type.',
  dot_or_mc:
    'Add a DOT or MC number. This is required for Carrier / Motor Carrier accounts.',
  posting_terms: 'Review and accept the current posting terms.',
};

export interface RecruiterReadiness {
  /** True iff standard posting is fully enabled right now. */
  ready: boolean;
  /** True iff the account is suspended (short-circuits everything). */
  suspended: boolean;
  /**
   * True iff this profile presents as a legacy row that needs a quick
   * profile update (missing company_type or a valid setup row with no
   * accepted terms yet). Used to route the readiness dialog into the
   * onboarding form with a "profile update required" framing.
   */
  legacyUpdateRequired: boolean;
  /** Ordered blocking tokens (empty when ready). */
  missing: ReadinessToken[];
  /** Ordered user-facing messages parallel to `missing`. */
  messages: string[];
  /** The resolved company type, if any. */
  companyType: CompanyType | null;
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isValidRecruiterEmail(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function coerceCompanyType(v: unknown): CompanyType | null {
  if (typeof v !== 'string') return null;
  return (COMPANY_TYPE_VALUES as readonly string[]).includes(v)
    ? (v as CompanyType)
    : null;
}

export function hasAcceptedPostingTermsProfile(
  profile: RecruiterProfile | null,
): boolean {
  if (!profile) return false;
  const anyP = profile as unknown as Record<string, unknown>;
  return (
    typeof anyP.posting_terms_accepted_at === 'string' ||
    typeof anyP.legacy_terms_grandfathered_at === 'string'
  );
}

/**
 * Shared pure readiness selector. Given a recruiter profile (or null),
 * returns the deterministic readiness verdict + ordered blocking tokens.
 */
export function resolveRecruiterReadiness(
  profile: RecruiterProfile | null,
): RecruiterReadiness {
  if (!profile) {
    return {
      ready: false,
      suspended: false,
      legacyUpdateRequired: true,
      missing: [
        'recruiter_name',
        'company_name',
        'recruiter_email_missing',
        'company_type',
        'posting_terms',
      ],
      messages: [
        READINESS_MESSAGES.recruiter_name,
        READINESS_MESSAGES.company_name,
        READINESS_MESSAGES.recruiter_email_missing,
        READINESS_MESSAGES.company_type,
        READINESS_MESSAGES.posting_terms,
      ],
      companyType: null,
    };
  }

  const suspended =
    profile.status === 'suspended' ||
    profile.verification_status === 'suspended';
  if (suspended) {
    return {
      ready: false,
      suspended: true,
      legacyUpdateRequired: false,
      missing: ['suspended'],
      messages: [READINESS_MESSAGES.suspended],
      companyType: coerceCompanyType(
        (profile as unknown as Record<string, unknown>).company_type,
      ),
    };
  }

  const companyType = coerceCompanyType(
    (profile as unknown as Record<string, unknown>).company_type,
  );
  const missing: ReadinessToken[] = [];

  if (!nonEmpty(profile.recruiter_name)) missing.push('recruiter_name');
  if (!nonEmpty(profile.company_name)) missing.push('company_name');
  if (!nonEmpty(profile.recruiter_email)) {
    missing.push('recruiter_email_missing');
  } else if (!isValidRecruiterEmail(profile.recruiter_email)) {
    missing.push('recruiter_email_invalid');
  }
  if (!companyType) missing.push('company_type');
  if (
    companyType === 'carrier' &&
    !nonEmpty(profile.dot_number) &&
    !nonEmpty(profile.mc_number)
  ) {
    missing.push('dot_or_mc');
  }
  if (!hasAcceptedPostingTermsProfile(profile)) {
    missing.push('posting_terms');
  }

  const ready = missing.length === 0;
  const legacyUpdateRequired =
    !ready && (companyType === null || missing.includes('posting_terms'));

  return {
    ready,
    suspended: false,
    legacyUpdateRequired,
    missing,
    messages: missing.map((t) => READINESS_MESSAGES[t]),
    companyType,
  };
}
