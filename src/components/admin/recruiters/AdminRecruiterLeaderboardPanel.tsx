import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import {
  useAdminRecruiterLeaderboard,
  type LeaderboardRow,
  type PerformanceLabel,
} from '@/hooks/admin/useAdminRecruiterLeaderboard';

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

export function AdminRecruiterLeaderboardPanel() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminRecruiterLeaderboard();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>('all');
  const [billingFilter, setBillingFilter] = useState<(typeof BILLING_OPTIONS)[number]>('all');
  const [perfFilter, setPerfFilter] = useState<(typeof PERF_OPTIONS)[number]>('all');
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    </div>
  );
}
