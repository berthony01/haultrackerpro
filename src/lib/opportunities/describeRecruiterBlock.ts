import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { describeRecruiterEligibility } from './recruiterEligibility';
import { resolveRecruiterReadiness } from './resolveRecruiterReadiness';


export type RecruiterBlockReason =
  | 'missing_profile'
  | 'incomplete_profile'
  | 'suspended'
  | 'ok';

export interface RecruiterBlockDescription {
  reason: RecruiterBlockReason;
  title: string;
  body: string;
  cta?: string;
}

/**
 * Phase 1F-A: describes ONLY blocking states for the posting UI.
 * Pending / rejected (non-suspended) are no longer blocking — they map
 * to `reason: 'ok'`. Verification is a trust badge only, not a gate.
 */
export function describeRecruiterBlock(
  profile: RecruiterProfile | null,
  opts: { intentRecruiter?: boolean } = {},
): RecruiterBlockDescription {
  const e = describeRecruiterEligibility(profile, opts);
  if (e.canPost) {
    return { reason: 'ok', title: e.title, body: e.body };
  }
  // Phase 1P-A1: readiness is authoritative for the actionable dialog; the
  // block-level body is preserved for legacy gate cards. Callers that need
  // the exact missing tokens should call `resolveRecruiterReadiness`.
  void resolveRecruiterReadiness;
  return {
    reason: e.state as RecruiterBlockReason,
    title: e.title,
    body: e.body,
    cta: e.cta,
  };
}


