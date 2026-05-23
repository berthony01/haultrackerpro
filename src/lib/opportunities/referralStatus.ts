// Shared user-friendly labels + recruiter-allowed transitions for driver referrals.
// Database is the source of truth for what statuses are accepted; this file is
// the canonical UI mapping.

export type ReferralStatus =
  | 'referral_sent'
  | 'driver_viewed'
  | 'driver_requested_info'
  | 'recruiter_contacted'
  | 'application_started'
  | 'interview_scheduled'
  | 'offer_sent'
  | 'contract_sent'
  | 'hired'
  | 'waiting_period_started'
  | 'waiting_period_completed'
  | 'eligible_for_bonus'
  | 'marked_paid_externally'
  | 'closed_not_hired';

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  referral_sent: 'Referral sent',
  driver_viewed: 'Driver viewed',
  driver_requested_info: 'Driver requested info',
  recruiter_contacted: 'Recruiter contacted',
  application_started: 'Application started',
  interview_scheduled: 'Interview scheduled',
  offer_sent: 'Offer sent',
  contract_sent: 'Contract sent',
  hired: 'Hired',
  waiting_period_started: 'Waiting period started',
  waiting_period_completed: 'Waiting period completed',
  eligible_for_bonus: 'Eligible based on recruiter terms',
  marked_paid_externally: 'Marked paid externally',
  closed_not_hired: 'Closed, not hired',
};

export function referralStatusLabel(status: string): string {
  return REFERRAL_STATUS_LABELS[status as ReferralStatus] ?? status;
}

// Statuses a recruiter can move a referral to from the UI.
export const RECRUITER_SELECTABLE_STATUSES: ReferralStatus[] = [
  'recruiter_contacted',
  'application_started',
  'interview_scheduled',
  'offer_sent',
  'contract_sent',
  'hired',
  'waiting_period_started',
  'waiting_period_completed',
  'eligible_for_bonus',
  'marked_paid_externally',
  'closed_not_hired',
];

export const EXTERNAL_PAYMENT_DISCLAIMER =
  'Referral bonuses, if offered, are paid externally by the recruiter. Haul Tracker Pro tracks referral progress only and does not process or guarantee payments.';
