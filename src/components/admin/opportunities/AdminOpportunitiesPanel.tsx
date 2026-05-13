import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  CheckCircle2, XCircle, Flag, Trash2, Eye, RefreshCw, Briefcase,
  ShieldAlert, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useAdminOpportunities,
  type AdminOpportunity,
  type ReviewFilter,
} from '@/hooks/admin/useAdminOpportunities';
import {
  calculateOpportunityFinancials,
  profitScoreLabel,
} from '@/lib/opportunities/opportunityProfit';

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'removed', label: 'Removed' },
  { value: 'all', label: 'All' },
];

export function AdminOpportunitiesPanel() {
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [detail, setDetail] = useState<AdminOpportunity | null>(null);
  const { opportunities, isLoading, refetch, approve, reject, flag, remove } =
    useAdminOpportunities(filter);

  const busy =
    approve.isPending || reject.isPending || flag.isPending || remove.isPending;

  const run = (
    label: string,
    id: string,
    fn: typeof approve,
  ) => {
    if (!confirm(`${label} this opportunity?`)) return;
    fn.mutate(id, {
      onSuccess: () => toast.success(`Opportunity ${label.toLowerCase()}`),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? 'default' : 'outline'}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : opportunities.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-border/60">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Briefcase className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            No opportunities in this view.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => (
            <Row
              key={o.id}
              o={o}
              busy={busy}
              onApprove={() => run('Approve', o.id, approve)}
              onReject={() => run('Reject', o.id, reject)}
              onFlag={() => run('Flag', o.id, flag)}
              onRemove={() => run('Remove', o.id, remove)}
              onView={() => setDetail(o)}
            />
          ))}
        </div>
      )}

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {detail && <DetailDrawer o={detail} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({
  o, onApprove, onReject, onFlag, onRemove, onView, busy,
}: {
  o: AdminOpportunity;
  onApprove: () => void;
  onReject: () => void;
  onFlag: () => void;
  onRemove: () => void;
  onView: () => void;
  busy: boolean;
}) {
  const f = useMemo(() => calculateOpportunityFinancials(o), [o]);
  const score = profitScoreLabel(f.profitScore);

  const reviewVariant: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
    approved: 'default',
    pending: 'outline',
    rejected: 'destructive',
    flagged: 'secondary',
  };
  const statusVariant: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
    active: 'default',
    draft: 'outline',
    paused: 'secondary',
    closed: 'destructive',
    removed: 'destructive',
  };

  return (
    <Card className="p-4 border-border/60 bg-card/60">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-foreground truncate">{o.title}</h3>
            <Badge variant={statusVariant[o.status] ?? 'outline'} className="capitalize">
              {o.status}
            </Badge>
            <Badge
              variant={reviewVariant[o.admin_review_status] ?? 'outline'}
              className="capitalize"
            >
              Review: {o.admin_review_status}
            </Badge>
            <Badge variant="outline" className="capitalize">{score.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {o.company_name}
            {o.recruiter && (
              <>
                {' · '}
                <span className="capitalize">
                  Recruiter: {o.recruiter.recruiter_name} ({o.recruiter.verification_status})
                </span>
              </>
            )}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Est. Gross" value={f.estimatedGross != null ? `$${Math.round(f.estimatedGross).toLocaleString()}/wk` : '—'} />
            <Stat label="Est. Net" value={f.estimatedNet != null ? `$${Math.round(f.estimatedNet).toLocaleString()}/wk` : '—'} />
            <Stat label="Eff RPM" value={f.effectiveRpm != null ? `$${f.effectiveRpm.toFixed(2)}` : '—'} />
            <Stat label="Score" value={String(f.profitScore)} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Created {new Date(o.created_at).toLocaleDateString()}
            {o.published_at && ` · Published ${new Date(o.published_at).toLocaleDateString()}`}
            {o.deadhead_paid === false && ' · Unpaid deadhead'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:w-40">
          <Button size="sm" variant="outline" onClick={onView}>
            <Eye className="h-4 w-4" /> Details
          </Button>
          <Button size="sm" onClick={onApprove} disabled={busy}>
            <CheckCircle2 className="h-4 w-4" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
            <XCircle className="h-4 w-4" /> Reject
          </Button>
          <Button size="sm" variant="outline" onClick={onFlag} disabled={busy}>
            <Flag className="h-4 w-4" /> Flag
          </Button>
          <Button size="sm" variant="destructive" onClick={onRemove} disabled={busy}>
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-foreground font-bold">{value}</div>
    </div>
  );
}

function DetailDrawer({ o }: { o: AdminOpportunity }) {
  const f = calculateOpportunityFinancials(o);
  const warnings: string[] = [];
  if (f.hasUnpaidDeadhead) warnings.push('Deadhead is unpaid');
  if (f.hasUnknownDeadheadPay) warnings.push('Deadhead pay not disclosed');
  if (f.hasLeaseRisk) warnings.push('Lease payment present');
  if (f.hasHighDeductionRisk) warnings.push('High known deductions');
  if (f.missingPayData) warnings.push('Missing key pay data');

  return (
    <>
      <SheetHeader>
        <SheetTitle>{o.title}</SheetTitle>
        <SheetDescription>{o.company_name}</SheetDescription>
      </SheetHeader>

      <div className="space-y-4 mt-4 text-sm">
        <Section title="Recruiter">
          {o.recruiter ? (
            <div className="space-y-1 text-xs">
              <div><b>{o.recruiter.recruiter_name}</b> — {o.recruiter.recruiter_email ?? '—'}</div>
              <div className="text-muted-foreground">
                Verification: {o.recruiter.verification_status} · Status: {o.recruiter.status}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No recruiter linked.</p>
          )}
        </Section>

        <Section title="Profit Intelligence">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <KV k="Estimated Gross" v={f.estimatedGross != null ? `$${Math.round(f.estimatedGross).toLocaleString()}/wk` : '—'} />
            <KV k="Estimated Net" v={f.estimatedNet != null ? `$${Math.round(f.estimatedNet).toLocaleString()}/wk` : '—'} />
            <KV k="Effective RPM" v={f.effectiveRpm != null ? `$${f.effectiveRpm.toFixed(2)}` : '—'} />
            <KV k="Net RPM" v={f.netRpm != null ? `$${f.netRpm.toFixed(2)}` : '—'} />
            <KV k="Deadhead %" v={f.deadheadPercentage != null ? `${f.deadheadPercentage.toFixed(1)}%` : '—'} />
            <KV k="Profit Score" v={`${f.profitScore} / 100`} />
          </div>
        </Section>

        {warnings.length > 0 && (
          <Section title="Warnings">
            <ul className="space-y-1 text-xs">
              {warnings.map((w) => (
                <li key={w} className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" /> {w}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Pay & Route">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <KV k="Pay model" v={o.pay_model ?? '—'} />
            <KV k="CPM" v={o.cpm != null ? `$${o.cpm}` : '—'} />
            <KV k="Flat weekly" v={o.flat_weekly_pay != null ? `$${o.flat_weekly_pay}` : '—'} />
            <KV k="Driver type" v={o.driver_type ?? '—'} />
            <KV k="Route type" v={o.route_type ?? '—'} />
            <KV k="Trailer" v={o.trailer_type ?? '—'} />
            <KV k="Home time" v={o.home_time ?? '—'} />
            <KV k="Sign-on bonus" v={o.sign_on_bonus != null ? `$${o.sign_on_bonus}` : '—'} />
          </div>
        </Section>

        <Section title="Status">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <KV k="Status" v={o.status} />
            <KV k="Review" v={o.admin_review_status} />
            <KV k="Created" v={new Date(o.created_at).toLocaleString()} />
            <KV k="Published" v={o.published_at ? new Date(o.published_at).toLocaleString() : '—'} />
            <KV k="Transparency" v={o.transparency_confirmed ? 'Confirmed' : 'No'} />
            <KV k="Featured" v={o.featured ? 'Yes' : 'No'} />
          </div>
        </Section>

        {o.description && (
          <Section title="Description">
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{o.description}</p>
          </Section>
        )}

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-2 border-t border-border/40">
          <ShieldAlert className="h-3.5 w-3.5" /> Admin moderation only — driver-facing pages only show approved + active opportunities.
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-foreground font-medium truncate">{v}</div>
    </div>
  );
}
