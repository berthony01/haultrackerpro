// Pure aggregator for admin referral oversight.
// No payment / payout / tax math. Status & date tracking only.
import {
  REFERRAL_STATUS_LABELS,
  type ReferralStatus,
} from '@/lib/opportunities/referralStatus';

export type AdminTimeframe = 'all' | '30d' | '90d' | 'mtd';

export interface AdminReferralRow {
  id: string;
  status: string;
  opportunity_id: string;
  recruiter_id: string;
  referring_driver_id: string;
  referred_driver_name?: string | null;
  referred_driver_email?: string | null;
  referred_driver_phone?: string | null;
  created_at?: string | null;
  last_status_at?: string | null;
}

export interface AdminOpportunityRow {
  id: string;
  title?: string | null;
  recruiter_id: string;
}

export interface AdminRecruiterRow {
  id: string;
  company_name?: string | null;
  recruiter_name?: string | null;
  recruiter_email?: string | null;
}

export interface AdminReferralSettingsRow {
  recruiter_id: string;
  referral_bonus_enabled?: boolean | null;
  bonus_amount?: number | null;
  bonus_terms?: string | null;
}

export interface AdminReferralKpis {
  total: number;
  open: number;
  hired: number;
  eligible: number;
  markedPaidExternally: number;
  hireRate: number; // 0-100, 0 when total=0
}

export interface RecruiterPerformance {
  recruiter_id: string;
  company_name: string;
  recruiter_email: string | null;
  total: number;
  hired: number;
  eligible: number;
  marked_paid_externally: number;
  closed_not_hired: number;
  hire_rate: number;
  last_referral_at: string | null;
  opportunity_count: number;
}

export interface DriverPerformance {
  referring_driver_id: string;
  display: string; // "Driver · #xxxxxxxx"
  total: number;
  hired: number;
  eligible: number;
  marked_paid_externally: number;
  last_referral_at: string | null;
}

export interface OpportunityPerformance {
  opportunity_id: string;
  title: string;
  company_name: string;
  total: number;
  hired: number;
  eligible: number;
  marked_paid_externally: number;
  hire_rate: number;
  last_referral_at: string | null;
}

export interface RecentActivityItem {
  id: string;
  status: string;
  referred_summary: string;
  referrer_display: string;
  opportunity_title: string;
  company_name: string;
  date_label: string;
  sort_time: number;
}

export type WatchlistKind =
  | 'high_closed'
  | 'high_marked_external'
  | 'stale_referral'
  | 'missing_terms'
  | 'no_movement';

export interface WatchlistItem {
  kind: WatchlistKind;
  label: string;
  detail: string;
  target: string; // recruiter name or referral id
}

export interface AdminReferralAggregate {
  kpis: AdminReferralKpis;
  statusBreakdown: { status: ReferralStatus; label: string; count: number }[];
  recruiterPerformance: RecruiterPerformance[];
  driverPerformance: DriverPerformance[];
  opportunityPerformance: OpportunityPerformance[];
  recent: RecentActivityItem[];
  watchlist: WatchlistItem[];
}

export function safeTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function safeDateLabel(iso: string | null | undefined): string {
  const t = safeTime(iso);
  if (t === null) return 'Date unavailable';
  return new Date(t).toLocaleDateString();
}

export function withinAdminTimeframe(
  iso: string | null | undefined,
  tf: AdminTimeframe,
): boolean {
  if (tf === 'all') return true;
  const d = safeTime(iso);
  if (d === null) return false;
  const now = Date.now();
  if (tf === '30d') return now - d <= 30 * 86400_000;
  if (tf === '90d') return now - d <= 90 * 86400_000;
  if (tf === 'mtd') {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return d >= start.getTime();
  }
  return true;
}

function driverDisplay(id: string | null | undefined): string {
  if (!id) return 'Driver';
  return `Driver · #${id.slice(0, 8)}`;
}

function referredSummary(r: AdminReferralRow): string {
  const name = r.referred_driver_name?.trim();
  if (name) return name;
  // Avoid leaking raw email/phone in admin oversight summary.
  return 'Referred driver';
}

const TERMINAL: ReadonlySet<string> = new Set([
  'closed_not_hired',
  'marked_paid_externally',
]);

