// Phase 1H-A2 — public-safe helpers for the Apply Now workflow.
//
// Two responsibilities:
// 1. Classify existing applications for one opportunity into formal-apply
//    and request-info buckets so button state is type-aware (a request_info
//    row must not block Apply Now, and vice-versa).
// 2. Map controlled `submission_failed:<result_code>` errors surfaced by
//    `useOpportunityApplications` into Driver-facing messages that never
//    leak SQL, table names, policy names, or restriction reasons.

export type FormalApplyState =
  | { kind: 'none' }
  | { kind: 'active'; status: string }
  | { kind: 'completed'; status: 'hired' }
  | { kind: 'reapplyable'; status: 'rejected' | 'withdrawn' };

export interface RequestInfoState {
  exists: boolean;
}

interface ApplicationLike {
  opportunity_id: string;
  application_type?: string | null;
  status?: string | null;
  created_at?: string | null;
}

const FORMAL_ACTIVE_STATUSES = new Set([
  'new',
  'viewed',
  'contact_requested',
  'contacted',
  'call_scheduled',
  'waiting_documents',
  'interviewing',
  'offer_sent',
  'onboarding',
]);

export function classifyFormalApply<A extends ApplicationLike>(
  apps: A[],
  opportunityId: string,
): FormalApplyState {
  const formals = apps
    .filter((a) => a.opportunity_id === opportunityId && (a.application_type ?? 'apply') === 'apply')
    .sort((a, b) => {
      const da = a.created_at ? Date.parse(a.created_at) : 0;
      const db = b.created_at ? Date.parse(b.created_at) : 0;
      return db - da;
    });
  if (formals.length === 0) return { kind: 'none' };
  const latest = formals[0];
  const status = (latest.status ?? 'new') as string;
  if (status === 'hired') return { kind: 'completed', status: 'hired' };
  if (status === 'rejected' || status === 'withdrawn') {
    return { kind: 'reapplyable', status };
  }
  if (FORMAL_ACTIVE_STATUSES.has(status)) return { kind: 'active', status };
  // Unknown/legacy status: treat conservatively as active to prevent duplicate
  // submissions until the server confirms otherwise.
  return { kind: 'active', status };
}

export function classifyRequestInfo<A extends ApplicationLike>(
  apps: A[],
  opportunityId: string,
): RequestInfoState {
  const exists = apps.some(
    (a) => a.opportunity_id === opportunityId && a.application_type === 'request_info',
  );
  return { exists };
}

// Maps a raw thrown error message (see `assertSubmissionSuccess` in the
// hook) into a Driver-facing, public-safe copy string. Unknown errors get
// a generic retry message. Never returns raw SQL / policy names.
export function submissionErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const code = raw.startsWith('submission_failed:') ? raw.slice('submission_failed:'.length) : '';
  switch (code) {
    case 'duplicate_same_type':
      return 'You already have an active application for this opportunity.';
    case 'opportunity_unavailable':
      return 'This opportunity is no longer accepting applications.';
    case 'self_opportunity':
      return 'You cannot apply to an opportunity posted by your own Recruiter account.';
    case 'profile_required':
      return 'Complete your Opportunity Profile before applying.';
    case 'restricted':
      return 'Applications are not available for your account right now. Contact support for assistance.';
    case 'invalid_input':
      return 'Review the required confirmations and contact settings before submitting.';
    case 'question_required':
      return 'A question is required for information requests.';
    case 'empty_response':
      return 'We could not confirm the application submission. Please try again.';
    default:
      return 'Your application could not be submitted. Please try again.';
  }
}
