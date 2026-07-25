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
 *
 * Phase 1P-A1.2: for the `incomplete_profile` state we surface the
 * canonical readiness selector's ordered, human-readable messages so the
 * user sees the exact fields still blocking posting — including the
 * conditional DOT/MC requirement, which only applies to Carrier /
 * Motor Carrier accounts (never claimed as universal here).
 */
export function describeRecruiterBlock(
  profile: RecruiterProfile | null,
  opts: { intentRecruiter?: boolean } = {},
): RecruiterBlockDescription {
  const e = describeRecruiterEligibility(profile, opts);
  if (e.canPost) {
    return { reason: 'ok', title: e.title, body: e.body };
  }

  // Suspended short-circuits to the eligibility body (single suspended
  // message from readiness stays consistent with the eligibility copy).
  if (e.state === 'suspended') {
    return { reason: 'suspended', title: e.title, body: e.body, cta: e.cta };
  }

  // For missing / incomplete profiles, prefer the canonical readiness
  // selector's ordered messages so the UI shows an actionable checklist
  // rather than a generic sentence. When readiness cannot produce a
  // list (defensively), fall back to the eligibility copy.
  const readiness = resolveRecruiterReadiness(profile);
  const readinessBody = readiness.messages.join(' ');
  return {
    reason: e.state as RecruiterBlockReason,
    title: e.title,
    body: readinessBody.length > 0 ? readinessBody : e.body,
    cta: e.cta,
  };
}
