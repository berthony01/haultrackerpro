import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileSignature, Inbox, RefreshCw, ArrowRight, ShieldCheck, MessageSquareWarning, ThumbsUp, ThumbsDown, PenLine, Search } from 'lucide-react';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import {
  useContractsPipeline,
  matchesDriverFilter,
  type DriverContractsFilter,
} from '@/hooks/contracts/useContractsPipeline';
import { getReadinessInfo } from '@/hooks/contracts/useContractReadinessMap';
import { ContractAttachment } from '@/components/contracts/ContractAttachment';

interface Props {
  /** Called when the driver wants to jump to the related application list. */
  onOpenApplications?: () => void;
}

const TABS: { id: DriverContractsFilter; label: string }[] = [
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'changes_requested', label: 'Changes Requested' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'signed', label: 'Signed' },
  { id: 'all', label: 'All' },
];

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

export function DriverContractsView({ onOpenApplications }: Props) {
  const { driverApplications, isLoadingDriver, isErrorDriver, refetchDriver } = useOpportunityApplications();
  const [filter, setFilter] = useState<DriverContractsFilter>('needs_review');
  const [search, setSearch] = useState('');

  const apps = driverApplications as any[];
  const appIds = useMemo(() => apps.map((a) => a.id), [apps]);
  const { pipeline, isLoading: pipelineLoading, refetch: refetchPipeline } = useContractsPipeline(appIds);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps
      .map((a) => ({ app: a, pipeline: pipeline.get(a.id) }))
      .filter((r) => !!r.pipeline)
      .filter((r) => {
        if (filter === 'all') return !!r.pipeline!.status; // only show rows that actually have contracts
        return matchesDriverFilter(r.pipeline!, filter);
      })
      .filter((r) => {
        if (!q) return true;
        const opp = r.app.opportunities;
        const hay = [opp?.title, opp?.company_name].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
  }, [apps, pipeline, filter, search]);

  const totalWithContracts = useMemo(() => {
    return apps.filter((a) => pipeline.get(a.id)?.status).length;
  }, [apps, pipeline]);

  const loading = isLoadingDriver || pipelineLoading;

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
              Review, approve, request changes, or sign contracts recruiters send you.
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
            placeholder="Search by opportunity or company"
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

      {/* Body */}
      {isErrorDriver ? (
        <EmptyState
          title="Unable to load contracts"
          body="Something went wrong while loading your contracts."
          action={
            <Button variant="outline" onClick={() => { refetchDriver(); refetchPipeline(); }}>
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
      ) : totalWithContracts === 0 ? (
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
            const r = readinessFromStatus(p!.status, !!p!.currentVersionId);
            return (
              <Card key={app.id} className="p-5 border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-foreground truncate">
                      {opp?.title || 'Opportunity'}
                    </h3>
                    {opp?.company_name && (
                      <p className="text-xs text-muted-foreground">{opp.company_name}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-muted text-foreground border-border capitalize">
                      {(app.status || 'new').replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="outline" className={r.badgeClass}>
                      {r.label}
                    </Badge>
                    {p!.hasDriverSignature && (
                      <Badge variant="outline" className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
                        <PenLine className="h-3 w-3" /> Signed
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground mb-3">
                  Last updated {fmtDate(p!.updatedAt)}
                </p>

                <div className="mb-3">
                  <ContractAttachment applicationId={app.id} role="driver" />
                </div>

                {onOpenApplications && (
                  <Button variant="outline" size="sm" onClick={onOpenApplications}>
                    Open My Requests <ArrowRight className="h-4 w-4" />
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
          <h3 className="text-base font-bold text-foreground mb-1">No contracts yet</h3>
          <p className="text-sm text-muted-foreground mb-3">
            When a recruiter sends you a contract for one of your applications, it will appear here.
            You can review the AI-flagged risks and then:
          </p>
          <ul className="text-sm text-muted-foreground space-y-1 mb-4">
            <li className="flex items-center gap-2"><ThumbsUp className="h-4 w-4 text-green-400" /> Approve the contract</li>
            <li className="flex items-center gap-2"><ThumbsDown className="h-4 w-4 text-red-400" /> Reject the contract</li>
            <li className="flex items-center gap-2"><MessageSquareWarning className="h-4 w-4 text-amber-400" /> Request changes</li>
            <li className="flex items-center gap-2"><PenLine className="h-4 w-4 text-primary" /> Sign once approved</li>
          </ul>
          {onOpenApplications && (
            <Button variant="outline" size="sm" onClick={onOpenApplications}>
              View My Requests <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
