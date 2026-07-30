import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileSignature, Inbox, RefreshCw, ArrowRight, ShieldCheck, Upload, Sparkles, AlertTriangle, Search, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';
import {
  useContractsPipeline,
  matchesRecruiterFilter,
  type RecruiterContractsFilter,
} from '@/hooks/contracts/useContractsPipeline';
import { getReadinessInfo } from '@/hooks/contracts/useContractReadinessMap';
import { ContractAttachment } from '@/components/contracts/ContractAttachment';

interface Props {
  /** Jump to the recruiter Applications page. */
  onOpenApplications?: () => void;
}

const TABS: { id: RecruiterContractsFilter; label: string }[] = [
  { id: 'awaiting_upload', label: 'Awaiting Upload' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'ai_reviewed', label: 'AI Reviewed' },
  { id: 'needs_driver_review', label: 'Needs Driver Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'changes_requested', label: 'Changes Requested' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'signed', label: 'Signed' },
  { id: 'blocked', label: 'Blocked from Hire' },
  { id: 'all', label: 'All' },
];

const RISK_TIER_CLS: Record<string, string> = {
  low: 'bg-green-500/15 text-green-400 border-green-500/30',
  moderate: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  elevated: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  high: 'bg-red-500/15 text-red-400 border-red-500/30',
  severe: 'bg-red-600/20 text-red-300 border-red-600/40',
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function readinessFromStatus(status: string | null, hasVersion: boolean) {
  if (!status) return getReadinessInfo('no_contract');
  if (!hasVersion) return getReadinessInfo('awaiting_upload');
  if (status === 'uploaded' || status === 'parsing' || status === 'parsed') return getReadinessInfo('needs_ai_review');
  if (status === 'ai_reviewed' || status === 'driver_reviewing') return getReadinessInfo('awaiting_driver_decision');
  if (status === 'changes_requested') return getReadinessInfo('changes_requested');
  if (status === 'rejected') return getReadinessInfo('driver_rejected');
  if (status === 'approved' || status === 'signed') return getReadinessInfo('driver_approved');
  if (status === 'expired') return getReadinessInfo('contract_expired');
  if (status === 'archived') return getReadinessInfo('contract_archived');
  return getReadinessInfo('no_contract');
}

export function RecruiterContractsView({ onOpenApplications }: Props) {
  const { profile, isLoading: profileLoading } = useRecruiterProfile();
  const billing = useRecruiterBilling();
  // Phase 1R-C: effective capability, not a raw recruiter plan comparison.
  const planAllowsContracts = billing.canUseContractWorkflowTools === true;
  const entitlementState = billing.businessEntitlementState ?? 'resolved';
  const entitlementUnavailable =
    entitlementState === 'error' || entitlementState === 'conflict';

  const { recruiterApplications, isLoadingRecruiter, isErrorRecruiter, refetchRecruiter } =
    useOpportunityApplications({ recruiterId: planAllowsContracts ? profile?.id : undefined });
  const [filter, setFilter] = useState<RecruiterContractsFilter>('awaiting_upload');
  const [search, setSearch] = useState('');

  const apps = recruiterApplications as any[];
  const appIds = useMemo(() => apps.map((a) => a.id), [apps]);
  const { pipeline, isLoading: pipelineLoading, refetch: refetchPipeline } = useContractsPipeline(appIds);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps
      .map((a) => ({ app: a, pipeline: pipeline.get(a.id) }))
      .filter((r) => !!r.pipeline)
      .filter((r) => matchesRecruiterFilter(r.pipeline!, filter, r.app.status))
      .filter((r) => {
        if (!q) return true;
        const opp = r.app.opportunities;
        const dp = r.app.driver_profile;
        const hay = [opp?.title, opp?.company_name, dp?.full_name].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
  }, [apps, pipeline, filter, search]);

  const loading = profileLoading || isLoadingRecruiter || pipelineLoading;

  if (!profileLoading && !profile) {
    return (
      <Card className="p-6 border-border/60 bg-primary/5">
        <h3 className="text-base font-bold text-foreground mb-1">Recruiter profile required</h3>
        <p className="text-sm text-muted-foreground">
          Set up your recruiter profile to manage contracts for your opportunities.
        </p>
      </Card>
    );
  }

  if (!billing.isLoading && !planAllowsContracts && entitlementUnavailable) {
    return (
      <Card
        className="p-6 border-border/60 bg-card"
        data-testid="recruiter-contracts-entitlement-unavailable"
        role="alert"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-muted p-3 shrink-0">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">
              Contract Protection unavailable
            </h3>
            <p className="text-sm text-muted-foreground">
              {entitlementState === 'conflict'
                ? 'We found overlapping business subscriptions on this account. Contract Protection is paused until this is resolved. Please contact support.'
                : "We couldn't confirm your plan access right now. Contract Protection is unavailable until this check succeeds. Please refresh and try again."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (!billing.isLoading && !planAllowsContracts) {

    return (
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/10 animate-fade-in">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-base font-bold text-foreground">Contract Protection — Growth &amp; Fleet</h3>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                Upgrade required
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Contract Protection is included with the Growth and Fleet recruiter plans. Upgrade to
              attach contracts to applications, run AI-assisted risk review, and require driver
              approval before marking a hire.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 mb-4">
              <li className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /> Upload contracts to any application</li>
              <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI-assisted risk review &amp; plain-English flags</li>
              <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-green-400" /> Driver approval gate before hire</li>
            </ul>
            <Button
              size="sm"
              disabled={billing.startCheckout.isPending}
              onClick={() =>
                billing.startCheckout.mutate('growth', {
                  onSuccess: () => toast.success('Opening checkout in a new tab…'),
                  onError: (e: Error) => toast.error(e.message),
                })
              }
            >
              Upgrade to Growth <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <FileSignature className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Contracts
            </h1>
            <p className="text-sm text-muted-foreground">
              Attach contracts to applications, run AI risk review, and track driver approval before hire.
            </p>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4 border-border/60 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by driver, opportunity, or company"
            className="w-full h-10 pl-9 pr-3 rounded-md bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
                filter === t.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {isErrorRecruiter ? (
        <EmptyState
          title="Unable to load contracts"
          body="Something went wrong while loading recruiter contracts."
          action={
            <Button variant="outline" onClick={() => { refetchRecruiter(); refetchPipeline(); }}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <EducationalEmptyState onOpenApplications={onOpenApplications} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No contracts match this filter"
          body="Try a different tab or clear your search."
        />
      ) : (
        <div className="space-y-4">
          {rows.map(({ app, pipeline: p }) => {
            const opp = app.opportunities;
            const dp = app.driver_profile;
            const r = readinessFromStatus(p!.status, !!p!.currentVersionId);
            const tierCls = p!.riskTier ? RISK_TIER_CLS[p!.riskTier] : null;
            return (
              <Card key={app.id} className="p-5 border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-foreground truncate">
                      {dp?.full_name || 'Applicant'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {opp?.title || 'Opportunity'}
                      {opp?.company_name ? ` · ${opp.company_name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-muted text-foreground border-border capitalize">
                      {(app.status || 'new').replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="outline" className={r.badgeClass}>
                      {r.label}
                    </Badge>
                    {tierCls && p!.riskTier && (
                      <Badge variant="outline" className={`${tierCls} capitalize gap-1`}>
                        <AlertTriangle className="h-3 w-3" /> {p!.riskTier} risk
                      </Badge>
                    )}
                    {p!.hasDriverSignature && (
                      <Badge variant="outline" className="bg-green-500/15 text-green-400 border-green-500/30">
                        Driver signed
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground mb-3">
                  Last updated {fmtDate(p!.updatedAt)}
                </p>

                <div className="mb-3">
                  <ContractAttachment applicationId={app.id} role="recruiter" />
                </div>

                {onOpenApplications && (
                  <Button variant="outline" size="sm" onClick={onOpenApplications}>
                    Open Applications <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="p-8 border-dashed border-border/60 bg-muted/20 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{body}</p>
      {action}
    </Card>
  );
}

function EducationalEmptyState({ onOpenApplications }: { onOpenApplications?: () => void }) {
  return (
    <Card className="p-6 border-border/60 bg-primary/5">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground mb-1">No contract activity yet</h3>
          <p className="text-sm text-muted-foreground mb-3">
            When drivers apply to your opportunities, attach a contract here. You can:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 mb-4">
            <li className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /> Upload the contract for an applicant</li>
            <li className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Run AI-assisted risk review</li>
            <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-green-400" /> Track driver approval before finalizing the hire</li>
          </ul>
          {onOpenApplications && (
            <Button variant="outline" size="sm" onClick={onOpenApplications}>
              Open Applications <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
