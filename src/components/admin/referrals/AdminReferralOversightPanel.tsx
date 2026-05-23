import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Info, Inbox, AlertTriangle, BarChart3, Share2 } from 'lucide-react';
import {
  useAdminReferralOversight,
  type AdminTimeframe,
} from '@/hooks/admin/useAdminReferralOversight';
import { referralStatusLabel } from '@/lib/opportunities/referralStatus';

const TIMEFRAMES: { value: AdminTimeframe; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'mtd', label: 'This month' },
];

const DISCLAIMER =
  'Referral oversight is for platform monitoring only. Referral bonuses, if offered, are paid externally by recruiters. Haul Tracker Pro does not process, verify, guarantee, or enforce referral payments.';

export function AdminReferralOversightPanel() {
  const [timeframe, setTimeframe] = useState<AdminTimeframe>('all');
  const { aggregate, isLoading, isError } = useAdminReferralOversight(timeframe);

  return (
    <div className="space-y-4">
      <Card className="p-4 border-border/60">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
            <Share2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-foreground">Referral Oversight</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Platform-wide driver-to-driver referral activity.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
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
        <p className="text-[11px] text-muted-foreground mt-2">
          Timeframes are based on referral creation date.
        </p>
        <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground mt-3">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>{DISCLAIMER}</span>
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError || !aggregate ? (
        <Card className="p-6 border-border/60">
          <p className="text-sm text-muted-foreground">Unable to load referral oversight.</p>
        </Card>
      ) : aggregate.kpis.total === 0 ? (
        <Card className="p-8 border-border/60 text-center">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            No referral activity yet. Platform-wide referral performance will appear here once
            drivers start referring candidates.
          </p>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Kpi label="Total referrals" value={aggregate.kpis.total} />
            <Kpi label="Open referrals" value={aggregate.kpis.open} />
            <Kpi label="Hired" value={aggregate.kpis.hired} />
            <Kpi label="Eligible based on recruiter terms" value={aggregate.kpis.eligible} />
            <Kpi label="Marked paid externally" value={aggregate.kpis.markedPaidExternally} />
            <Kpi label="Referral-to-hire rate" value={`${aggregate.kpis.hireRate.toFixed(0)}%`} />
          </div>

          {/* Status breakdown */}
          <Card className="p-4 border-border/60">
            <SectionTitle icon={<BarChart3 className="h-4 w-4" />} title="Status breakdown" />
            <div className="flex flex-wrap gap-2">
              {aggregate.statusBreakdown.map((s) => (
                <Badge key={s.status} variant="outline" className="border-primary/40 text-foreground">
                  {s.label}: <span className="ml-1 font-bold">{s.count}</span>
                </Badge>
              ))}
            </div>
          </Card>

          {/* Watchlist */}
          {aggregate.watchlist.length > 0 && (
            <Card className="p-4 border-border/60">
              <SectionTitle
                icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
                title="Needs review"
              />
              <ul className="space-y-2">
                {aggregate.watchlist.map((w, i) => (
                  <li
                    key={`${w.kind}-${i}`}
                    className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5 text-xs"
                  >
                    <Badge variant="outline" className="border-amber-400/40 text-amber-300 whitespace-nowrap">
                      {w.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground font-semibold truncate">{w.target}</p>
                      <p className="text-muted-foreground">{w.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Recruiter performance */}
          <Card className="p-4 border-border/60">
            <SectionTitle title="Recruiter referral performance" />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recruiter / Company</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Hired</TableHead>
                    <TableHead className="text-right">Eligible</TableHead>
                    <TableHead className="text-right">Marked paid externally</TableHead>
                    <TableHead className="text-right">Closed, not hired</TableHead>
                    <TableHead className="text-right">Hire rate</TableHead>
                    <TableHead className="text-right">Opportunities</TableHead>
                    <TableHead>Last referral</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregate.recruiterPerformance.map((r) => (
                    <TableRow key={r.recruiter_id}>
                      <TableCell>
                        <div className="font-semibold text-foreground">{r.company_name}</div>
                        {r.recruiter_email && (
                          <div className="text-[11px] text-muted-foreground">{r.recruiter_email}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.total}</TableCell>
                      <TableCell className="text-right">{r.hired}</TableCell>
                      <TableCell className="text-right">{r.eligible}</TableCell>
                      <TableCell className="text-right">{r.marked_paid_externally}</TableCell>
                      <TableCell className="text-right">{r.closed_not_hired}</TableCell>
                      <TableCell className="text-right">{r.hire_rate.toFixed(0)}%</TableCell>
                      <TableCell className="text-right">{r.opportunity_count}</TableCell>
                      <TableCell>{dateLabel(r.last_referral_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Top referring drivers */}
          {aggregate.driverPerformance.length > 0 && (
            <Card className="p-4 border-border/60">
              <SectionTitle title="Top referring drivers" />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Hired</TableHead>
                      <TableHead className="text-right">Eligible</TableHead>
                      <TableHead className="text-right">Marked paid externally</TableHead>
                      <TableHead>Last referral</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregate.driverPerformance.map((d) => (
                      <TableRow key={d.referring_driver_id}>
                        <TableCell className="font-semibold text-foreground">{d.display}</TableCell>
                        <TableCell className="text-right">{d.total}</TableCell>
                        <TableCell className="text-right">{d.hired}</TableCell>
                        <TableCell className="text-right">{d.eligible}</TableCell>
                        <TableCell className="text-right">{d.marked_paid_externally}</TableCell>
                        <TableCell>{dateLabel(d.last_referral_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {/* Opportunity performance */}
          {aggregate.opportunityPerformance.length > 0 && (
            <Card className="p-4 border-border/60">
              <SectionTitle title="Opportunity referral performance" />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Hired</TableHead>
                      <TableHead className="text-right">Eligible</TableHead>
                      <TableHead className="text-right">Marked paid externally</TableHead>
                      <TableHead className="text-right">Hire rate</TableHead>
                      <TableHead>Last referral</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregate.opportunityPerformance.map((o) => (
                      <TableRow key={o.opportunity_id}>
                        <TableCell className="font-semibold text-foreground">{o.title}</TableCell>
                        <TableCell className="text-muted-foreground">{o.company_name}</TableCell>
                        <TableCell className="text-right">{o.total}</TableCell>
                        <TableCell className="text-right">{o.hired}</TableCell>
                        <TableCell className="text-right">{o.eligible}</TableCell>
                        <TableCell className="text-right">{o.marked_paid_externally}</TableCell>
                        <TableCell className="text-right">{o.hire_rate.toFixed(0)}%</TableCell>
                        <TableCell>{dateLabel(o.last_referral_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {/* Recent activity */}
          <Card className="p-4 border-border/60">
            <SectionTitle title="Recent referral activity" />
            <ol className="space-y-2 border-l border-border/60 pl-4">
              {aggregate.recent.map((r) => (
                <li key={r.id} className="relative">
                  <span className="absolute -left-[1.05rem] top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{r.referred_summary}</p>
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      {referralStatusLabel(r.status)}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Referred by {r.referrer_display} · {r.opportunity_title} · {r.company_name} ·{' '}
                    {r.date_label}
                  </p>
                  {r.status === 'marked_paid_externally' && (
                    <p className="text-[11px] text-muted-foreground italic mt-0.5">
                      The recruiter marked this referral as paid externally. Haul Tracker Pro does
                      not process or verify payment.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
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

function SectionTitle({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
        {title}
      </p>
    </div>
  );
}

function dateLabel(iso: string | null): string {
  if (!iso) return 'Date unavailable';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Date unavailable';
  return new Date(t).toLocaleDateString();
}
