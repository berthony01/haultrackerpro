import { Users, Crown, TrendingUp, BarChart3, CreditCard, RefreshCw, Sparkles, ParkingCircle, Shield, Trophy, Gift, Building2, Briefcase, Mail, Send, Activity, AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';
import { AdminMetricCard } from './AdminMetricCard';
import { AdminQuickActions } from './AdminQuickActions';
import { AdminSystemHealth } from './AdminSystemHealth';
import { AdminRecentActivity } from './AdminRecentActivity';

interface OverviewData {
  total_users: number;
  subs_free: number;
  subs_active_pro: number;
  subs_canceled: number;
  pro_conversion_rate: number;
  total_loads: number;
  loads_7d: number;
  total_expenses: number;
  expenses_7d: number;
  total_fuel_logs: number;
  fuel_logs_7d: number;
  recurring_templates_active: number;
  parking_locations_total: number;
  parking_reports_7d: number;
  parking_verifications_7d: number;
  driver_points_active_users: number;
  lead_magnet_signups_total: number;
  lead_magnet_signups_7d: number;
  lead_magnet_signups_30d: number;
  parse_usage_7d: number;
  expense_automation_7d: number;
  ai_insights_7d: number;
  // Recruiter marketplace
  recruiters_total: number;
  recruiters_pending: number;
  recruiters_approved: number;
  recruiters_rejected: number;
  recruiters_suspended: number;
  recruiters_active: number;
  recruiters_created_7d: number;
  recruiters_created_30d: number;
  recruiter_billing_total: number;
  recruiter_billing_active: number;
  recruiter_billing_trialing: number;
  recruiter_billing_past_due: number;
  recruiter_billing_canceled: number;
  recruiter_billing_inactive: number;
  recruiter_plan_starter: number;
  recruiter_plan_growth: number;
  recruiter_plan_fleet: number;
  opportunities_total: number;
  opportunities_active: number;
  opportunities_pending: number;
  opportunities_approved: number;
  opportunities_rejected: number;
  opportunities_flagged: number;
  opportunities_removed: number;
  opportunities_created_7d: number;
  opportunities_created_30d: number;
  applications_total: number;
  applications_7d: number;
  applications_30d: number;
  contact_requests_total: number;
  contact_requests_7d: number;
  contact_requests_30d: number;
  // Phase 7
  recruiter_funnel_signups?: number;
  recruiter_funnel_approved?: number;
  recruiter_funnel_active?: number;
  recruiter_funnel_with_opportunity?: number;
  recruiter_funnel_with_active_opportunity?: number;
  recruiter_funnel_with_application?: number;
  recruiter_funnel_with_contact_request?: number;
  recruiter_approval_rate?: number;
  recruiter_activation_rate?: number;
  recruiter_posting_rate?: number;
  recruiter_active_posting_rate?: number;
  recruiter_application_rate?: number;
  recruiter_contact_request_rate?: number;
  recruiter_marketplace_health_score?: number;
  recruiter_marketplace_health_label?: string;
  recruiter_marketplace_health_summary?: string;
  recruiter_health_approval_points?: number;
  recruiter_health_posting_points?: number;
  recruiter_health_active_posting_points?: number;
  recruiter_health_application_points?: number;
  recruiter_health_contact_points?: number;
  recruiter_health_low_approval?: boolean;
  recruiter_health_low_posting?: boolean;
  recruiter_health_low_applications?: boolean;
  recruiter_health_low_contact_requests?: boolean;
}


interface Props {
  overview: OverviewData | null;
  onGoToTab: (tab: string) => void;
}

export function AdminOverviewPremium({ overview, onGoToTab }: Props) {
  if (!overview) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-10 text-center text-white/50">
        Loading overview…
      </div>
    );
  }

  const series = [
    overview.loads_7d,
    overview.expenses_7d,
    overview.fuel_logs_7d,
    overview.parking_reports_7d,
    overview.parking_verifications_7d,
    overview.lead_magnet_signups_7d,
    overview.parse_usage_7d,
  ];
  const max = Math.max(1, ...series);

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <section>
        <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Users & Subscriptions</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <AdminMetricCard label="Total Users" value={overview.total_users} icon={Users} />
          <AdminMetricCard label="Free Users" value={overview.subs_free} icon={Users} accent="muted" />
          <AdminMetricCard label="Active Pro" value={overview.subs_active_pro} icon={Crown} />
          <AdminMetricCard label="Canceled / Expired" value={overview.subs_canceled} icon={Users} accent="muted" />
          <AdminMetricCard label="Pro Conversion" value={`${overview.pro_conversion_rate}%`} icon={TrendingUp} accent="success" />
        </div>
      </section>

      {/* Recruiter Marketplace */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Recruiter Marketplace</p>
          <button
            type="button"
            onClick={() => onGoToTab('recruiters')}
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80 hover:text-primary"
          >
            Manage →
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <button type="button" onClick={() => onGoToTab('recruiters')} className="text-left">
            <AdminMetricCard label="Total Recruiters" value={overview.recruiters_total} icon={Building2} sub={`+${overview.recruiters_created_30d} in 30d`} />
          </button>
          <button type="button" onClick={() => onGoToTab('recruiters')} className="text-left">
            <AdminMetricCard label="Pending Review" value={overview.recruiters_pending} icon={Shield} accent={overview.recruiters_pending > 0 ? 'primary' : 'muted'} />
          </button>
          <AdminMetricCard label="Approved" value={overview.recruiters_approved} icon={Building2} accent="success" />
          <AdminMetricCard label="Active" value={overview.recruiters_active} icon={Building2} sub={`${overview.recruiters_suspended} suspended`} />
          <AdminMetricCard label="New (30d)" value={overview.recruiters_created_30d} icon={TrendingUp} sub={`${overview.recruiters_created_7d} in 7d`} accent="muted" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <AdminMetricCard label="Total Opportunities" value={overview.opportunities_total} icon={Briefcase} sub={`+${overview.opportunities_created_30d} in 30d`} />
          <button type="button" onClick={() => onGoToTab('opportunities')} className="text-left">
            <AdminMetricCard label="Active Opportunities" value={overview.opportunities_active} icon={Briefcase} accent="success" />
          </button>
          <button type="button" onClick={() => onGoToTab('opportunities')} className="text-left">
            <AdminMetricCard label="Pending Opps" value={overview.opportunities_pending} icon={Shield} accent={overview.opportunities_pending > 0 ? 'primary' : 'muted'} sub={`${overview.opportunities_flagged} flagged`} />
          </button>
          <AdminMetricCard label="Applications (30d)" value={overview.applications_30d} icon={Send} sub={`${overview.applications_total} total`} />
          <AdminMetricCard label="Contact Requests (30d)" value={overview.contact_requests_30d} icon={Mail} sub={`${overview.contact_requests_total} total`} accent="muted" />
        </div>
      </section>

      {/* Recruiter Billing */}
      <section>
        <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Recruiter Billing</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <AdminMetricCard label="Billing Profiles" value={overview.recruiter_billing_total} icon={CreditCard} />
          <AdminMetricCard label="Active" value={overview.recruiter_billing_active} icon={Crown} accent="success" />
          <AdminMetricCard label="Trialing" value={overview.recruiter_billing_trialing} icon={Sparkles} /> {/* trial-allowlist */}
          <AdminMetricCard label="Past Due" value={overview.recruiter_billing_past_due} icon={CreditCard} accent={overview.recruiter_billing_past_due > 0 ? 'primary' : 'muted'} />
          <AdminMetricCard label="Starter" value={overview.recruiter_plan_starter} icon={Users} accent="muted" />
          <AdminMetricCard label="Growth" value={overview.recruiter_plan_growth} icon={TrendingUp} accent="muted" />
          <AdminMetricCard label="Fleet" value={overview.recruiter_plan_fleet} icon={Building2} accent="muted" />
        </div>
      </section>

      {/* Phase 7: Marketplace Health */}
      <MarketplaceHealthSection overview={overview} />

      {/* Activity + chart row */}
      <section className="grid gap-4 lg:grid-cols-3">

        <div className="space-y-3 lg:col-span-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Activity (Last 7 Days)</p>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <AdminMetricCard label="Loads" value={overview.loads_7d} icon={BarChart3} sub={`${overview.total_loads} total`} />
            <AdminMetricCard label="Expenses" value={overview.expenses_7d} icon={CreditCard} sub={`${overview.total_expenses} total`} />
            <AdminMetricCard label="Fuel Logs" value={overview.fuel_logs_7d} icon={BarChart3} sub={`${overview.total_fuel_logs} total`} />
            <AdminMetricCard label="Active Recurring" value={overview.recurring_templates_active} icon={RefreshCw} sub="templates" accent="muted" />
          </div>

          {/* Chart panel — derived bar viz from real metrics */}
          <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#0D111A] to-[#0A0E16] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white">Platform Activity Overview</p>
                <p className="text-[11px] text-white/40">Last 7 days · derived from existing admin metrics</p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                Live
              </span>
            </div>
            <div className="flex h-40 items-end gap-3">
              {[
                { label: 'Loads', value: overview.loads_7d },
                { label: 'Expenses', value: overview.expenses_7d },
                { label: 'Fuel', value: overview.fuel_logs_7d },
                { label: 'Park Rep', value: overview.parking_reports_7d },
                { label: 'Park Ver', value: overview.parking_verifications_7d },
                { label: 'Leads', value: overview.lead_magnet_signups_7d },
                { label: 'AI/Parse', value: overview.parse_usage_7d },
              ].map((b) => {
                const h = Math.max(4, Math.round((b.value / max) * 100));
                return (
                  <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
                    <div className="relative flex h-full w-full items-end">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-primary/80 to-primary/30 shadow-[0_0_18px_-4px_hsl(var(--primary)/0.6)]"
                        style={{ height: `${h}%` }}
                        title={`${b.label}: ${b.value}`}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-white/50">{b.label}</span>
                    <span className="font-mono text-[11px] font-bold text-white">{b.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right utility column */}
        <div className="space-y-3">
          <AdminQuickActions
            onAddAdmin={() => onGoToTab('admins')}
            onManageUsers={() => onGoToTab('users')}
            onSendEmail={() => onGoToTab('emails')}
            onViewReports={() => onGoToTab('activation')}
            onSettings={() => onGoToTab('admins')}
          />
          <AdminSystemHealth />
        </div>
      </section>

      {/* Lower context cards */}
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Community / Parking</p>
          <div className="space-y-2">
            {[
              { l: 'Locations', v: overview.parking_locations_total, i: ParkingCircle },
              { l: 'Reports (7d)', v: overview.parking_reports_7d, i: ParkingCircle },
              { l: 'Verifications (7d)', v: overview.parking_verifications_7d, i: Shield },
              { l: 'Active Drivers', v: overview.driver_points_active_users, i: Trophy },
            ].map((r) => (
              <div key={r.l} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5">
                <span className="flex items-center gap-2 text-xs text-white/70"><r.i className="h-3.5 w-3.5 text-primary/70" />{r.l}</span>
                <span className="font-mono text-sm font-bold text-white">{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Lead Magnet</p>
          <div className="space-y-2">
            {[
              { l: 'Total Signups', v: overview.lead_magnet_signups_total },
              { l: 'Last 7d', v: overview.lead_magnet_signups_7d },
              { l: 'Last 30d', v: overview.lead_magnet_signups_30d },
            ].map((r) => (
              <div key={r.l} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5">
                <span className="flex items-center gap-2 text-xs text-white/70"><Gift className="h-3.5 w-3.5 text-primary/70" />{r.l}</span>
                <span className="font-mono text-sm font-bold text-white">{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">AI / Automation (7d)</p>
          <div className="space-y-2">
            {[
              { l: 'Parse usage', v: overview.parse_usage_7d, s: 'Paste · Voice · Scan' },
              { l: 'Auto-categorized', v: overview.expense_automation_7d, s: 'expenses' },
              { l: 'AI insights', v: overview.ai_insights_7d, s: 'generated' },
            ].map((r) => (
              <div key={r.l} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5">
                <span className="flex items-center gap-2 text-xs text-white/70"><Sparkles className="h-3.5 w-3.5 text-primary/70" />{r.l}</span>
                <span className="text-right">
                  <span className="block font-mono text-sm font-bold text-white">{r.v}</span>
                  <span className="block text-[9px] text-white/40">{r.s}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <AdminRecentActivity
        loads7d={overview.loads_7d}
        expenses7d={overview.expenses_7d}
        fuel7d={overview.fuel_logs_7d}
        activeDrivers={overview.driver_points_active_users}
      />
    </div>
  );
}

function MarketplaceHealthSection({ overview }: { overview: OverviewData }) {
  const score = overview.recruiter_marketplace_health_score ?? 0;
  const label = overview.recruiter_marketplace_health_label ?? 'Early / insufficient activity';
  const summary =
    overview.recruiter_marketplace_health_summary ??
    'No recruiter signups yet. Health score will become meaningful once recruiters join the marketplace.';

  const scoreColor =
    score >= 80
      ? 'text-emerald-400 ring-emerald-500/30 bg-emerald-500/10'
      : score >= 60
      ? 'text-primary ring-primary/30 bg-primary/10'
      : score >= 40
      ? 'text-amber-400 ring-amber-500/30 bg-amber-500/10'
      : score >= 20
      ? 'text-orange-400 ring-orange-500/30 bg-orange-500/10'
      : 'text-white/60 ring-white/10 bg-white/5';

  const flags = [
    overview.recruiter_health_low_approval && 'Low recruiter approval rate',
    overview.recruiter_health_low_posting && 'Low recruiter posting rate',
    overview.recruiter_health_low_applications && 'Low application rate',
    overview.recruiter_health_low_contact_requests && 'Low contact request rate',
  ].filter(Boolean) as string[];

  const funnel: Array<{ label: string; value: number }> = [
    { label: 'Signups', value: overview.recruiter_funnel_signups ?? 0 },
    { label: 'Approved', value: overview.recruiter_funnel_approved ?? 0 },
    { label: 'Active', value: overview.recruiter_funnel_active ?? 0 },
    { label: 'Posted Opp', value: overview.recruiter_funnel_with_opportunity ?? 0 },
    { label: 'Active Opp', value: overview.recruiter_funnel_with_active_opportunity ?? 0 },
    { label: 'Received App', value: overview.recruiter_funnel_with_application ?? 0 },
    { label: 'Contact Req', value: overview.recruiter_funnel_with_contact_request ?? 0 },
  ];

  const rates: Array<{ label: string; value: number }> = [
    { label: 'Approval Rate', value: overview.recruiter_approval_rate ?? 0 },
    { label: 'Activation Rate', value: overview.recruiter_activation_rate ?? 0 },
    { label: 'Posting Rate', value: overview.recruiter_posting_rate ?? 0 },
    { label: 'Active Posting Rate', value: overview.recruiter_active_posting_rate ?? 0 },
    { label: 'Application Rate', value: overview.recruiter_application_rate ?? 0 },
    { label: 'Contact Request Rate', value: overview.recruiter_contact_request_rate ?? 0 },
  ];

  const breakdown: Array<{ label: string; value: number; max: number }> = [
    { label: 'Approval', value: overview.recruiter_health_approval_points ?? 0, max: 20 },
    { label: 'Posting', value: overview.recruiter_health_posting_points ?? 0, max: 25 },
    { label: 'Active Posting', value: overview.recruiter_health_active_posting_points ?? 0, max: 20 },
    { label: 'Applications', value: overview.recruiter_health_application_points ?? 0, max: 20 },
    { label: 'Contact', value: overview.recruiter_health_contact_points ?? 0, max: 15 },
  ];

  return (
    <section>
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Marketplace Health</p>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Score card */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-5 lg:col-span-1">
          <div className="flex items-center gap-3">
            <div className={`rounded-xl p-3 ring-1 ${scoreColor}`}>
              <Gauge className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Health Score</p>
              <p className={`font-mono text-3xl font-black tracking-tight`}>
                <span className="text-white">{score}</span>
                <span className="text-white/30 text-xl"> / 100</span>
              </p>
            </div>
          </div>
          <p className={`mt-3 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${scoreColor}`}>{label}</p>
          <p className="mt-3 text-xs leading-relaxed text-white/60">{summary}</p>
        </div>

        {/* Funnel + rates */}
        <div className="space-y-3 lg:col-span-2">
          <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Recruiter Funnel</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {funnel.map((f) => (
                <div key={f.label} className="rounded-lg bg-white/[0.02] px-2.5 py-2 ring-1 ring-white/[0.04]">
                  <p className="text-[10px] font-medium text-white/50 truncate">{f.label}</p>
                  <p className="font-mono text-lg font-bold text-white">{f.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Conversion Rates</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {rates.map((r) => (
                <div key={r.label} className="rounded-lg bg-white/[0.02] px-2.5 py-2 ring-1 ring-white/[0.04]">
                  <p className="text-[10px] font-medium text-white/50 truncate">{r.label}</p>
                  <p className="font-mono text-lg font-bold text-white">{r.value}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {/* Breakdown */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4 lg:col-span-2">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Score Breakdown</p>
          <div className="space-y-2">
            {breakdown.map((b) => {
              const pct = b.max > 0 ? Math.min(100, Math.round((b.value / b.max) * 100)) : 0;
              return (
                <div key={b.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-white/70">{b.label}</span>
                    <span className="font-mono font-bold text-white">
                      {b.value} <span className="text-white/40">/ {b.max}</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Risk flags */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Attention Items</p>
          {flags.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-2.5 py-2 ring-1 ring-emerald-500/20">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-xs text-white/70">No major recruiter marketplace warnings based on loaded metrics.</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {flags.map((f) => (
                <li key={f} className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 ring-1 ring-amber-500/20">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span className="text-xs text-white/80">{f}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

