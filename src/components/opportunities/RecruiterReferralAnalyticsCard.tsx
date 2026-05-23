import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { BarChart3, Info, Inbox } from 'lucide-react';
import {
  useRecruiterReferralAnalytics,
  type Timeframe,
} from '@/hooks/opportunities/useRecruiterReferralAnalytics';
import {
  REFERRAL_STATUS_LABELS,
  referralStatusLabel,
  type ReferralStatus,
} from '@/lib/opportunities/referralStatus';

interface Props {
  recruiterId: string;
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'mtd', label: 'This month' },
];

const ANALYTICS_DISCLAIMER =
  'Referral analytics are for tracking progress only. Referral bonuses, if offered, are paid externally by the recruiter. Haul Tracker Pro does not process, verify, or guarantee payments.';

export function RecruiterReferralAnalyticsCard({ recruiterId }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const { analytics, isLoading, isError } = useRecruiterReferralAnalytics(recruiterId, timeframe);

  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
          <BarChart3 className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-foreground">Referral Analytics</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Performance of driver referrals tied to your opportunities.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TIMEFRAMES.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={timeframe === t.value ? 'default' : 'outline'}
            onClick={() => setTimeframe(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2 mb-3">
        Timeframes are based on referral creation date.
      </p>

      <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground mb-4">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <span>{ANALYTICS_DISCLAIMER}</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Unable to load referral analytics.</p>
      ) : analytics.total === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-5">
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <Kpi label="Total referrals" value={analytics.total} />
            <Kpi label="Hired" value={analytics.hired} />
            <Kpi label="Eligible based on recruiter terms" value={analytics.eligible} />
            <Kpi label="Marked paid externally" value={analytics.markedPaidExternally} />
            <Kpi label="Referral-to-hire rate" value={`${analytics.hireRate.toFixed(0)}%`} />
          </div>

          {/* Status breakdown */}
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
              Status breakdown
            </p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(REFERRAL_STATUS_LABELS) as ReferralStatus[]).map((s) => {
                const count = analytics.statusBreakdown[s] ?? 0;
                if (count === 0) return null;
                return (
                  <Badge key={s} variant="outline" className="border-primary/40 text-foreground">
                    {REFERRAL_STATUS_LABELS[s]}: <span className="ml-1 font-bold">{count}</span>
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Opportunity performance */}
          {analytics.opportunityPerformance.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
                Opportunity performance
              </p>
              <div className="space-y-2">
                {analytics.opportunityPerformance.map((o) => (
                  <div
                    key={o.opportunity_id}
                    className="rounded-lg border border-border/60 bg-card/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{o.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {o.company_name ?? 'Company unavailable'}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-primary/40 text-primary whitespace-nowrap">
                        {o.hire_rate.toFixed(0)}% hire rate
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                      <Mini label="Total" value={o.total} />
                      <Mini label="Hired" value={o.hired} />
                      <Mini label="Eligible" value={o.eligible} />
                      <Mini label="Marked paid externally" value={o.marked_paid_externally} />
                      <Mini label="Last referral" value={safeDateLabel(o.last_referral_at)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {analytics.recent.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
                Recent activity
              </p>
              <ol className="space-y-2 border-l border-border/60 pl-4">
                {analytics.recent.map((r) => {
                  const contact =
                    (r.referred_driver_name?.trim() ||
                      r.referred_driver_email?.trim() ||
                      r.referred_driver_phone?.trim()) ??
                    'Referred driver';
                  const referrer = r.referring_driver_id
                    ? `Driver · #${r.referring_driver_id.slice(0, 8)}`
                    : 'Driver';
                  const oppTitle = r.opportunities?.title?.trim() || 'Untitled opportunity';
                  const oppCompany = r.opportunities?.company_name?.trim() || null;
                  const dateLabel = safeDateLabel(r.last_status_at ?? r.created_at);
                  return (
                    <li key={r.id} className="relative">
                      <span className="absolute -left-[1.05rem] top-1.5 h-2 w-2 rounded-full bg-primary" />
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{contact}</p>
                        <Badge variant="outline" className="border-primary/40 text-primary">
                          {referralStatusLabel(r.status)}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Referred by {referrer} · {oppTitle}
                        {oppCompany ? ` · ${oppCompany}` : ''} · {dateLabel}
                      </p>
                      {r.status === 'marked_paid_externally' && (
                        <p className="text-[11px] text-muted-foreground italic mt-0.5">
                          The recruiter marked this referral as paid externally. Haul Tracker Pro
                          does not process or verify payment.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">
        {label}
      </div>
      <div className="text-xl font-black text-foreground mt-1 truncate">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-foreground font-bold truncate">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8">
      <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        No referral analytics yet. When drivers refer candidates to your opportunities,
        performance will appear here.
      </p>
    </div>
  );
}
