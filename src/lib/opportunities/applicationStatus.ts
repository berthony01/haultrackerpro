// Canonical application status helpers (Phase A hiring pipeline)

export type ApplicationStatus =
  | 'new'
  | 'viewed'
  | 'contact_requested'
  | 'call_scheduled'
  | 'waiting_documents'
  | 'interviewing'
  | 'offer_sent'
  // Phase 1H-A1 — new non-terminal stage between offer_sent and hired.
  | 'onboarding'
  | 'hired'
  | 'rejected'
  | 'withdrawn'
  // Legacy — kept for safety on any stale rows
  | 'contacted';

export type RecruiterTransition = Exclude<
  ApplicationStatus,
  'new' | 'withdrawn' | 'contacted'
>;

const STATUS_RANK: Record<string, number> = {
  new: 1,
  viewed: 2,
  contact_requested: 3,
  contacted: 3,
  call_scheduled: 4,
  waiting_documents: 5,
  interviewing: 6,
  offer_sent: 7,
  hired: 8,
  rejected: 8,
  withdrawn: 8,
};

export const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  viewed: 'Viewed',
  contact_requested: 'Contact Requested',
  contacted: 'Contact Requested',
  call_scheduled: 'Call Scheduled',
  waiting_documents: 'Waiting on Documents',
  interviewing: 'Interviewing',
  offer_sent: 'Offer Sent',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const STATUS_BADGE_CLASS: Record<string, string> = {
  new: 'bg-primary/15 text-primary border-primary/30',
  viewed: 'bg-muted text-foreground border-border',
  contact_requested: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  contacted: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  call_scheduled: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  waiting_documents: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  interviewing: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  offer_sent: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  hired: 'bg-green-500/15 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  withdrawn: 'bg-muted text-muted-foreground border-border',
};

const TERMINAL = new Set(['hired', 'rejected', 'withdrawn']);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

const RECRUITER_NEXT: Record<string, RecruiterTransition[]> = {
  new: ['viewed', 'contact_requested', 'rejected'],
  viewed: ['contact_requested', 'rejected'],
  contact_requested: ['call_scheduled', 'rejected'],
  contacted: ['call_scheduled', 'rejected'],
  call_scheduled: ['waiting_documents', 'interviewing', 'rejected'],
  waiting_documents: ['interviewing', 'rejected'],
  interviewing: ['offer_sent', 'rejected'],
  offer_sent: ['hired', 'rejected'],
};

export function getAllowedRecruiterTransitions(currentStatus: string): RecruiterTransition[] {
  if (TERMINAL.has(currentStatus)) return [];
  return RECRUITER_NEXT[currentStatus] ?? [];
}

export const RECRUITER_ACTION_LABEL: Record<RecruiterTransition, string> = {
  viewed: 'Mark Viewed',
  contact_requested: 'Request Contact',
  call_scheduled: 'Schedule Call',
  waiting_documents: 'Waiting on Docs',
  interviewing: 'Move to Interview',
  offer_sent: 'Send Offer',
  hired: 'Hire',
  rejected: 'Reject',
};

// Pipeline groupings
export const RECRUITER_PIPELINE_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'new', label: 'New', statuses: ['new'] },
  { key: 'viewed', label: 'Viewed', statuses: ['viewed'] },
  { key: 'contact', label: 'Contact Requested', statuses: ['contact_requested', 'contacted'] },
  { key: 'call', label: 'Call Scheduled', statuses: ['call_scheduled'] },
  { key: 'docs', label: 'Waiting Docs', statuses: ['waiting_documents'] },
  { key: 'interview', label: 'Interviewing', statuses: ['interviewing'] },
  { key: 'offer', label: 'Offer Sent', statuses: ['offer_sent'] },
  { key: 'closed', label: 'Closed', statuses: ['hired', 'rejected', 'withdrawn'] },
];

export const DRIVER_PIPELINE_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'new', label: 'New Requests', statuses: ['new'] },
  { key: 'viewed', label: 'Recruiter Viewed', statuses: ['viewed'] },
  {
    key: 'discussion',
    label: 'In Discussion',
    statuses: ['contact_requested', 'contacted', 'call_scheduled', 'waiting_documents'],
  },
  {
    key: 'interview',
    label: 'Interviewing & Offers',
    statuses: ['interviewing', 'offer_sent'],
  },
  { key: 'closed', label: 'Closed', statuses: ['hired', 'rejected', 'withdrawn'] },
];

export function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 0;
}

// Event type → human label
export const EVENT_LABEL: Record<string, string> = {
  application_created: 'Driver requested info',
  new: 'Application opened',
  viewed: 'Recruiter viewed request',
  contact_requested: 'Recruiter requested contact',
  contacted: 'Recruiter requested contact',
  call_scheduled: 'Call scheduled',
  waiting_documents: 'Waiting on documents',
  interviewing: 'Moved to interview',
  offer_sent: 'Offer sent',
  hired: 'Driver hired',
  rejected: 'Application rejected',
  withdrawn: 'Driver withdrew',
  driver_still_interested: 'Driver: still interested',
  driver_request_callback: 'Driver requested callback',
  driver_need_more_info: 'Driver needs more info',
  driver_not_interested: 'Driver: not interested',
  contact_request_created: 'Recruiter requested contact permission',
  contact_request_approved: 'Driver approved contact',
  contact_request_declined: 'Driver declined contact',
  contact_request_expired: 'Contact request expired',
};
