import type { Tables } from '@/integrations/supabase/types';

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

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Client-side email validation aligned with the server pattern.
 * Rejects empty/whitespace, missing @, missing domain suffix.
 */
export function isValidRecruiterEmail(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** True iff the profile has stamped or been grandfathered into posting terms. */
export function hasAcceptedPostingTerms(profile: RecruiterProfile | null): boolean {
  if (!profile) return false;
  const anyProfile = profile as unknown as Record<string, unknown>;
  return (
    typeof anyProfile.posting_terms_accepted_at === 'string' ||
    typeof anyProfile.legacy_terms_grandfathered_at === 'string'
  );
}

/**
 * Canonical client-side profile completeness. Mirrors the server rule in
 * public.recruiter_profile_can_manage_opportunities.
 */
export function isProfileCompleteForPosting(profile: RecruiterProfile | null): boolean {
  if (!profile) return false;
  return (
    isNonEmpty(profile.recruiter_name) &&
    isNonEmpty(profile.company_name) &&
    isValidRecruiterEmail(profile.recruiter_email) &&
    (isNonEmpty(profile.dot_number) || isNonEmpty(profile.mc_number)) &&
    hasAcceptedPostingTerms(profile)
  );
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
        : 'Recruiter Access Required',
      body: opts.intentRecruiter
        ? 'You signed up as a recruiter, but your recruiter profile is not submitted yet. Complete the short recruiter application to start posting opportunities.'
        : 'You need recruiter access before posting opportunities. Complete the recruiter application to start posting.',
      cta: opts.intentRecruiter ? 'Finish Recruiter Setup' : 'Apply for Recruiter Access',
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
      body: 'Add your recruiter name, company name, a valid recruiter email, a DOT or MC number, and accept the posting terms. Posting unlocks the moment those are saved.',
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
  return {
    state: 'active_unverified',
    canPost: true,
    isVerified: false,
    title: profile.verification_status === 'rejected'
      ? 'Standard posting enabled — Verification Not Approved'
      : 'Standard posting enabled',
    body: 'Your standard opportunities go live to drivers right away. A Verified Recruiter badge is added later once an admin reviews your profile.',
  };
}
