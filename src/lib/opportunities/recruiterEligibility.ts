import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

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

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Phase 1F-A: canonical recruiter posting rule.
 *
 * A recruiter can post standard opportunities as soon as their profile is
 * complete and their account is not suspended. Admin verification is a
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

  const complete =
    isNonEmpty(profile.recruiter_name) &&
    isNonEmpty(profile.company_name) &&
    isNonEmpty(profile.recruiter_email);

  if (!complete) {
    return {
      state: 'incomplete_profile',
      canPost: false,
      isVerified: false,
      title: 'Finish your recruiter profile',
      body: 'Add your recruiter name, company name, and recruiter email to your profile. Posting unlocks the moment those are saved.',
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
  // Verification is a trust badge only.
  return {
    state: 'active_unverified',
    canPost: true,
    isVerified: false,
    title: 'Standard posting enabled',
    body: 'Your standard opportunities go live to drivers right away. A Verified Recruiter badge is added later once an admin reviews your profile.',
  };
}
