// Phase 14: Static recruiter lifecycle email templates + deterministic readiness rules.
// Runtime-only. No sending, no storage, no backend, no driver PII.

import type { LeaderboardRow } from '@/hooks/admin/useAdminRecruiterLeaderboard';

export const PLATFORM_NAME = 'Haul Tracker Pro';
export const DASHBOARD_URL = 'https://haultrackerpro.com';

export type RecruiterEmailTemplateKey =
  | 'welcome_verified'
  | 'approval_pending'
  | 'activation_nudge'
  | 'first_listing_nudge'
  | 'application_follow_up'
  | 'contact_conversion_nudge'
  | 'billing_attention'
  | 'high_performer_checkin'
  | 'not_ready';

export type ReadinessLabel =
  | 'Ready for welcome'
  | 'Needs approval review'
  | 'Needs activation nudge'
  | 'Needs listing nudge'
  | 'Needs application follow-up'
  | 'Needs contact conversion follow-up'
  | 'Billing attention'
  | 'High performer check-in'
  | 'Do not contact yet';

export type RecruiterEmailReadiness = {
  readiness_label: ReadinessLabel;
  suggested_template: RecruiterEmailTemplateKey;
  reason: string;
  priority: 'High' | 'Medium' | 'Low';
  email_missing: boolean;
};

export type RecruiterEmailTemplate = {
  key: RecruiterEmailTemplateKey;
  label: string;
  subject: string;
  body: string;
};

export const RECRUITER_EMAIL_TEMPLATES: Record<RecruiterEmailTemplateKey, RecruiterEmailTemplate> = {
  welcome_verified: {
    key: 'welcome_verified',
    label: 'Welcome / Verified Recruiter',
    subject: 'Welcome to {{platform_name}} Recruiter Tools',
    body:
`Hi {{recruiter_name}},

Welcome to {{platform_name}}. Your recruiter profile for {{company_name}} is set up and ready to use.

You can now:
- Post driver opportunities for {{company_name}}
- Manage your active listings
- Review applications and contact requests from interested drivers

A clear profile and complete listing details (pay, location, equipment, requirements) help drivers evaluate your opportunities with confidence.

Log in any time to manage your recruiter dashboard: {{dashboard_url}}

Thanks for being on {{platform_name}}.`,
  },
  approval_pending: {
    key: 'approval_pending',
    label: 'Approval Pending Follow-Up',
    subject: 'Your {{platform_name}} recruiter profile is under review',
    body:
`Hi {{recruiter_name}},

Thanks for signing up {{company_name}} on {{platform_name}}. Your recruiter profile is currently pending review.

To help review move smoothly, please make sure your profile has:
- Accurate company name and contact information
- DOT/MC details where applicable
- A clear description of the kind of driving roles you recruit for

You can review and update your profile here: {{dashboard_url}}

We will be in touch once review is complete.`,
  },
  first_listing_nudge: {
    key: 'first_listing_nudge',
    label: 'Post First Opportunity',
    subject: 'Ready to post your first driver opportunity?',
    body:
`Hi {{recruiter_name}},

Your {{company_name}} recruiter account on {{platform_name}} is approved and ready. You have not posted an opportunity yet.

Posting your first listing helps drivers discover the roles you are hiring for. Listings that include clear pay, home time, lanes, equipment, and requirements tend to get stronger driver engagement.

Post your first opportunity here: {{dashboard_url}}`,
  },
  activation_nudge: {
    key: 'activation_nudge',
    label: 'Activate Listings',
    subject: 'Your recruiter listings need attention',
    body:
`Hi {{recruiter_name}},

{{company_name}} currently has {{total_opportunities}} listing(s) on {{platform_name}}, but none are showing as active right now.

Drivers can only engage with active opportunities. Please take a moment to review listing status and reactivate or refresh any roles you are still hiring for.

Manage your listings here: {{dashboard_url}}`,
  },
  application_follow_up: {
    key: 'application_follow_up',
    label: 'Improve Driver Applications',
    subject: 'Helping your listings attract more driver applications',
    body:
`Hi {{recruiter_name}},

{{company_name}} has {{active_opportunities}} active listing(s) on {{platform_name}}, but driver applications are still low.

A few things that can help:
- Make titles specific (route type, equipment, region)
- List pay or pay range clearly
- Describe home time and schedule
- State requirements (experience, endorsements) up front

Clear, complete listings tend to give drivers more confidence to apply.

Review your listings here: {{dashboard_url}}`,
  },
  contact_conversion_nudge: {
    key: 'contact_conversion_nudge',
    label: 'Application to Contact Follow-Up',
    subject: 'You have driver interest waiting for follow-up',
    body:
`Hi {{recruiter_name}},

{{company_name}} has {{total_applications}} application(s) on {{platform_name}}, but contact request activity is still low.

Driver interest can move quickly. Reviewing applicants and using the contact request workflow promptly can help you stay ahead of other recruiters reaching out to the same drivers.

Open your applicants here: {{dashboard_url}}`,
  },
  billing_attention: {
    key: 'billing_attention',
    label: 'Billing Attention',
    subject: 'Your {{platform_name}} recruiter billing may need attention',
    body:
`Hi {{recruiter_name}},

Your {{company_name}} recruiter billing on {{platform_name}} (plan: {{billing_plan}}) may need a quick review.

When you have a moment, please check your billing and account area to confirm everything is up to date. If you have any questions or need help, just reply to this email and we will assist.

Account: {{dashboard_url}}`,
  },
  high_performer_checkin: {
    key: 'high_performer_checkin',
    label: 'High Performer Check-In',
    subject: 'Your recruiter activity is standing out on {{platform_name}}',
    body:
`Hi {{recruiter_name}},

Quick note to say that {{company_name}}'s recruiter activity on {{platform_name}} is standing out (current performance score: {{performance_score}}).

A couple of small things that tend to keep momentum:
- Keep listings current and refreshed
- Respond promptly when drivers reach out

We would also love to hear what tools would help you manage applicants more easily. Just reply to this email with any feedback.

Dashboard: {{dashboard_url}}`,
  },
  not_ready: {
    key: 'not_ready',
    label: 'Not Ready for Outreach',
    subject: 'Do not send yet',
    body:
`This recruiter is not currently recommended for outreach based on account status or missing email.`,
  },
};

