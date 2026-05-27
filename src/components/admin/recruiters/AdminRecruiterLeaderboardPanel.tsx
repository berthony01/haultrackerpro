import { useMemo, useState, type ReactNode } from 'react';
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
} from 'lucide-react';
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
  | 'verification';

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
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<LeaderboardRow | null>(null);

  const rows: LeaderboardRow[] = data ?? [];

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
      return true;
    });
  }, [rows, search, statusFilter, billingFilter, perfFilter]);

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
        default:
          return 0;
      }
    });
    return copy;
  }, [filtered, sortBy]);

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
              <EmailReadinessSection row={r} />

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

function EmailReadinessSection({ row }: { row: LeaderboardRow }) {
  const readiness = useMemo(() => computeRecruiterEmailReadiness(row), [row]);
  const [selectedKey, setSelectedKey] = useState<RecruiterEmailTemplateKey>(
    readiness.suggested_template,
  );

  const template = RECRUITER_EMAIL_TEMPLATES[selectedKey];
  const rendered = useMemo(() => renderRecruiterTemplate(template, row), [template, row]);

  const isNotReady = selectedKey === 'not_ready';
  const copyDisabled = isNotReady;

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
          onClick={() => copyToClipboard(rendered.subject, 'Subject')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Copy className="h-3 w-3" /> Copy Subject
        </button>
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() => copyToClipboard(rendered.body, 'Body')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Copy className="h-3 w-3" /> Copy Body
        </button>
        <button
          type="button"
          disabled={copyDisabled}
          onClick={() =>
            copyToClipboard(
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
