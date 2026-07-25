import type { Tables } from '@/integrations/supabase/types';
import {
  resolveRecruiterReadiness,
  isValidRecruiterEmail as sharedIsValidRecruiterEmail,
  hasAcceptedPostingTermsProfile,
} from './resolveRecruiterReadiness';

// Kept for existing imports of `RecruiterProfile` from this module.
export type RecruiterProfile = Tables<'recruiter_profiles'>;

export type RecruiterEligibilityState =
  | 'missing_profile'
  | 'incomplete_profile'
  | 'suspended'
  | 'active_unverified'
  | 'verified';

export interface RecruiterEligibility {
  state: RecruiterEligibilityState;
  /** True when the recruiter is allowed to create/publish/edit standard opportunities. */
  canPost: boolean;
  /** True only when an admin has awarded the Verified Recruiter badge. */
  isVerified: boolean;
  title: string;
  body: string;
  cta?: string;
}

/** Current posting-terms version stamped by the onboarding form. */
export const POSTING_TERMS_VERSION = '2026-07-17.v1';

/**
 * Client-side email validation aligned with the server pattern.
 * Rejects empty/whitespace, missing @, missing domain suffix.
 *
 * Phase 1P-A1.2: delegates to the shared pure helper in
 * `resolveRecruiterReadiness` — no local regex reimplementation.
 */
export function isValidRecruiterEmail(v: unknown): boolean {
  return sharedIsValidRecruiterEmail(v);
}

/**
 * True iff the profile has stamped or been grandfathered into posting terms.
 *
 * Phase 1P-A1.2: delegates to the shared pure helper in
 * `resolveRecruiterReadiness` — no local field-check reimplementation.
 */
export function hasAcceptedPostingTerms(profile: RecruiterProfile | null): boolean {
  return hasAcceptedPostingTermsProfile(profile);
}

/**
 * Canonical client-side profile completeness.
 *
 * Phase 1P-A1.2: this is a thin delegator over the single canonical
 * `resolveRecruiterReadiness` selector. It MUST NOT reimplement company
 * type, DOT/MC, email, suspension, or terms logic — every completeness
 * change lives in the selector.
 */
export function isProfileCompleteForPosting(profile: RecruiterProfile | null): boolean {
  return resolveRecruiterReadiness(profile).ready;
}


/**
 * Phase 1F-A.1: canonical recruiter posting rule.
 *
 * A recruiter can post standard opportunities as soon as their profile is
 * complete (name + company + valid email + DOT or MC + accepted posting
 * terms) and their account is not suspended. Admin verification is a
 * trust badge only — it does NOT gate posting.
 */
export function describeRecruiterEligibility(
  profile: RecruiterProfile | null,
  opts: { intentRecruiter?: boolean } = {},
): RecruiterEligibility {
  if (!profile) {
    return {
      state: 'missing_profile',
      canPost: false,
      isVerified: false,
      title: opts.intentRecruiter
        ? 'Finish your recruiter setup'
        : 'Add recruiter workspace',
      body: opts.intentRecruiter
        ? 'You signed up as a recruiter, but your recruiter profile is not complete yet. Complete the short recruiter profile to start posting opportunities.'
        : 'Add the recruiter workspace to your account. Complete the short recruiter profile to start posting standard opportunities — no admin approval needed.',
      cta: opts.intentRecruiter ? 'Finish Recruiter Setup' : 'Add Recruiter Workspace',
    };
  }

  if (profile.status === 'suspended' || profile.verification_status === 'suspended') {
    return {
      state: 'suspended',
      canPost: false,
      isVerified: false,
      title: 'Recruiter Access Suspended',
      body: 'Your recruiter access is suspended. Contact support to review the decision — posting stays disabled until this is resolved.',
    };
  }

  if (!isProfileCompleteForPosting(profile)) {
    return {
      state: 'incomplete_profile',
      canPost: false,
      isVerified: false,
      title: 'Finish your recruiter profile',
      body: 'Add your recruiter name, company name, a valid recruiter email, choose your company type, and accept the posting terms. A DOT or MC number is required only for Carrier / Motor Carrier accounts. Posting unlocks the moment those are saved.',
      cta: 'Complete Profile',
    };
  }


  if (profile.verification_status === 'approved') {
    return {
      state: 'verified',
      canPost: true,
      isVerified: true,
      title: 'Verified Recruiter',
      body: 'Your posts show a Verified Recruiter badge to drivers.',
    };
  }

  // pending or rejected (non-suspended): standard posting is fully enabled.
  const isRejected = profile.verification_status === 'rejected';
  return {
    state: 'active_unverified',
    canPost: true,
    isVerified: false,
    title: 'Standard posting enabled',
    body: isRejected
      ? 'Standard posting remains enabled. The Verified Recruiter badge was not approved — you can update your verification details and resubmit without losing standard posting.'
      : 'Your standard opportunities go live to drivers immediately. Verified Recruiter badge review is pending; standard posting remains enabled while review is in progress.',
  };
}

