import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

export type RecruiterBlockReason =
  | 'missing_profile'
  | 'pending_review'
  | 'rejected'
  | 'suspended'
  | 'ok';

export interface RecruiterBlockDescription {
  reason: RecruiterBlockReason;
  title: string;
  body: string;
  cta?: string;
}

/**
 * Central copy for recruiter-side "why can't I post?" states.
 * Used by the manager gate and by the createOpportunity error path so
 * the recruiter sees the exact corrective action, not a generic message.
 */
export function describeRecruiterBlock(
  profile: RecruiterProfile | null,
  opts: { intentRecruiter?: boolean } = {},
): RecruiterBlockDescription {
  if (!profile) {
    return {
      reason: 'missing_profile',
      title: opts.intentRecruiter
        ? 'Finish your recruiter setup'
        : 'Recruiter Access Required',
      body: opts.intentRecruiter
        ? 'You signed up as a recruiter, but your recruiter profile is not submitted yet. Complete the short recruiter application to unlock posting.'
        : 'You need recruiter access before posting opportunities. Apply for recruiter access to get started.',
      cta: opts.intentRecruiter ? 'Finish Recruiter Setup' : 'Apply for Recruiter Access',
    };
  }
  if (profile.status === 'suspended' || profile.verification_status === 'suspended') {
    return {
      reason: 'suspended',
      title: 'Recruiter Access Suspended',
      body: 'Your recruiter access is suspended. Contact support to review the decision — posting stays disabled until this is resolved.',
    };
  }
  if (profile.verification_status === 'rejected') {
    return {
      reason: 'rejected',
      title: 'Profile Needs Attention',
      body: 'Your recruiter profile was not approved. Update the details and resubmit — approved profiles unlock posting.',
      cta: 'Update & Resubmit',
    };
  }
  if (profile.verification_status !== 'approved') {
    return {
      reason: 'pending_review',
      title: 'Pending Review',
      body: 'Your recruiter profile is being reviewed. Most reviews complete within one business day — you will see posting unlock automatically once approved.',
    };
  }
  return {
    reason: 'ok',
    title: 'Approved',
    body: 'Posting is enabled.',
  };
}
