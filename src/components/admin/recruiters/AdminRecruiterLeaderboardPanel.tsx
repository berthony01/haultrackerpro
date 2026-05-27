import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Trophy,
  Search,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Building2,
  Mail,
  Phone,
  Briefcase,
  Send,
  TrendingUp,
  Download,
  Eye,
  X,
  Bell,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  computeReminderInfo,
  reminderCategoryBadgeClass,
  compareReminders,
  REMINDER_CATEGORY_LABEL,
  type ReminderCategory,
  type ReminderInfo,
} from '@/lib/admin/recruiterOutreachReminders';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  useAdminRecruiterLeaderboard,
  type LeaderboardRow,
  type PerformanceLabel,
  type RecentRecruiterOpportunity,
  type RecentRecruiterApplication,
  type RecentRecruiterContactRequest,
  type RecruiterApplicationSummary,
  type RecruiterContactRequestSummary,
  RECENT_OPPORTUNITY_DISPLAY_CAP,
  RECENT_APPLICATION_DISPLAY_CAP,
  RECENT_CONTACT_REQUEST_DISPLAY_CAP,
} from '@/hooks/admin/useAdminRecruiterLeaderboard';
import {
  computeRecruiterEmailReadiness,
  renderRecruiterTemplate,
  RECRUITER_EMAIL_TEMPLATES,
  RECRUITER_TEMPLATE_KEYS_ORDERED,
  type RecruiterEmailTemplateKey,
} from '@/lib/admin/recruiterEmailTemplates';
import {
  useRecruiterOutreachStatus,
  OUTREACH_STATUS_OPTIONS,
  OUTREACH_PRIORITY_OPTIONS,
  type OutreachStatus,
  type OutreachPriority,
  type RecruiterOutreachStatusRow,
} from '@/hooks/admin/useRecruiterOutreachStatus';

type OutreachHandle = ReturnType<typeof useRecruiterOutreachStatus>;


type SortKey =
  | 'score'
  | 'active_opps'
  | 'apps'
  | 'contacts'
  | 'newest'
  | 'company'
  | 'plan'
  | 'verification'
  | 'follow_up_urgency'
  | 'follow_up_date'
  | 'outreach_priority'
  | 'outreach_recently_updated';

const STATUS_OPTIONS = ['all', 'approved', 'pending', 'suspended', 'active', 'rejected'] as const;
const BILLING_OPTIONS = [
  'all',
  'active_trialing',
  'past_due',
  'starter',
  'growth',
  'fleet',
  'none',
] as const;
const PERF_OPTIONS = [
  'all',
  'Top Performer',
  'Strong',
  'Developing',
  'Low Activity',
  'Needs Attention',
] as const;

const OUTREACH_STATUS_FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All outreach' },
  { value: 'no_record' as const, label: 'No record' },
  ...OUTREACH_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];
type OutreachStatusFilter = 'all' | 'no_record' | OutreachStatus;

const REMINDER_FILTER_OPTIONS = [
  { value: 'all', label: 'All reminders' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'unscheduled', label: 'Unscheduled' },
  { value: 'replied', label: 'Replied' },
  { value: 'closed', label: 'Closed' },
] as const;
type ReminderFilter = (typeof REMINDER_FILTER_OPTIONS)[number]['value'];

const PRIORITY_FILTER_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' },
] as const;
type PriorityFilter = (typeof PRIORITY_FILTER_OPTIONS)[number]['value'];

const REMINDER_SORT_WEIGHT: Record<ReminderCategory, number> = {
  overdue: 0,
  due_today: 1,
  upcoming: 2,
  unscheduled: 3,
  replied: 4,
  closed: 5,
};

const PRIORITY_SORT_WEIGHT: Record<OutreachPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function labelColor(label: PerformanceLabel) {
  switch (label) {
    case 'Top Performer':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'Strong':
      return 'bg-primary/15 text-primary ring-primary/30';
    case 'Developing':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'Low Activity':
      return 'bg-orange-500/15 text-orange-300 ring-orange-500/30';
    default:
      return 'bg-white/5 text-white/60 ring-white/10';
  }
}

function shortId(id: string) {
  return id ? id.slice(0, 8) : '—';
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
}

// ---- CSV export helpers (Phase 10) ----
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s: string;
  if (Array.isArray(value)) s = value.filter((v) => v !== null && v !== undefined && v !== '').join('; ');
  else if (typeof value === 'boolean') s = value ? 'Yes' : 'No';
  else s = String(value);
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

const LEADERBOARD_CSV_HEADERS = [
  'Rank',
  'Recruiter Name', 'Recruiter Email', 'Recruiter Phone',
  'Company Name', 'Company City', 'Company State',
  'Recruiter Profile ID', 'Recruiter User ID',
  'Verification Status', 'Account Status', 'Created At',
  'Billing Plan', 'Billing Status', 'Active Opportunity Limit', 'Priority Placement Included',
  'Performance Score', 'Performance Label', 'Performance Flags',
  'Total Opportunities', 'Active Opportunities', 'Pending Opportunities',
  'Approved Opportunities', 'Rejected Opportunities', 'Flagged Opportunities',
  'Removed Opportunities', 'Opportunities 30d',
  'Total Applications', 'Applications 30d', 'Applications Per Active Opportunity',
  'Total Contact Requests', 'Contact Requests 30d', 'Responded Contact Requests',
  'Contact Requests Per Application', 'Response Rate',
  'Listing Activity Points', 'Active Listings Points', 'Driver Interest Points',
  'Contact Conversion Points', 'Account Billing Points',
];

function leaderboardRowToCsv(r: LeaderboardRow, rank: number): string {
  const cells: unknown[] = [
    rank,
    r.recruiter_name, r.recruiter_email, r.recruiter_phone,
    r.company_name, r.company_city, r.company_state,
    r.recruiter_profile_id, r.recruiter_user_id,
    r.verification_status, r.account_status,
    r.created_at ? new Date(r.created_at).toISOString() : '',
    r.billing_plan, r.billing_status, r.active_opportunity_limit, r.priority_placement_included,
    r.performance_score, r.performance_label, r.performance_flags,
    r.total_opportunities, r.active_opportunities, r.pending_opportunities,
    r.approved_opportunities, r.rejected_opportunities, r.flagged_opportunities,
    r.removed_opportunities, r.opportunities_30d,
    r.total_applications, r.applications_30d, r.application_per_active_opportunity.toFixed(1),
    r.total_contact_requests, r.contact_requests_30d, r.responded_contact_requests,
    r.contact_request_per_application.toFixed(1), `${r.response_rate.toFixed(1)}%`,
    r.score_breakdown.listing, r.score_breakdown.active, r.score_breakdown.interest,
    r.score_breakdown.contact, r.score_breakdown.account_billing,
  ];
  return cells.map(csvCell).join(',');
}