function isApprovedOrActive(row: LeaderboardRow): boolean {
  return (
    row.verification_status === 'approved' ||
    row.account_status === 'active' ||
    row.verification_status === 'active'
  );
}

function isSuspendedOrRejected(row: LeaderboardRow): boolean {
  const bad = new Set(['suspended', 'rejected']);
  return bad.has(row.verification_status) || bad.has(row.account_status);
}

export function computeRecruiterEmailReadiness(row: LeaderboardRow): RecruiterEmailReadiness {
  const email_missing = !row.recruiter_email;

  // 1. Suspended or rejected
  if (isSuspendedOrRejected(row)) {
    return {
      readiness_label: 'Do not contact yet',
      suggested_template: 'not_ready',
      priority: 'Low',
      reason: 'Recruiter account is not currently eligible for onboarding outreach.',
      email_missing,
    };
  }

  // 2. Billing past due
  if (row.billing_status === 'past_due') {
    return {
      readiness_label: 'Billing attention',
      suggested_template: 'billing_attention',
      priority: 'High',
      reason: 'Billing is past due and may need manual review before premium placement.',
      email_missing,
    };
  }

  // 3. Pending approval
  if (row.verification_status === 'pending') {
    return {
      readiness_label: 'Needs approval review',
      suggested_template: 'approval_pending',
      priority: 'High',
      reason: 'Recruiter is pending verification and may need review before onboarding.',
      email_missing,
    };
  }

  // 4. Approved/active but no opportunities
  if (isApprovedOrActive(row) && row.total_opportunities === 0) {
    return {
      readiness_label: 'Needs listing nudge',
      suggested_template: 'first_listing_nudge',
      priority: 'High',
      reason: 'Recruiter is approved/active but has not posted an opportunity yet.',
      email_missing,
    };
  }

  // 5. Has opportunities but no active opportunities
  if (row.total_opportunities > 0 && row.active_opportunities === 0) {
    return {
      readiness_label: 'Needs activation nudge',
      suggested_template: 'activation_nudge',
      priority: 'Medium',
      reason: 'Recruiter has listings, but none are currently active.',
      email_missing,
    };
  }

  // 6. Active opportunities but no applications
  if (row.active_opportunities > 0 && row.total_applications === 0) {
    return {
      readiness_label: 'Needs application follow-up',
      suggested_template: 'application_follow_up',
      priority: 'Medium',
      reason: 'Recruiter has active opportunities but no driver applications yet.',
      email_missing,
    };
  }

  // 7. Applications but no contact requests
  if (row.total_applications > 0 && row.total_contact_requests === 0) {
    return {
      readiness_label: 'Needs contact conversion follow-up',
      suggested_template: 'contact_conversion_nudge',
      priority: 'Medium',
      reason: 'Recruiter has applications but no contact request activity yet.',
      email_missing,
    };
  }

  // 8. High performer
  if (row.performance_score >= 80) {
    return {
      readiness_label: 'High performer check-in',
      suggested_template: 'high_performer_checkin',
      priority: 'Low',
      reason: 'Recruiter is performing strongly and may be a good relationship-building target.',
      email_missing,
    };
  }

  // 9. Default welcome (only if email present)
  if (isApprovedOrActive(row) && row.recruiter_email) {
    return {
      readiness_label: 'Ready for welcome',
      suggested_template: 'welcome_verified',
      priority: 'Low',
      reason: 'Recruiter appears eligible for onboarding communication.',
      email_missing,
    };
  }

  // 10. No email or no clear fit
  return {
    readiness_label: 'Do not contact yet',
    suggested_template: 'not_ready',
    priority: 'Low',
    reason: email_missing
      ? 'Recruiter email is missing.'
      : 'Recruiter does not match any outreach criteria yet.',
    email_missing,
  };
}

function safe(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length === 0 ? fallback : s;
}

export function renderRecruiterTemplate(
  template: RecruiterEmailTemplate,
  row: LeaderboardRow,
): { subject: string; body: string } {
  const map: Record<string, string> = {
    recruiter_name: safe(row.recruiter_name, 'there'),
    company_name: safe(row.company_name, 'your company'),
    recruiter_email: safe(row.recruiter_email, ''),
    platform_name: PLATFORM_NAME,
    dashboard_url: DASHBOARD_URL,
    active_opportunities: safe(row.active_opportunities ?? 0, '0'),
    total_opportunities: safe(row.total_opportunities ?? 0, '0'),
    total_applications: safe(row.total_applications ?? 0, '0'),
    total_contact_requests: safe(row.total_contact_requests ?? 0, '0'),
    performance_score: safe(row.performance_score ?? 0, '0'),
    billing_plan: safe(row.billing_plan, 'current'),
  };

  const apply = (s: string) =>
    s.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => map[key] ?? '');

  return { subject: apply(template.subject), body: apply(template.body) };
}

export const RECRUITER_TEMPLATE_KEYS_ORDERED: RecruiterEmailTemplateKey[] = [
  'welcome_verified',
  'approval_pending',
  'first_listing_nudge',
  'activation_nudge',
  'application_follow_up',
  'contact_conversion_nudge',
  'billing_attention',
  'high_performer_checkin',
  'not_ready',
];