// ---------------------------------------------------------------------------
// Phase 1F-A.2.2-R1A — pure presentation view derived from canonical
// eligibility. Used by BOTH RecruiterAccessPage's visible trust badge and
// the RecruiterOnboarding status card, plus rendered tests. Never
// reimplements completeness; delegates to describeRecruiterEligibility().
// ---------------------------------------------------------------------------
export type RecruiterTrustBadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive';

export interface RecruiterTrustView {
  /** Canonical eligibility state. */
  state: RecruiterEligibilityState;
  /** True iff standard posting is enabled right now. */
  canPost: boolean;
  /** True iff admin has awarded the Verified Recruiter trust badge. */
  isVerified: boolean;
  /** Short label describing posting eligibility (visible in the UI). */
  postingLabel: string;
  /** Short label describing verification / trust state (visible in the UI). */
  verificationLabel: string;
  /** Badge variant to use for the verification label. */
  verificationBadgeVariant: RecruiterTrustBadgeVariant;
  /** True iff the "Verified Recruiter" affirmation should render. */
  showVerifiedBadge: boolean;
}

export function getRecruiterTrustView(
  profile: RecruiterProfile | null,
  opts: { intentRecruiter?: boolean } = {},
): RecruiterTrustView {
  const e = describeRecruiterEligibility(profile, opts);

  if (e.state === 'missing_profile') {
    return {
      state: e.state,
      canPost: false,
      isVerified: false,
      postingLabel: 'Setup required — standard posting not enabled',
      verificationLabel: 'Not submitted',
      verificationBadgeVariant: 'outline',
      showVerifiedBadge: false,
    };
  }

  if (e.state === 'suspended') {
    return {
      state: e.state,
      canPost: false,
      isVerified: false,
      postingLabel: 'Recruiter access suspended',
      verificationLabel: 'Suspended',
      verificationBadgeVariant: 'destructive',
      showVerifiedBadge: false,
    };
  }

  if (e.state === 'incomplete_profile') {
    const v = profile?.verification_status;
    const verificationLabel =
      v === 'approved'
        ? 'Verified'
        : v === 'rejected'
        ? 'Verification Not Approved'
        : 'Pending Verification';
    return {
      state: e.state,
      canPost: false,
      isVerified: false,
      postingLabel: 'Finish your recruiter profile — standard posting not enabled',
      verificationLabel,
      verificationBadgeVariant: 'secondary',
      showVerifiedBadge: false,
    };
  }

  if (e.state === 'verified') {
    return {
      state: e.state,
      canPost: true,
      isVerified: true,
      postingLabel: 'Standard posting enabled',
      verificationLabel: 'Verified Recruiter',
      verificationBadgeVariant: 'default',
      showVerifiedBadge: true,
    };
  }

  // active_unverified: complete + pending or rejected (not suspended).
  const v = profile?.verification_status;
  const verificationLabel =
    v === 'rejected' ? 'Verification Not Approved' : 'Pending Verification';
  return {
    state: e.state,
    canPost: true,
    isVerified: false,
    postingLabel: 'Standard posting enabled',
    verificationLabel,
    verificationBadgeVariant: v === 'rejected' ? 'secondary' : 'outline',
    showVerifiedBadge: false,
  };
}