function downloadLeaderboardCsv(rows: LeaderboardRow[], perfFilter: string, statusFilter: string) {
  const body = rows.map((r, i) => leaderboardRowToCsv(r, i + 1));
  const csv = [LEADERBOARD_CSV_HEADERS.map(csvCell).join(','), ...body].join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const slugParts = ['haultrackerpro-recruiter-leaderboard'];
  if (perfFilter !== 'all') slugParts.push(perfFilter.toLowerCase().replace(/\s+/g, '-'));
  else if (statusFilter !== 'all') slugParts.push(statusFilter);
  slugParts.push(date);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugParts.join('-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AdminRecruiterLeaderboardPanel() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminRecruiterLeaderboard();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>('all');
  const [billingFilter, setBillingFilter] = useState<(typeof BILLING_OPTIONS)[number]>('all');
  const [perfFilter, setPerfFilter] = useState<(typeof PERF_OPTIONS)[number]>('all');
  const [outreachStatusFilter, setOutreachStatusFilter] = useState<OutreachStatusFilter>('all');
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<LeaderboardRow | null>(null);

  const rows: LeaderboardRow[] = data ?? [];

  // Phase 16: Load outreach records for all loaded recruiters so we can derive reminders.
  const panelOutreach = useRecruiterOutreachStatus(
    useMemo(() => rows.map((r) => r.recruiter_profile_id), [rows]),
  );
  const outreachByRecruiterId = panelOutreach.outreachByRecruiterId;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // Search
      if (q) {
        const hay = [
          r.recruiter_name,
          r.recruiter_email ?? '',
          r.recruiter_phone ?? '',
          r.company_name,
          r.company_city ?? '',
          r.company_state ?? '',
          r.verification_status,
          r.account_status,
          r.billing_plan ?? '',
          r.billing_status ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Status
      if (statusFilter !== 'all') {
        if (
          r.verification_status !== statusFilter &&
          r.account_status !== statusFilter
        )
          return false;
      }
      // Billing
      if (billingFilter !== 'all') {
        if (billingFilter === 'active_trialing') {
          if (r.billing_status !== 'active' && r.billing_status !== 'trialing') return false;
        } else if (billingFilter === 'past_due') {
          if (r.billing_status !== 'past_due') return false;
        } else if (billingFilter === 'none') {
          if (r.billing_plan || r.billing_status) return false;
        } else {
          if (r.billing_plan !== billingFilter) return false;
        }
      }
      // Performance
      if (perfFilter !== 'all' && r.performance_label !== perfFilter) return false;

      // Phase 17: Outreach status
      const outreach = outreachByRecruiterId.get(r.recruiter_profile_id);
      if (outreachStatusFilter !== 'all') {
        if (outreachStatusFilter === 'no_record') {
          if (outreach) return false;
        } else {
          if (!outreach || outreach.status !== outreachStatusFilter) return false;
        }
      }
      // Phase 17: Reminder category (no outreach record => 'unscheduled')
      if (reminderFilter !== 'all') {
        const cat = computeReminderInfo(outreach).category;
        if (cat !== reminderFilter) return false;
      }
      // Phase 17: Priority
      if (priorityFilter !== 'all') {
        if (priorityFilter === 'none') {
          if (outreach) return false;
        } else {
          if (!outreach || outreach.priority !== priorityFilter) return false;
        }
      }
      return true;
    });
  }, [
    rows,
    search,
    statusFilter,
    billingFilter,
    perfFilter,
    outreachStatusFilter,
    reminderFilter,
    priorityFilter,
    outreachByRecruiterId,
  ]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.performance_score - a.performance_score;
        case 'active_opps':
          return b.active_opportunities - a.active_opportunities;
        case 'apps':
          return b.total_applications - a.total_applications;
        case 'contacts':
          return b.total_contact_requests - a.total_contact_requests;
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'company':
          return a.company_name.localeCompare(b.company_name);
        case 'plan':
          return (a.billing_plan ?? 'zzz').localeCompare(b.billing_plan ?? 'zzz');
        case 'verification':
          return a.verification_status.localeCompare(b.verification_status);
        case 'follow_up_urgency': {
          const oa = outreachByRecruiterId.get(a.recruiter_profile_id);
          const ob = outreachByRecruiterId.get(b.recruiter_profile_id);
          const ia = computeReminderInfo(oa);
          const ib = computeReminderInfo(ob);
          const wa = REMINDER_SORT_WEIGHT[ia.category];
          const wb = REMINDER_SORT_WEIGHT[ib.category];
          if (wa !== wb) return wa - wb;
          if (ia.followUpAt && ib.followUpAt) {
            const ta = new Date(ia.followUpAt).getTime();
            const tb = new Date(ib.followUpAt).getTime();
            if (ta !== tb) return ta - tb;
          } else if (ia.followUpAt) return -1;
          else if (ib.followUpAt) return 1;
          if (a.performance_score !== b.performance_score)
            return b.performance_score - a.performance_score;
          return a.company_name.localeCompare(b.company_name);
        }
        case 'follow_up_date': {
          const oa = outreachByRecruiterId.get(a.recruiter_profile_id);
          const ob = outreachByRecruiterId.get(b.recruiter_profile_id);
          const fa = oa?.follow_up_at ? new Date(oa.follow_up_at).getTime() : null;
          const fb = ob?.follow_up_at ? new Date(ob.follow_up_at).getTime() : null;
          if (fa !== null && fb !== null) {
            if (fa !== fb) return fa - fb;
          } else if (fa !== null) return -1;
          else if (fb !== null) return 1;
          return a.company_name.localeCompare(b.company_name);
        }
        case 'outreach_priority': {
          const oa = outreachByRecruiterId.get(a.recruiter_profile_id);
          const ob = outreachByRecruiterId.get(b.recruiter_profile_id);
          const pa = oa?.priority ? PRIORITY_SORT_WEIGHT[oa.priority] : 3;
          const pb = ob?.priority ? PRIORITY_SORT_WEIGHT[ob.priority] : 3;
          if (pa !== pb) return pa - pb;
          const ia = computeReminderInfo(oa);
          const ib = computeReminderInfo(ob);
          const wa = REMINDER_SORT_WEIGHT[ia.category];
          const wb = REMINDER_SORT_WEIGHT[ib.category];
          if (wa !== wb) return wa - wb;
          if (a.performance_score !== b.performance_score)
            return b.performance_score - a.performance_score;
          return a.company_name.localeCompare(b.company_name);
        }
        case 'outreach_recently_updated': {
          const oa = outreachByRecruiterId.get(a.recruiter_profile_id);
          const ob = outreachByRecruiterId.get(b.recruiter_profile_id);
          const ta = oa?.updated_at ? new Date(oa.updated_at).getTime() : null;
          const tb = ob?.updated_at ? new Date(ob.updated_at).getTime() : null;
          if (ta !== null && tb !== null) {
            if (ta !== tb) return tb - ta;
          } else if (ta !== null) return -1;
          else if (tb !== null) return 1;
          return a.company_name.localeCompare(b.company_name);
        }
        default:
          return 0;
      }
    });
    return copy;
  }, [filtered, sortBy, outreachByRecruiterId]);

  // Loaded-row summary
  const summary = useMemo(() => {
    const loaded = rows.length;
    const top = rows.filter((r) => r.performance_label === 'Top Performer').length;
    const active = rows.filter(
      (r) => r.verification_status === 'approved' || r.account_status === 'active'
    ).length;
    const withActiveListings = rows.filter((r) => r.active_opportunities > 0).length;
    const withApps = rows.filter((r) => r.total_applications > 0).length;
    const withCr = rows.filter((r) => r.total_contact_requests > 0).length;
    const avg =
      loaded > 0
        ? Math.round(rows.reduce((s, r) => s + r.performance_score, 0) / loaded)
        : 0;
    return { loaded, top, active, withActiveListings, withApps, withCr, avg };
  }, [rows]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#0D111A] to-[#0A0E16] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-white">Recruiter Performance Leaderboard</h2>
            </div>
            <p className="mt-1 text-xs text-white/60">
              Rank recruiters by marketplace activity, listings, applications, contact requests, and
              billing status.
            </p>
            <p className="mt-2 text-[11px] text-white/40">
              Read-only admin analytics. Scores are directional and based on currently loaded
              recruiter marketplace data.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (sorted.length === 0) {
                  toast.error('No leaderboard rows to export');
                  return;
                }
                try {
                  downloadLeaderboardCsv(sorted, perfFilter, statusFilter);
                  toast.success(`Exported ${sorted.length} recruiter${sorted.length === 1 ? '' : 's'} to CSV`);
                } catch (e) {
                  toast.error(`Export failed: ${(e as Error)?.message ?? 'Unknown error'}`);
                }
              }}
              disabled={sorted.length === 0}
              title="Export current leaderboard view to CSV"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
            >
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-white/40">
          CSV export uses the current search, filters, and sort order.
        </p>
      </div>

      {/* Summary cards */}
      <section>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
          Loaded Leaderboard Summary
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {[
            { l: 'Recruiters Loaded', v: summary.loaded },
            { l: 'Top Performers', v: summary.top },
            { l: 'Active Recruiters', v: summary.active },
            { l: 'With Active Listings', v: summary.withActiveListings },
            { l: 'With Applications', v: summary.withApps },
            { l: 'With Contact Requests', v: summary.withCr },
            { l: 'Average Score', v: summary.avg },
          ].map((c) => (
            <div
              key={c.l}
              className="rounded-xl border border-white/[0.06] bg-[#0D111A] px-3 py-2"
            >
              <p className="truncate text-[10px] font-medium text-white/50">{c.l}</p>
              <p className="font-mono text-xl font-bold text-white">{c.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Phase 16: Outreach Follow-Up Reminders */}
      <OutreachRemindersSummary
        rows={sorted}
        outreachByRecruiterId={panelOutreach.outreachByRecruiterId}
        onView={(row) => setSelected(row)}
      />

      {/* Filters */}
      <section className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-3">
        <div className="grid gap-2 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recruiters, companies, emails…"
              className="w-full rounded-lg border border-white/10 bg-[#0A0E16] py-2 pl-8 pr-3 text-xs text-white placeholder:text-white/40 focus:border-primary/50 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-2 text-xs text-white"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All recruiters' : s}
              </option>
            ))}
          </select>
          <select
            value={billingFilter}
            onChange={(e) => setBillingFilter(e.target.value as typeof billingFilter)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-2 text-xs text-white"
          >
            {BILLING_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b === 'all'
                  ? 'All billing'
                  : b === 'active_trialing'
                  ? 'Active/Trialing'
                  : b === 'past_due'
                  ? 'Past Due'
                  : b === 'none'
                  ? 'No billing profile'
                  : b}
              </option>
            ))}
          </select>
          <select
            value={perfFilter}
            onChange={(e) => setPerfFilter(e.target.value as typeof perfFilter)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-2 text-xs text-white"
          >
            {PERF_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p === 'all' ? 'All performance levels' : p}
              </option>
            ))}
          </select>
        </div>
        {/* Phase 17: Outreach filters */}
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <select
            value={outreachStatusFilter}
            onChange={(e) => setOutreachStatusFilter(e.target.value as OutreachStatusFilter)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-2 text-xs text-white"
            aria-label="Outreach Status"
          >
            {OUTREACH_STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'all' ? o.label : `Outreach: ${o.label}`}
              </option>
            ))}
          </select>
          <select
            value={reminderFilter}
            onChange={(e) => setReminderFilter(e.target.value as ReminderFilter)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-2 text-xs text-white"
            aria-label="Reminder Category"
          >
            {REMINDER_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'all' ? o.label : `Reminder: ${o.label}`}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-2 text-xs text-white"
            aria-label="Outreach Priority"
          >
            {PRIORITY_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'all' ? o.label : `Priority: ${o.label}`}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-[10px] text-white/40">
          Outreach filters use saved manual outreach tracking only. No emails or reminders are sent.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-white/10 bg-[#0A0E16] px-2 py-1.5 text-xs text-white"
          >
            <option value="score">Performance Score</option>
            <option value="active_opps">Most Active Opportunities</option>
            <option value="apps">Most Applications</option>
            <option value="contacts">Most Contact Requests</option>
            <option value="newest">Newest Recruiters</option>
            <option value="company">Company A–Z</option>
            <option value="plan">Billing Plan</option>
            <option value="verification">Verification Status</option>
            <option value="follow_up_urgency">Follow-Up Urgency</option>
            <option value="follow_up_date">Follow-Up Date</option>
            <option value="outreach_priority">Outreach Priority</option>
            <option value="outreach_recently_updated">Outreach Recently Updated</option>
          </select>
          <span className="ml-auto text-[11px] text-white/40">
            {sorted.length} of {rows.length} shown
          </span>
        </div>
      </section>


      {/* States */}
      {isLoading && (
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-8 text-center text-sm text-white/60">
          Loading recruiter leaderboard…
        </div>
      )}
      {isError && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-300">
          Failed to load leaderboard: {(error as Error)?.message ?? 'Unknown error'}
        </div>
      )}
      {!isLoading && !isError && sorted.length === 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-8 text-center text-sm text-white/50">
          No recruiters match the current filters.
        </div>
      )}

      {/* Rows */}
      <ul className="space-y-2">
        {sorted.map((r, idx) => {
          const open = expanded.has(r.recruiter_profile_id);
          const flagsToShow = r.performance_flags.slice(0, 3);
          const extra = r.performance_flags.length - flagsToShow.length;
          return (
            <li
              key={r.recruiter_profile_id}
              className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white/60">
                      #{idx + 1}
                    </span>
                    <Building2 className="h-4 w-4 shrink-0 text-primary/70" />
                    <p className="truncate text-sm font-bold text-white">{r.company_name}</p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-white/60">
                    {r.recruiter_name}
                    {r.company_city || r.company_state ? (
                      <span className="text-white/40">
                        {' '}
                        · {[r.company_city, r.company_state].filter(Boolean).join(', ')}
                      </span>
                    ) : null}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${labelColor(r.performance_label)}`}
                    >
                      {r.performance_label} · {r.performance_score}
                    </span>
                    <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                      verif: {r.verification_status}
                    </span>
                    <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/70 ring-1 ring-white/10">
                      acct: {r.account_status}
                    </span>
                    {r.billing_plan ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20">
                        {r.billing_plan} · {r.billing_status ?? '—'}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/50 ring-1 ring-white/10">
                        no billing profile
                      </span>
                    )}
                    {r.priority_placement_included && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                        priority placement
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!r.recruiter_email}
                    onClick={() =>
                      r.recruiter_email && copyToClipboard(r.recruiter_email, 'Email')
                    }
                    title={r.recruiter_email ? 'Copy recruiter email' : 'No email on file'}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Mail className="h-3 w-3" />
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={!r.recruiter_phone}
                    onClick={() =>
                      r.recruiter_phone && copyToClipboard(r.recruiter_phone, 'Phone')
                    }
                    title={r.recruiter_phone ? 'Copy recruiter phone' : 'No phone on file'}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Phone className="h-3 w-3" />
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    title="View recruiter performance details"
                    className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/15"
                  >
                    <Eye className="h-3 w-3" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.recruiter_profile_id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
                  >
                    {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Details
                  </button>
                </div>
              </div>

              {/* Metrics grid */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                {[
                  { l: 'Active Opps', v: r.active_opportunities, i: Briefcase },
                  { l: 'Total Opps', v: r.total_opportunities, i: Briefcase },
                  { l: 'Applications', v: r.total_applications, i: Send },
                  { l: 'Contact Reqs', v: r.total_contact_requests, i: Mail },
                  { l: 'Response Rate', v: `${r.response_rate.toFixed(1)}%`, i: TrendingUp },
                  { l: '30d Apps', v: r.applications_30d, i: TrendingUp },
                ].map((m) => {
                  const Icon = m.i;
                  return (
                    <div
                      key={m.l}
                      className="rounded-lg bg-white/[0.02] px-2 py-1.5 ring-1 ring-white/[0.04]"
                    >
                      <p className="flex items-center gap-1 text-[10px] font-medium text-white/50">
                        <Icon className="h-3 w-3" />
                        {m.l}
                      </p>
                      <p className="font-mono text-sm font-bold text-white">{m.v}</p>
                    </div>
                  );
                })}
              </div>

              {/* Flags */}
              {flagsToShow.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {flagsToShow.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/20"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {f}
                    </span>
                  ))}
                  {extra > 0 && (
                    <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                      +{extra} more
                    </span>
                  )}
                </div>
              )}

              {/* Details */}
              {open && (
                <div className="mt-3 grid gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-3 md:grid-cols-3">
                  <div className="space-y-1.5 text-[11px]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                      Identity
                    </p>
                    <p className="text-white/70">Recruiter ID: <span className="font-mono text-white/90">{shortId(r.recruiter_profile_id)}</span></p>
                    <p className="text-white/70">User ID: <span className="font-mono text-white/90">{shortId(r.recruiter_user_id)}</span></p>
                    <p className="text-white/70">
                      Location: <span className="text-white/90">{[r.company_city, r.company_state].filter(Boolean).join(', ') || '—'}</span>
                    </p>
                    <p className="text-white/70">Joined: <span className="text-white/90">{new Date(r.created_at).toLocaleDateString()}</span></p>
                    <p className="text-white/70">
                      Billing period end:{' '}
                      <span className="text-white/90">
                        {r.current_period_end
                          ? new Date(r.current_period_end).toLocaleDateString()
                          : '—'}
                      </span>
                    </p>
                    <p className="text-white/70">
                      Active opp limit:{' '}
                      <span className="text-white/90">{r.active_opportunity_limit ?? '—'}</span>
                    </p>
                  </div>

                  <div className="space-y-1.5 text-[11px]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                      Opportunity breakdown
                    </p>
                    {[
                      ['Pending', r.pending_opportunities],
                      ['Approved', r.approved_opportunities],
                      ['Rejected', r.rejected_opportunities],
                      ['Flagged', r.flagged_opportunities],
                      ['Removed', r.removed_opportunities],
                      ['Created 30d', r.opportunities_30d],
                    ].map(([l, v]) => (
                      <p key={l as string} className="flex justify-between text-white/70">
                        <span>{l}</span>
                        <span className="font-mono text-white/90">{v as number}</span>
                      </p>
                    ))}
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                      Conversion
                    </p>
                    <p className="flex justify-between text-white/70">
                      <span>Apps / Active Opp</span>
                      <span className="font-mono text-white/90">
                        {r.application_per_active_opportunity.toFixed(1)}
                      </span>
                    </p>
                    <p className="flex justify-between text-white/70">
                      <span>Contact / App</span>
                      <span className="font-mono text-white/90">
                        {r.contact_request_per_application.toFixed(1)}
                      </span>
                    </p>
                    <p className="flex justify-between text-white/70">
                      <span>Response rate</span>
                      <span className="font-mono text-white/90">
                        {r.response_rate.toFixed(1)}%
                      </span>
                    </p>
                  </div>

                  <div className="space-y-1.5 text-[11px]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                      Score breakdown
                    </p>
                    {[
                      ['Listing activity', r.score_breakdown.listing, 25],
                      ['Active listings', r.score_breakdown.active, 20],
                      ['Driver interest', r.score_breakdown.interest, 25],
                      ['Contact conversion', r.score_breakdown.contact, 15],
                      ['Account/Billing', r.score_breakdown.account_billing, 15],
                    ].map(([l, v, m]) => {
                      const pct = Math.round(((v as number) / (m as number)) * 100);
                      return (
                        <div key={l as string}>
                          <div className="flex justify-between text-white/70">
                            <span>{l}</span>
                            <span className="font-mono text-white/90">
                              {v as number} / {m as number}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.04]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <p className="mt-1 flex justify-between text-[11px] font-bold text-white">
                      <span>Total</span>
                      <span className="font-mono">{r.performance_score} / 100</span>
                    </p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <RecruiterDetailDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ---------------- Detail Drawer (Phase 11) ----------------

function buildGuidance(r: LeaderboardRow): string[] {
  const tips: string[] = [];
  if (r.active_opportunities === 0) {
    tips.push(
      'This recruiter has no active listings. Review whether they need onboarding or approval support.'
    );
  }
  if (r.active_opportunities > 0 && r.total_applications === 0) {
    tips.push('Listings are active, but applications have not started yet.');
  }
  if (r.total_applications > 0 && r.total_contact_requests === 0) {
    tips.push('Applications exist, but contact requests have not converted yet.');
  }
  if (r.billing_status === 'past_due') {
    tips.push('Billing is past due. Review billing status before offering premium placement.');
  }
  if (r.performance_score >= 80) {
    tips.push('This recruiter is performing strongly based on current marketplace activity.');
  } else if (r.performance_score < 20) {
    tips.push('Performance score is very low. Consider outreach to identify blockers.');
  }
  if (r.verification_status === 'pending') {
    tips.push('Verification is pending. Review the recruiter profile in the Recruiters tab.');
  }
  return tips.slice(0, 5);
}

function RecruiterDetailDrawer({
  row,
  onClose,
}: {
  row: LeaderboardRow | null;
  onClose: () => void;
}) {
  const open = row !== null;
  const r = row;
  const outreach = useRecruiterOutreachStatus(r ? [r.recruiter_profile_id] : []);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-white/10 bg-[#0A0E16] p-0 text-white sm:max-w-xl"
      >
        {r && (
          <>
            <SheetHeader className="border-b border-white/[0.06] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-base font-bold text-white">
                    Recruiter Performance Details
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 truncate text-xs text-white/60">
                    {r.recruiter_name} · {r.company_name}
                  </SheetDescription>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-white/70 hover:bg-white/[0.08]"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${labelColor(r.performance_label)}`}
                >
                  {r.performance_label} · {r.performance_score}/100
                </span>
                {r.priority_placement_included && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                    priority placement
                  </span>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              {/* Identity */}
              <Section title="Recruiter Identity">
                <KV k="Recruiter" v={r.recruiter_name} />
                <KV k="Company" v={r.company_name} />
                <KV k="Email" v={r.recruiter_email ?? '—'} />
                <KV k="Phone" v={r.recruiter_phone ?? '—'} />
                <KV
                  k="Location"
                  v={[r.company_city, r.company_state].filter(Boolean).join(', ') || '—'}
                />
                <KV k="Recruiter ID" v={r.recruiter_profile_id ? `${shortId(r.recruiter_profile_id)}…` : '—'} mono />
                <KV k="User ID" v={r.recruiter_user_id ? `${shortId(r.recruiter_user_id)}…` : '—'} mono />
                <KV
                  k="Joined"
                  v={r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                />
              </Section>

              {/* Account / Billing */}
              <Section title="Account & Billing">
                <KV k="Verification" v={r.verification_status} />
                <KV k="Account status" v={r.account_status} />
                <KV k="Billing plan" v={r.billing_plan ?? '—'} />
                <KV k="Billing status" v={r.billing_status ?? '—'} />
                <KV
                  k="Active opp limit"
                  v={r.active_opportunity_limit !== null ? String(r.active_opportunity_limit) : '—'}
                />
                <KV
                  k="Priority placement"
                  v={r.priority_placement_included ? 'Yes' : 'No'}
                />
                <KV
                  k="Billing period end"
                  v={
                    r.current_period_end
                      ? new Date(r.current_period_end).toLocaleDateString()
                      : '—'
                  }
                />
              </Section>

              {/* Performance Score */}
              <Section title="Performance Score">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-white/60">Score</span>
                    <span className="font-mono text-2xl font-bold text-white">
                      {r.performance_score}
                      <span className="text-sm text-white/40"> / 100</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/60">
                    Label: <span className="font-semibold text-white/90">{r.performance_label}</span>
                  </p>
                  {r.performance_flags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.performance_flags.map((f) => (
                        <span
                          key={f}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/20"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {f}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-white/40">No flags.</p>
                  )}
                  <p className="mt-2 text-[10px] text-white/40">
                    Internal directional score based on loaded marketplace activity.
                  </p>
                </div>
              </Section>

              {/* Score Breakdown */}
              <Section title="Score Breakdown">
                <div className="space-y-2">
                  {[
                    ['Listing Activity', r.score_breakdown.listing, 25],
                    ['Active Listings', r.score_breakdown.active, 20],
                    ['Driver Interest', r.score_breakdown.interest, 25],
                    ['Contact Conversion', r.score_breakdown.contact, 15],
                    ['Account/Billing', r.score_breakdown.account_billing, 15],
                  ].map(([l, v, m]) => {
                    const pct = Math.round(((v as number) / (m as number)) * 100);
                    return (
                      <div key={l as string}>
                        <div className="flex justify-between text-[11px] text-white/70">
                          <span>{l}</span>
                          <span className="font-mono text-white/90">
                            {v as number} / {m as number}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Opportunity Breakdown */}
              <Section title="Opportunity Breakdown">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Total', r.total_opportunities],
                    ['Active', r.active_opportunities],
                    ['Pending', r.pending_opportunities],
                    ['Approved', r.approved_opportunities],
                    ['Rejected', r.rejected_opportunities],
                    ['Flagged', r.flagged_opportunities],
                    ['Removed', r.removed_opportunities],
                    ['Created 30d', r.opportunities_30d],
                  ].map(([l, v]) => (
                    <MiniStat key={l as string} label={l as string} value={v as number} />
                  ))}
                </div>
              </Section>

              {/* Recent Opportunities (Phase 12, display-only) */}
              <Section title="Recent Opportunities">
                <p className="-mt-1 mb-2 text-[11px] text-white/55">
                  Latest listings for this recruiter based on currently loaded admin data.
                </p>
                <RecentOpportunitiesList items={r.recent_opportunities} />
                <p className="mt-2 text-[10px] text-white/40">
                  Showing up to {RECENT_OPPORTUNITY_DISPLAY_CAP} recent listings. Totals above may
                  include more opportunities. Recent list is informational and does not recalculate
                  leaderboard totals.
                </p>
              </Section>



              {/* Application & Contact Activity */}
              <Section title="Application & Contact Activity">
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Total Applications" value={r.total_applications} />
                  <MiniStat label="Applications 30d" value={r.applications_30d} />
                  <MiniStat
                    label="Apps / Active Opp"
                    value={r.application_per_active_opportunity.toFixed(1)}
                  />
                  <MiniStat label="Total Contact Reqs" value={r.total_contact_requests} />
                  <MiniStat label="Contact Reqs 30d" value={r.contact_requests_30d} />
                  <MiniStat label="Responded" value={r.responded_contact_requests} />
                  <MiniStat
                    label="Contact / App"
                    value={r.contact_request_per_application.toFixed(1)}
                  />
                  <MiniStat label="Response Rate" value={`${r.response_rate.toFixed(1)}%`} />
                </div>
              </Section>

              {/* Application & Contact Drill-Down (Phase 13, display-only) */}
              <Section title="Application & Contact Drill-Down">
                <p className="-mt-1 mb-2 text-[11px] text-white/55">
                  Status and recent activity summary without driver private contact details.
                </p>

                <p className="mt-1 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Application Status Summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Total" value={r.application_summary.total} />
                  <MiniStat label="Last 30d" value={r.application_summary.last_30d} />
                  <MiniStat label="Pending" value={r.application_summary.pending} />
                  <MiniStat label="Approved" value={r.application_summary.approved} />
                  <MiniStat label="Rejected" value={r.application_summary.rejected} />
                  <MiniStat label="Withdrawn" value={r.application_summary.withdrawn} />
                  <MiniStat label="Other" value={r.application_summary.other} />
                  <MiniStat label="Latest" value={formatRecentDate(r.application_summary.latest_at)} />
                </div>

                <p className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Contact Request Status Summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Total" value={r.contact_request_summary.total} />
                  <MiniStat label="Last 30d" value={r.contact_request_summary.last_30d} />
                  <MiniStat label="Pending" value={r.contact_request_summary.pending} />
                  <MiniStat label="Approved" value={r.contact_request_summary.approved} />
                  <MiniStat label="Rejected" value={r.contact_request_summary.rejected} />
                  <MiniStat label="Responded" value={r.contact_request_summary.responded} />
                  <MiniStat label="Other" value={r.contact_request_summary.other} />
                  <MiniStat label="Latest" value={formatRecentDate(r.contact_request_summary.latest_at)} />
                  <MiniStat
                    label="Response Rate"
                    value={`${r.contact_request_summary.response_rate.toFixed(1)}%`}
                  />
                </div>

                <p className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Recent Applications
                </p>
                <RecentApplicationsList items={r.recent_applications} />

                <p className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Recent Contact Requests
                </p>
                <RecentContactRequestsList items={r.recent_contact_requests} />

                <p className="mt-2 text-[10px] text-white/40">
                  Showing up to {RECENT_APPLICATION_DISPLAY_CAP} recent applications and {RECENT_CONTACT_REQUEST_DISPLAY_CAP} recent contact requests. Totals above may include more activity. Driver contact details, notes, and messages are intentionally hidden in this admin drill-down.
                </p>
              </Section>

              {/* Email Readiness (Phase 14, display + copy-only) */}
              <EmailReadinessSection row={r} outreach={outreach} />

              {/* Manual Outreach Tracking (Phase 15) */}
              <OutreachTrackingSection row={r} outreach={outreach} />

              {/* Guidance */}
              <Section title="Admin Guidance">

                {(() => {
                  const tips = buildGuidance(r);
                  if (tips.length === 0) {
                    return (
                      <p className="text-[11px] text-white/50">
                        No directional guidance at this time.
                      </p>
                    );
                  }
                  return (
                    <ul className="space-y-1.5">
                      {tips.map((t) => (
                        <li
                          key={t}
                          className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-white/80"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
                <p className="mt-2 text-[10px] text-white/40">
                  Guidance is deterministic and based on loaded metrics only.
                </p>
              </Section>

              {/* Safe Actions */}
              <Section title="Safe Actions">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!r.recruiter_email}
                    onClick={() =>
                      r.recruiter_email && copyToClipboard(r.recruiter_email, 'Email')
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Mail className="h-3 w-3" />
                    <Copy className="h-3 w-3" />
                    Copy Email
                  </button>
                  <button
                    type="button"
                    disabled={!r.recruiter_phone}
                    onClick={() =>
                      r.recruiter_phone && copyToClipboard(r.recruiter_phone, 'Phone')
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Phone className="h-3 w-3" />
                    <Copy className="h-3 w-3" />
                    Copy Phone
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
                  >
                    Close
                  </button>
                </div>
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
        {title}
      </p>
      {children}
    </section>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-[11px]">
      <span className="text-white/60">{k}</span>
      <span className={`text-right text-white/90 ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white/[0.02] px-2.5 py-1.5 ring-1 ring-white/[0.04]">
      <p className="truncate text-[10px] font-medium text-white/50">{label}</p>
      <p className="font-mono text-sm font-bold text-white">{value}</p>
    </div>
  );
}

// ---------------- Recent Opportunities (Phase 12) ----------------

function formatRecentDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'active':
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'pending':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'flagged':
      return 'bg-orange-500/15 text-orange-300 ring-orange-500/30';
    case 'rejected':
    case 'removed':
      return 'bg-red-500/15 text-red-300 ring-red-500/30';
    case 'draft':
      return 'bg-white/[0.06] text-white/70 ring-white/10';
    default:
      return 'bg-white/[0.04] text-white/60 ring-white/10';
  }
}

function StatusPill({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value && value.length > 0 ? value : 'unknown';
  const display = v === 'unknown' ? 'Unknown' : v;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusBadgeClass(v)}`}
      title={`${label}: ${display}`}
    >
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      {display}
    </span>
  );
}

function RecentOpportunitiesList({ items }: { items: RecentRecruiterOpportunity[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/55">
        No recent opportunities found for this recruiter.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((o) => {
        const route = [o.hiring_city, o.hiring_state].filter(Boolean).join(', ');
        return (
          <li
            key={o.id}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-white">
                  {o.title ?? 'Untitled listing'}
                </p>
                {o.company_name && (
                  <p className="mt-0.5 truncate text-[11px] text-white/60">{o.company_name}</p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[10px] text-white/40" title={o.id}>
                {shortId(o.id)}…
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusPill label="Status" value={o.status} />
              <StatusPill label="Review" value={o.admin_review_status} />
              {o.driver_type && (
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70 ring-1 ring-white/10">
                  {o.driver_type}
                </span>
              )}
              {o.trailer_type && (
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70 ring-1 ring-white/10">
                  {o.trailer_type}
                </span>
              )}
              {o.route_type && (
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70 ring-1 ring-white/10">
                  {o.route_type}
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-white/55">
              <span>
                Created: <span className="text-white/80">{formatRecentDate(o.created_at)}</span>
              </span>
              <span>
                Published: <span className="text-white/80">{formatRecentDate(o.published_at)}</span>
              </span>
              {route && (
                <span className="col-span-2 truncate">
                  Route: <span className="text-white/80">{route}</span>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------- Recent Applications / Contact Requests (Phase 13) ----------------

function appStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'pending':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'rejected':
      return 'bg-red-500/15 text-red-300 ring-red-500/30';
    case 'withdrawn':
      return 'bg-white/[0.06] text-white/60 ring-white/10';
    default:
      return 'bg-white/[0.04] text-white/60 ring-white/10';
  }
}

function crStatusBadgeClass(status: string | null | undefined, responded: boolean): string {
  if (responded) return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'rejected':
    case 'declined':
      return 'bg-red-500/15 text-red-300 ring-red-500/30';
    case 'pending':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    default:
      return 'bg-white/[0.04] text-white/60 ring-white/10';
  }
}

function RecentApplicationsList({ items }: { items: RecentRecruiterApplication[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/55">
        No recent applications found for this recruiter.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => {
        const statusValue = a.status ?? 'unknown';
        return (
          <li key={a.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-white">
                  {a.opportunity_title ?? 'Opportunity unavailable'}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-white/40" title={a.id}>
                {shortId(a.id)}…
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${appStatusBadgeClass(a.status)}`}
                title={`Application status: ${statusValue}`}
              >
                <span className="text-[9px] uppercase tracking-wider text-white/40">App</span>
                {statusValue}
              </span>
              {a.opportunity_status && <StatusPill label="Opp" value={a.opportunity_status} />}
              {a.opportunity_admin_review_status && (
                <StatusPill label="Review" value={a.opportunity_admin_review_status} />
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-white/55">
              <span>
                Created: <span className="text-white/80">{formatRecentDate(a.created_at)}</span>
              </span>
              <span>
                Updated: <span className="text-white/80">{formatRecentDate(a.updated_at)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RecentContactRequestsList({ items }: { items: RecentRecruiterContactRequest[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/55">
        No recent contact requests found for this recruiter.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((c) => {
        const responded = !!c.responded_at || c.status === 'responded' || c.status === 'completed';
        const statusValue = responded ? 'responded' : c.status ?? 'unknown';
        return (
          <li key={c.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-white">
                  {c.opportunity_title ?? 'Opportunity unavailable'}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-white/40" title={c.id}>
                {shortId(c.id)}…
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${crStatusBadgeClass(c.status, responded)}`}
                title={`Contact request status: ${statusValue}`}
              >
                <span className="text-[9px] uppercase tracking-wider text-white/40">Req</span>
                {statusValue}
              </span>
              {c.application_status && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${appStatusBadgeClass(c.application_status)}`}
                  title={`Linked application status: ${c.application_status}`}
                >
                  <span className="text-[9px] uppercase tracking-wider text-white/40">App</span>
                  {c.application_status}
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-white/55">
              <span>
                Created: <span className="text-white/80">{formatRecentDate(c.created_at)}</span>
              </span>
              <span>
                Responded: <span className="text-white/80">{formatRecentDate(c.responded_at)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Phase 14: Email Readiness section ----
function priorityBadgeClass(p: 'High' | 'Medium' | 'Low'): string {
  switch (p) {
    case 'High':
      return 'bg-rose-500/15 text-rose-300 ring-rose-500/30';
    case 'Medium':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    default:
      return 'bg-white/5 text-white/60 ring-white/10';
  }
}

function EmailReadinessSection({
  row,
  outreach,
}: {
  row: LeaderboardRow;
  outreach: OutreachHandle;
}) {
  const readiness = useMemo(() => computeRecruiterEmailReadiness(row), [row]);
  const [selectedKey, setSelectedKey] = useState<RecruiterEmailTemplateKey>(
    readiness.suggested_template,
  );

  const template = RECRUITER_EMAIL_TEMPLATES[selectedKey];
  const rendered = useMemo(() => renderRecruiterTemplate(template, row), [template, row]);

  const isNotReady = selectedKey === 'not_ready';
  const copyDisabled = isNotReady;

  const trackCopy = async () => {
    if (isNotReady) return;
    try {
      await outreach.markTemplateCopied.mutateAsync({
        recruiter_profile_id: row.recruiter_profile_id,
        recruiter_user_id: row.recruiter_user_id,
        template_key: template.key,
        template_label: template.label,
        default_priority: readiness.priority.toLowerCase() as OutreachPriority,
      });
    } catch {
      toast.error('Template copied, but outreach tracking could not be updated.');
    }
  };

  const handleCopy = async (value: string, label: string) => {
    await copyToClipboard(value, label);
    await trackCopy();
  };

  return (
    <Section title="Email Readiness">
      <p className="-mt-1 mb-3 text-[11px] text-white/55">
        Suggested outreach based on this recruiter's current marketplace activity. No emails are
        sent from this panel.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${labelColor(
            'Strong' as PerformanceLabel,
          )}`}
        >
          {readiness.readiness_label}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${priorityBadgeClass(
            readiness.priority,
          )}`}
        >
          Priority: {readiness.priority}
        </span>
      </div>

      <p className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-white/80">
        {readiness.reason}
      </p>

      {readiness.email_missing && (
        <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
          Recruiter email is missing. You can still copy a draft, but there is no address to send
          it to from this account.
        </p>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Template
        </label>
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value as RecruiterEmailTemplateKey)}
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          {RECRUITER_TEMPLATE_KEYS_ORDERED.map((k) => {
            const t = RECRUITER_EMAIL_TEMPLATES[k];
            const suggested = k === readiness.suggested_template ? ' (suggested)' : '';
            return (
              <option key={k} value={k} className="bg-[#0b1220]">
                {t.label}
                {suggested}
              </option>
            );
          })}
        </select>
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Subject
        </p>
        <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-white/85">
          {rendered.subject}
        </p>
      </div>

      <div className="mb-3">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Body preview
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-white/80">
{rendered.body}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() => handleCopy(rendered.subject, 'Subject')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Copy className="h-3 w-3" /> Copy Subject
        </button>
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() => handleCopy(rendered.body, 'Body')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Copy className="h-3 w-3" /> Copy Body
        </button>
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() =>
            handleCopy(
              `Subject: ${rendered.subject}\n\n${rendered.body}`,
              'Full email draft',
            )
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3 w-3" /> Copy Full Email
        </button>
      </div>

      {isNotReady && (
        <p className="mt-2 text-[10px] text-white/50">
          Copy is disabled for the "Not Ready" template. Choose a different template or wait until
          this recruiter is eligible for outreach.
        </p>
      )}

      <p className="mt-3 text-[10px] text-white/40">
        This only copies a draft. {`Haul Tracker Pro`} does not send emails from this panel.
      </p>
    </Section>
  );
}

// ---------------- Manual Outreach Tracking (Phase 15) ----------------

function outreachStatusBadgeClass(s: OutreachStatus): string {
  switch (s) {
    case 'replied':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'contacted_manually':
      return 'bg-primary/15 text-primary ring-primary/30';
    case 'follow_up_scheduled':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'template_copied':
      return 'bg-sky-500/15 text-sky-300 ring-sky-500/30';
    case 'no_response':
      return 'bg-orange-500/15 text-orange-300 ring-orange-500/30';
    case 'closed':
      return 'bg-white/10 text-white/60 ring-white/15';
    default:
      return 'bg-white/5 text-white/60 ring-white/10';
  }
}

function outreachStatusLabel(s: OutreachStatus): string {
  return OUTREACH_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function OutreachTrackingSection({
  row,
  outreach,
}: {
  row: LeaderboardRow;
  outreach: OutreachHandle;
}) {
  const existing: RecruiterOutreachStatusRow | undefined =
    outreach.outreachByRecruiterId.get(row.recruiter_profile_id);

  const readiness = useMemo(() => computeRecruiterEmailReadiness(row), [row]);
  const defaultPriority = readiness.priority.toLowerCase() as OutreachPriority;

  const currentStatus: OutreachStatus = existing?.status ?? 'outreach_needed';
  const currentPriority: OutreachPriority = existing?.priority ?? defaultPriority;

  const [note, setNote] = useState<string>(existing?.admin_note ?? '');
  const [followUpInput, setFollowUpInput] = useState<string>(toDatetimeLocal(existing?.follow_up_at));

  // Sync local state when the underlying record changes (e.g. after refetch).
  useEffect(() => {
    setNote(existing?.admin_note ?? '');
    setFollowUpInput(toDatetimeLocal(existing?.follow_up_at));
  }, [existing?.admin_note, existing?.follow_up_at]);

  const charCount = note.length;
  const baseArgs = {
    recruiter_profile_id: row.recruiter_profile_id,
    recruiter_user_id: row.recruiter_user_id,
  };

  const handleStatus = async (value: OutreachStatus) => {
    try {
      await outreach.upsertStatus.mutateAsync({ ...baseArgs, status: value });
      toast.success(`Outreach status set to "${outreachStatusLabel(value)}"`);
    } catch (e) {
      toast.error(`Could not update status: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handlePriority = async (value: OutreachPriority) => {
    try {
      await outreach.upsertStatus.mutateAsync({ ...baseArgs, priority: value });
      toast.success(`Priority set to ${value}`);
    } catch (e) {
      toast.error(`Could not update priority: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleMarkCopiedManually = async () => {
    try {
      await outreach.markTemplateCopied.mutateAsync({
        ...baseArgs,
        template_key: existing?.last_template_key ?? 'manual',
        template_label: existing?.last_template_label ?? 'Manual mark',
        default_priority: defaultPriority,
      });
      toast.success('Template copy recorded');
    } catch (e) {
      toast.error(`Could not record template copy: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleMarkContacted = async () => {
    try {
      await outreach.markContactedManually.mutateAsync(baseArgs);
      toast.success('Manual contact marked');
    } catch (e) {
      toast.error(`Could not mark contacted: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleSaveNote = async () => {
    try {
      await outreach.saveNote.mutateAsync({ ...baseArgs, admin_note: note });
      toast.success('Outreach note saved');
    } catch (e) {
      toast.error(`Could not save note: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleSaveFollowUp = async () => {
    try {
      const iso = followUpInput ? new Date(followUpInput).toISOString() : null;
      await outreach.scheduleFollowUp.mutateAsync({ ...baseArgs, follow_up_at: iso });
      toast.success(iso ? 'Follow-up date saved' : 'Follow-up cleared');
    } catch (e) {
      toast.error(`Could not save follow-up: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleClose = async () => {
    try {
      await outreach.closeOutreach.mutateAsync(baseArgs);
      toast.success('Outreach closed');
    } catch (e) {
      toast.error(`Could not close outreach: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleClearFollowUp = async () => {
    try {
      await outreach.clearFollowUp.mutateAsync(baseArgs);
      setFollowUpInput('');
      toast.success('Follow-up cleared');
    } catch (e) {
      toast.error(`Could not clear follow-up: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleMarkNoResponse = async () => {
    try {
      await outreach.markNoResponse.mutateAsync(baseArgs);
      toast.success('Marked as no response');
    } catch (e) {
      toast.error(`Could not mark no response: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };

  const handleMarkReplied = async () => {
    try {
      await outreach.markReplied.mutateAsync(baseArgs);
      toast.success('Marked as replied');
    } catch (e) {
      toast.error(`Could not mark replied: ${(e as Error)?.message ?? 'Unknown error'}`);
    }
  };


  return (
    <Section title="Manual Outreach Tracking">
      <p className="-mt-1 mb-3 text-[11px] text-white/55">
        Manual workflow tracking only. No emails, reminders, or notifications are sent from this
        panel.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${outreachStatusBadgeClass(
            currentStatus,
          )}`}
        >
          Outreach: {outreachStatusLabel(currentStatus)}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${priorityBadgeClass(
            (currentPriority.charAt(0).toUpperCase() + currentPriority.slice(1)) as
              | 'High'
              | 'Medium'
              | 'Low',
          )}`}
        >
          Priority: {currentPriority}
        </span>
      </div>

      {/* Phase 16: Reminder status block */}
      <ReminderStatusBlock info={computeReminderInfo(existing)} />

      {!existing && (
        <p className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-white/70">
          No outreach tracking record yet. The first action below will create one.
        </p>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
            Status
          </label>
          <select
            value={currentStatus}
            onChange={(e) => handleStatus(e.target.value as OutreachStatus)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {OUTREACH_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#0b1220]">
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
            Priority
          </label>
          <select
            value={currentPriority}
            onChange={(e) => handlePriority(e.target.value as OutreachPriority)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {OUTREACH_PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#0b1220]">
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-white/75 sm:grid-cols-2">
        <div>
          <span className="text-white/45">Last template:</span>{' '}
          <span className="text-white/85">{existing?.last_template_label ?? '—'}</span>
        </div>
        <div>
          <span className="text-white/45">Last copied:</span>{' '}
          <span className="text-white/85">{formatLocalDateTime(existing?.last_copied_at)}</span>
        </div>
        <div>
          <span className="text-white/45">Last contacted:</span>{' '}
          <span className="text-white/85">{formatLocalDateTime(existing?.last_contacted_at)}</span>
        </div>
        <div>
          <span className="text-white/45">Follow-up:</span>{' '}
          <span className="text-white/85">{formatLocalDateTime(existing?.follow_up_at)}</span>
        </div>
        {existing?.closed_at && (
          <div className="sm:col-span-2">
            <span className="text-white/45">Closed:</span>{' '}
            <span className="text-white/85">{formatLocalDateTime(existing.closed_at)}</span>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleMarkCopiedManually}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
        >
          <Copy className="h-3 w-3" /> Mark Template Copied
        </button>
        <button
          type="button"
          onClick={handleMarkContacted}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.08] px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/[0.14]"
        >
          <Phone className="h-3 w-3" /> Mark Contacted Manually
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
        >
          <X className="h-3 w-3" /> Close Outreach
        </button>
        <button
          type="button"
          onClick={handleMarkReplied}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/[0.14]"
        >
          <CheckCircle2 className="h-3 w-3" /> Mark Replied
        </button>
        <button
          type="button"
          onClick={handleMarkNoResponse}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
        >
          <Clock className="h-3 w-3" /> Mark No Response
        </button>
        <button
          type="button"
          onClick={handleClearFollowUp}
          disabled={!existing?.follow_up_at}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CalendarX className="h-3 w-3" /> Clear Follow-Up
        </button>
      </div>


      <div className="mb-3">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Schedule follow-up (manual tracking only)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={handleSaveFollowUp}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
          >
            Save Follow-Up
          </button>
          {followUpInput && (
            <button
              type="button"
              onClick={() => {
                setFollowUpInput('');
              }}
              className="text-[10px] text-white/45 hover:text-white/70"
            >
              Clear
            </button>
          )}
        </div>
        <p className="mt-1 text-[10px] text-white/40">
          Follow-up dates are for manual tracking only. No reminder is sent.
        </p>
      </div>

      <div className="mb-2">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Admin outreach note
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          maxLength={500}
          placeholder="Example: Copied welcome template, planning manual follow-up next week."
          className="min-h-[72px] w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-white/40">{charCount}/500</span>
          <button
            type="button"
            onClick={handleSaveNote}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08]"
          >
            Save Note
          </button>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-white/40">
        Outreach tracking is admin-only. No email body or subject is stored; only template label,
        timestamps, status, priority, and your short note.
      </p>
    </Section>
  );
}

// ---------------- Phase 16: Outreach Follow-Up Reminders ----------------

function ReminderStatusBlock({ info }: { info: ReminderInfo }) {
  const dateText = info.followUpAt
    ? formatLocalDateTime(info.followUpAt)
    : 'Not scheduled';
  const priorityLabel = info.priority
    ? info.priority.charAt(0).toUpperCase() + info.priority.slice(1)
    : '—';
  return (
    <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${reminderCategoryBadgeClass(
            info.category,
          )}`}
        >
          <Bell className="h-3 w-3" />
          Reminder: {REMINDER_CATEGORY_LABEL[info.category]}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">
          Priority: <span className="text-white/75 normal-case">{priorityLabel}</span>
        </span>
      </div>
      <div className="mt-2 grid gap-1 text-[11px] text-white/75 sm:grid-cols-2">
        <div>
          <span className="text-white/45">Follow-up date:</span>{' '}
          <span className="text-white/85">{dateText}</span>
        </div>
        <div>
          <span className="text-white/45">Status:</span>{' '}
          <span className="text-white/85">{info.indicator}</span>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-white/40">
        This is a manual dashboard reminder only. No notification will be sent.
      </p>
    </div>
  );
}

interface ReminderSummaryItem {
  row: LeaderboardRow;
  info: ReminderInfo;
}

function OutreachRemindersSummary({
  rows,
  outreachByRecruiterId,
  onView,
}: {
  rows: LeaderboardRow[];
  outreachByRecruiterId: Map<string, RecruiterOutreachStatusRow>;
  onView: (row: LeaderboardRow) => void;
}) {
  const items: ReminderSummaryItem[] = useMemo(
    () =>
      rows.map((row) => ({
        row,
        info: computeReminderInfo(outreachByRecruiterId.get(row.recruiter_profile_id)),
      })),
    [rows, outreachByRecruiterId],
  );

  const counts = useMemo(() => {
    const base: Record<ReminderCategory, number> = {
      overdue: 0,
      due_today: 0,
      upcoming: 0,
      unscheduled: 0,
      closed: 0,
      replied: 0,
    };
    items.forEach((it) => {
      base[it.info.category] += 1;
    });
    return base;
  }, [items]);

  const topReminders = useMemo(() => {
    const active = items.filter(
      (it) =>
        it.info.category === 'overdue' ||
        it.info.category === 'due_today' ||
        it.info.category === 'upcoming',
    );
    active.sort((a, b) =>
      compareReminders(
        { info: a.info, score: a.row.performance_score, company: a.row.company_name },
        { info: b.info, score: b.row.performance_score, company: b.row.company_name },
      ),
    );
    return active.slice(0, 5);
  }, [items]);

  const cards: { key: ReminderCategory | 'closed_replied'; label: string; value: number; cls: string }[] = [
    { key: 'overdue', label: 'Overdue', value: counts.overdue, cls: 'text-red-300' },
    { key: 'due_today', label: 'Due Today', value: counts.due_today, cls: 'text-amber-300' },
    { key: 'upcoming', label: 'Upcoming', value: counts.upcoming, cls: 'text-sky-300' },
    { key: 'unscheduled', label: 'Unscheduled', value: counts.unscheduled, cls: 'text-white/70' },
    {
      key: 'closed_replied',
      label: 'Closed / Replied',
      value: counts.closed + counts.replied,
      cls: 'text-emerald-300',
    },
  ];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
          <Bell className="mr-1 inline h-3 w-3" />
          Outreach Follow-Up Reminders
        </p>
        <span className="text-[10px] text-white/40">
          Manual follow-up visibility only. No reminders, emails, or notifications are sent.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.key}
            className="rounded-xl border border-white/[0.06] bg-[#0D111A] px-3 py-2"
          >
            <p className="truncate text-[10px] font-medium text-white/50">{c.label}</p>
            <p className={`font-mono text-xl font-bold ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-white/40">
        Counts are based on loaded recruiter rows and saved outreach tracking records.
      </p>

      {topReminders.length > 0 && (
        <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0D111A]">
          <p className="border-b border-white/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
            <CalendarClock className="mr-1 inline h-3 w-3" />
            Top reminders ({topReminders.length})
          </p>
          <ul className="divide-y divide-white/[0.04]">
            {topReminders.map(({ row, info }) => {
              const existing = outreachByRecruiterId.get(row.recruiter_profile_id);
              const priorityLabel = info.priority
                ? info.priority.charAt(0).toUpperCase() + info.priority.slice(1)
                : '—';
              return (
                <li
                  key={row.recruiter_profile_id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                >
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${reminderCategoryBadgeClass(
                      info.category,
                    )}`}
                  >
                    {REMINDER_CATEGORY_LABEL[info.category]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-white/90">
                      {row.company_name || row.recruiter_name || '—'}
                    </p>
                    <p className="truncate text-[10px] text-white/55">
                      {existing ? outreachStatusLabel(existing.status) : 'No outreach record'} ·
                      Priority: {priorityLabel} · {info.indicator}
                      {info.followUpAt ? ` · ${formatLocalDateTime(info.followUpAt)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onView(row)}
                    className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/15"
                  >
                    <Eye className="h-3 w-3" />
                    View Details
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
