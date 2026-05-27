import { Users, Crown, TrendingUp, BarChart3, CreditCard, RefreshCw, Sparkles, ParkingCircle, Shield, Trophy, Gift, Building2, Briefcase, Mail, Send } from 'lucide-react';
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
