// Phase 16: Admin-only client-side reminder categorization for recruiter outreach.
// Pure derivation. No backend writes, no notifications, no scheduled jobs.

import type {
  RecruiterOutreachStatusRow,
  OutreachPriority,
} from '@/hooks/admin/useRecruiterOutreachStatus';

export type ReminderCategory =
  | 'overdue'
  | 'due_today'
  | 'upcoming'
  | 'unscheduled'
  | 'closed'
  | 'replied';

export const REMINDER_CATEGORY_LABEL: Record<ReminderCategory, string> = {
  overdue: 'Overdue',
  due_today: 'Due Today',
  upcoming: 'Upcoming',
  unscheduled: 'Unscheduled',
  closed: 'Closed',
  replied: 'Replied',
};

export interface ReminderInfo {
  category: ReminderCategory;
  daysDelta: number | null; // negative=overdue, 0=today, positive=upcoming
  indicator: string;
  followUpAt: string | null;
  priority: OutreachPriority | null;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function computeReminderInfo(
  outreach: RecruiterOutreachStatusRow | undefined,
  now: Date = new Date(),
): ReminderInfo {
  if (!outreach) {
    return {
      category: 'unscheduled',
      daysDelta: null,
      indicator: 'No follow-up scheduled',
      followUpAt: null,
      priority: null,
    };
  }
  if (outreach.status === 'closed') {
    return {
      category: 'closed',
      daysDelta: null,
      indicator: 'Closed',
      followUpAt: outreach.follow_up_at,
      priority: outreach.priority,
    };
  }
  if (outreach.status === 'replied') {
    return {
      category: 'replied',
      daysDelta: null,
      indicator: 'Replied',
      followUpAt: outreach.follow_up_at,
      priority: outreach.priority,
    };
  }
  if (!outreach.follow_up_at) {
    return {
      category: 'unscheduled',
      daysDelta: null,
      indicator: 'No follow-up scheduled',
      followUpAt: null,
      priority: outreach.priority,
    };
  }
  const due = new Date(outreach.follow_up_at);
  if (isNaN(due.getTime())) {
    return {
      category: 'unscheduled',
      daysDelta: null,
      indicator: 'No follow-up scheduled',
      followUpAt: outreach.follow_up_at,
      priority: outreach.priority,
    };
  }
  const today0 = startOfLocalDay(now);
  const due0 = startOfLocalDay(due);
  const diffDays = Math.round((due0.getTime() - today0.getTime()) / 86400000);
  if (diffDays < 0) {
    const d = Math.abs(diffDays);
    return {
      category: 'overdue',
      daysDelta: diffDays,
      indicator: `Overdue by ${d} day${d === 1 ? '' : 's'}`,
      followUpAt: outreach.follow_up_at,
      priority: outreach.priority,
    };
  }
  if (diffDays === 0) {
    return {
      category: 'due_today',
      daysDelta: 0,
      indicator: 'Due today',
      followUpAt: outreach.follow_up_at,
      priority: outreach.priority,
    };
  }
  return {
    category: 'upcoming',
    daysDelta: diffDays,
    indicator: `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`,
    followUpAt: outreach.follow_up_at,
    priority: outreach.priority,
  };
}

export function reminderCategoryBadgeClass(c: ReminderCategory): string {
  switch (c) {
    case 'overdue':
      return 'bg-red-500/15 text-red-300 ring-red-500/30';
    case 'due_today':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'upcoming':
      return 'bg-sky-500/15 text-sky-300 ring-sky-500/30';
    case 'closed':
      return 'bg-white/10 text-white/60 ring-white/15';
    case 'replied':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    default:
      return 'bg-white/5 text-white/60 ring-white/10';
  }
}

const PRIORITY_RANK: Record<OutreachPriority, number> = { high: 0, medium: 1, low: 2 };
const CATEGORY_RANK: Record<ReminderCategory, number> = {
  overdue: 0,
  due_today: 1,
  upcoming: 2,
  unscheduled: 3,
  replied: 4,
  closed: 5,
};

export function compareReminders(
  a: { info: ReminderInfo; score: number; company: string },
  b: { info: ReminderInfo; score: number; company: string },
): number {
  const cr = CATEGORY_RANK[a.info.category] - CATEGORY_RANK[b.info.category];
  if (cr !== 0) return cr;
  // For upcoming, sort by priority then date
  if (a.info.category === 'upcoming') {
    const pa = a.info.priority ? PRIORITY_RANK[a.info.priority] : 3;
    const pb = b.info.priority ? PRIORITY_RANK[b.info.priority] : 3;
    if (pa !== pb) return pa - pb;
  }
  if (a.info.followUpAt && b.info.followUpAt) {
    const at = new Date(a.info.followUpAt).getTime();
    const bt = new Date(b.info.followUpAt).getTime();
    if (at !== bt) return at - bt;
  } else if (a.info.followUpAt) {
    return -1;
  } else if (b.info.followUpAt) {
    return 1;
  }
  if (a.score !== b.score) return b.score - a.score;
  return a.company.localeCompare(b.company);
}