export function aggregateAdminReferrals(args: {
  referrals: AdminReferralRow[];
  opportunities: AdminOpportunityRow[];
  recruiters: AdminRecruiterRow[];
  settings: AdminReferralSettingsRow[];
  timeframe: AdminTimeframe;
  now?: number;
}): AdminReferralAggregate {
  const { opportunities, recruiters, settings, timeframe } = args;
  const now = args.now ?? Date.now();

  const oppById = new Map(opportunities.map((o) => [o.id, o]));
  const recruiterById = new Map(recruiters.map((r) => [r.id, r]));
  const settingsByRecruiter = new Map(settings.map((s) => [s.recruiter_id, s]));

  const filtered = args.referrals.filter((r) =>
    withinAdminTimeframe(r.created_at, timeframe),
  );

  // KPIs + breakdown
  const breakdown: Record<string, number> = {};
  let hired = 0;
  let eligible = 0;
  let markedExt = 0;
  let open = 0;
  for (const r of filtered) {
    breakdown[r.status] = (breakdown[r.status] ?? 0) + 1;
    if (r.status === 'hired') hired += 1;
    if (r.status === 'eligible_for_bonus') eligible += 1;
    if (r.status === 'marked_paid_externally') markedExt += 1;
    if (!TERMINAL.has(r.status)) open += 1;
  }
  const total = filtered.length;
  const kpis: AdminReferralKpis = {
    total,
    open,
    hired,
    eligible,
    markedPaidExternally: markedExt,
    hireRate: total > 0 ? (hired / total) * 100 : 0,
  };

  const statusBreakdown = (Object.keys(REFERRAL_STATUS_LABELS) as ReferralStatus[])
    .map((s) => ({ status: s, label: REFERRAL_STATUS_LABELS[s], count: breakdown[s] ?? 0 }))
    .filter((s) => s.count > 0);

  // Group by recruiter
  const recruiterMap = new Map<string, RecruiterPerformance & { _opps: Set<string> }>();
  for (const r of filtered) {
    const rec = recruiterById.get(r.recruiter_id);
    const company =
      rec?.company_name?.trim() || rec?.recruiter_name?.trim() || 'Company unavailable';
    const email = rec?.recruiter_email?.trim() || null;
    const lastRaw = r.last_status_at ?? r.created_at ?? null;
    const lastT = safeTime(lastRaw);
    let row = recruiterMap.get(r.recruiter_id);
    if (!row) {
      row = {
        recruiter_id: r.recruiter_id,
        company_name: company,
        recruiter_email: email,
        total: 0,
        hired: 0,
        eligible: 0,
        marked_paid_externally: 0,
        closed_not_hired: 0,
        hire_rate: 0,
        last_referral_at: null,
        opportunity_count: 0,
        _opps: new Set(),
      };
      recruiterMap.set(r.recruiter_id, row);
    }
    row.total += 1;
    if (r.status === 'hired') row.hired += 1;
    if (r.status === 'eligible_for_bonus') row.eligible += 1;
    if (r.status === 'marked_paid_externally') row.marked_paid_externally += 1;
    if (r.status === 'closed_not_hired') row.closed_not_hired += 1;
    row._opps.add(r.opportunity_id);
    const prevT = safeTime(row.last_referral_at);
    if (lastT !== null && (prevT === null || lastT > prevT)) {
      row.last_referral_at = lastRaw;
    }
  }
  const recruiterPerformance: RecruiterPerformance[] = Array.from(recruiterMap.values())
    .map(({ _opps, ...row }) => ({
      ...row,
      opportunity_count: _opps.size,
      hire_rate: row.total > 0 ? (row.hired / row.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Group by driver
  const driverMap = new Map<string, DriverPerformance>();
  for (const r of filtered) {
    const id = r.referring_driver_id;
    const lastRaw = r.last_status_at ?? r.created_at ?? null;
    const lastT = safeTime(lastRaw);
    let row = driverMap.get(id);
    if (!row) {
      row = {
        referring_driver_id: id,
        display: driverDisplay(id),
        total: 0,
        hired: 0,
        eligible: 0,
        marked_paid_externally: 0,
        last_referral_at: null,
      };
      driverMap.set(id, row);
    }
    row.total += 1;
    if (r.status === 'hired') row.hired += 1;
    if (r.status === 'eligible_for_bonus') row.eligible += 1;
    if (r.status === 'marked_paid_externally') row.marked_paid_externally += 1;
    const prevT = safeTime(row.last_referral_at);
    if (lastT !== null && (prevT === null || lastT > prevT)) {
      row.last_referral_at = lastRaw;
    }
  }
  const driverPerformance = Array.from(driverMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // Group by opportunity
  const oppMap = new Map<string, OpportunityPerformance>();
  for (const r of filtered) {
    const opp = oppById.get(r.opportunity_id);
    const rec = recruiterById.get(opp?.recruiter_id ?? r.recruiter_id);
    const title = opp?.title?.trim() || 'Untitled opportunity';
    const company =
      rec?.company_name?.trim() || rec?.recruiter_name?.trim() || 'Company unavailable';
    const lastRaw = r.last_status_at ?? r.created_at ?? null;
    const lastT = safeTime(lastRaw);
    let row = oppMap.get(r.opportunity_id);
    if (!row) {
      row = {
        opportunity_id: r.opportunity_id,
        title,
        company_name: company,
        total: 0,
        hired: 0,
        eligible: 0,
        marked_paid_externally: 0,
        hire_rate: 0,
        last_referral_at: null,
      };
      oppMap.set(r.opportunity_id, row);
    }
    row.total += 1;
    if (r.status === 'hired') row.hired += 1;
    if (r.status === 'eligible_for_bonus') row.eligible += 1;
    if (r.status === 'marked_paid_externally') row.marked_paid_externally += 1;
    const prevT = safeTime(row.last_referral_at);
    if (lastT !== null && (prevT === null || lastT > prevT)) {
      row.last_referral_at = lastRaw;
    }
  }
  const opportunityPerformance = Array.from(oppMap.values())
    .map((o) => ({ ...o, hire_rate: o.total > 0 ? (o.hired / o.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  // Recent activity (last 25)
  const recent: RecentActivityItem[] = filtered
    .map((r) => {
      const opp = oppById.get(r.opportunity_id);
      const rec = recruiterById.get(r.recruiter_id);
      const lastRaw = r.last_status_at ?? r.created_at ?? null;
      const t = safeTime(lastRaw);
      return {
        id: r.id,
        status: r.status,
        referred_summary: referredSummary(r),
        referrer_display: driverDisplay(r.referring_driver_id),
        opportunity_title: opp?.title?.trim() || 'Untitled opportunity',
        company_name:
          rec?.company_name?.trim() || rec?.recruiter_name?.trim() || 'Company unavailable',
        date_label: safeDateLabel(lastRaw),
        sort_time: t ?? 0,
      };
    })
    .sort((a, b) => b.sort_time - a.sort_time)
    .slice(0, 25);

  // Watchlist
  const watchlist: WatchlistItem[] = [];
  for (const rp of recruiterPerformance) {
    if (rp.closed_not_hired >= 5) {
      watchlist.push({
        kind: 'high_closed',
        label: 'High closed count',
        detail: `${rp.closed_not_hired} referrals closed, not hired`,
        target: rp.company_name,
      });
    }
    if (rp.marked_paid_externally >= 5) {
      watchlist.push({
        kind: 'high_marked_external',
        label: 'High externally marked count',
        detail: `${rp.marked_paid_externally} referrals marked paid externally`,
        target: rp.company_name,
      });
    }
    const settingsRow = settingsByRecruiter.get(rp.recruiter_id);
    const hasTerms =
      !!settingsRow &&
      (settingsRow.referral_bonus_enabled === true ||
        (typeof settingsRow.bonus_amount === 'number' && settingsRow.bonus_amount > 0) ||
        !!settingsRow.bonus_terms?.trim());
    if (!hasTerms) {
      watchlist.push({
        kind: 'missing_terms',
        label: 'Missing terms',
        detail: 'Referral terms not listed for this recruiter',
        target: rp.company_name,
      });
    }
  }

  // No-recent-movement per recruiter: 3+ referrals all still referral_sent
  const sentByRecruiter = new Map<string, number>();
  const totalByRecruiter = new Map<string, number>();
  for (const r of filtered) {
    totalByRecruiter.set(r.recruiter_id, (totalByRecruiter.get(r.recruiter_id) ?? 0) + 1);
    if (r.status === 'referral_sent') {
      sentByRecruiter.set(r.recruiter_id, (sentByRecruiter.get(r.recruiter_id) ?? 0) + 1);
    }
  }
  for (const [recId, sentCount] of sentByRecruiter) {
    const t = totalByRecruiter.get(recId) ?? 0;
    if (sentCount >= 3 && sentCount === t) {
      const rec = recruiterById.get(recId);
      watchlist.push({
        kind: 'no_movement',
        label: 'No recent movement',
        detail: `${sentCount} referrals still at "Referral sent"`,
        target:
          rec?.company_name?.trim() || rec?.recruiter_name?.trim() || 'Company unavailable',
      });
    }
  }

  // Stale referrals (>30d, not terminal)
  for (const r of filtered) {
    if (TERMINAL.has(r.status)) continue;
    const t = safeTime(r.last_status_at ?? r.created_at);
    if (t === null) continue;
    const ageDays = (now - t) / 86400_000;
    if (ageDays > 30) {
      const opp = oppById.get(r.opportunity_id);
      const rec = recruiterById.get(r.recruiter_id);
      watchlist.push({
        kind: 'stale_referral',
        label: 'Stale referral activity',
        detail: `No status change in ${Math.floor(ageDays)} days`,
        target: `${opp?.title?.trim() || 'Untitled opportunity'} · ${
          rec?.company_name?.trim() || 'Company unavailable'
        }`,
      });
    }
  }

  return {
    kpis,
    statusBreakdown,
    recruiterPerformance,
    driverPerformance,
    opportunityPerformance,
    recent,
    watchlist,
  };
}
