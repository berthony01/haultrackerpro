import { useMemo } from 'react';
import { useRecruiterReferrals, type RecruiterReferral } from './useRecruiterReferrals';
import type { ReferralStatus } from '@/lib/opportunities/referralStatus';

export type Timeframe = 'all' | '30d' | '90d' | 'mtd';

export interface OpportunityPerformance {
  opportunity_id: string;
  title: string;
  company_name: string | null;
  total: number;
  hired: number;
  eligible: number;
  marked_paid_externally: number;
  last_referral_at: string;
  hire_rate: number;
}

export interface ReferralAnalytics {
  total: number;
  hired: number;
  eligible: number;
  markedPaidExternally: number;
  hireRate: number;
  statusBreakdown: Record<ReferralStatus, number>;
  opportunityPerformance: OpportunityPerformance[];
  recent: RecruiterReferral[];
}

function safeTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function withinTimeframe(iso: string | null | undefined, tf: Timeframe): boolean {
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

export function useRecruiterReferralAnalytics(
  recruiterId?: string | null,
  timeframe: Timeframe = 'all',
) {
  const { referrals, isLoading, isError, error, refetch } = useRecruiterReferrals(recruiterId);

  const analytics = useMemo<ReferralAnalytics>(() => {
    const filtered = referrals.filter((r) => withinTimeframe(r.created_at, timeframe));

    const breakdown: Record<string, number> = {};
    for (const r of filtered) {
      breakdown[r.status] = (breakdown[r.status] ?? 0) + 1;
    }

    const total = filtered.length;
    const hired = breakdown['hired'] ?? 0;
    const eligible = breakdown['eligible_for_bonus'] ?? 0;
    const markedPaidExternally = breakdown['marked_paid_externally'] ?? 0;
    const hireRate = total > 0 ? (hired / total) * 100 : 0;

    // Group by opportunity
    const oppMap = new Map<string, OpportunityPerformance>();
    for (const r of filtered) {
      const oid = r.opportunity_id;
      const existing = oppMap.get(oid);
      const title = r.opportunities?.title ?? 'Opportunity';
      const company = r.opportunities?.company_name ?? null;
      if (!existing) {
        oppMap.set(oid, {
          opportunity_id: oid,
          title,
          company_name: company,
          total: 1,
          hired: r.status === 'hired' ? 1 : 0,
          eligible: r.status === 'eligible_for_bonus' ? 1 : 0,
          marked_paid_externally: r.status === 'marked_paid_externally' ? 1 : 0,
          last_referral_at: r.last_status_at ?? r.created_at,
          hire_rate: 0,
        });
      } else {
        existing.total += 1;
        if (r.status === 'hired') existing.hired += 1;
        if (r.status === 'eligible_for_bonus') existing.eligible += 1;
        if (r.status === 'marked_paid_externally') existing.marked_paid_externally += 1;
        const last = r.last_status_at ?? r.created_at;
        if (new Date(last) > new Date(existing.last_referral_at)) {
          existing.last_referral_at = last;
        }
      }
    }
    const opportunityPerformance = Array.from(oppMap.values())
      .map((o) => ({ ...o, hire_rate: o.total > 0 ? (o.hired / o.total) * 100 : 0 }))
      .sort((a, b) => b.total - a.total);

    const recent = [...filtered]
      .sort(
        (a, b) =>
          new Date(b.last_status_at ?? b.created_at).getTime() -
          new Date(a.last_status_at ?? a.created_at).getTime(),
      )
      .slice(0, 8);

    return {
      total,
      hired,
      eligible,
      markedPaidExternally,
      hireRate,
      statusBreakdown: breakdown as Record<ReferralStatus, number>,
      opportunityPerformance,
      recent,
    };
  }, [referrals, timeframe]);

  return { analytics, isLoading, isError, error, refetch };
}
