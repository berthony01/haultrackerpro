/**
 * Phase RC-1G — recruiter STAFF Contracts workspace.
 *
 * Isolated staff surface. Modeled visually on the owner contracts workspace
 * but deliberately imports NONE of the owner surfaces: no owner contracts view,
 * no recruiter profile hook, no recruiter billing hook, no billing/upgrade UI,
 * no Agency UI, no reports, no settlements, no referrals, and no owner
 * application hooks. All list data comes from the RC-1G safe pipeline RPC.

 *
 * `contracts_view` gates the whole surface (fail closed). `contracts_manage`
 * independently gates the recruiter mutation controls inside ContractAttachment.
 * Client booleans are UX only — PostgreSQL and the contract Edge Functions are
 * authoritative.
 */
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileSignature,
  Inbox,
  RefreshCw,
  AlertTriangle,
  Search,
  Lock,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';
import {
  matchesRecruiterFilter,
  type RecruiterContractsFilter,
  type ContractsPipelineRow,
} from '@/hooks/contracts/useContractsPipeline';
import { getReadinessInfo } from '@/hooks/contracts/useContractReadinessMap';
import { ContractAttachment } from '@/components/contracts/ContractAttachment';
import { useRecruiterStaffContracts } from '@/hooks/contracts/useRecruiterStaffContracts';

interface Props {
  recruiterId: string;
  companyName?: string | null;
  canViewContracts: boolean;
  canManageContracts: boolean;
  onBack?: () => void;
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
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function readinessFromStatus(status: string | null, hasVersion: boolean) {
  if (!status) return getReadinessInfo('no_contract');
  if (!hasVersion) return getReadinessInfo('awaiting_upload');
  if (status === 'uploaded' || status === 'parsing' || status === 'parsed')
    return getReadinessInfo('needs_ai_review');
  if (status === 'ai_reviewed' || status === 'driver_reviewing')
    return getReadinessInfo('awaiting_driver_decision');
  if (status === 'changes_requested') return getReadinessInfo('changes_requested');
  if (status === 'rejected') return getReadinessInfo('driver_rejected');
  if (status === 'approved' || status === 'signed') return getReadinessInfo('driver_approved');
  if (status === 'expired') return getReadinessInfo('contract_expired');
  if (status === 'archived') return getReadinessInfo('contract_archived');
  return getReadinessInfo('no_contract');
}

export function RecruiterStaffContractsView({
  recruiterId,
  companyName,
  canViewContracts,
  canManageContracts,
  onBack,
}: Props) {
  const canView = canViewContracts === true;
  const canManage = canManageContracts === true;

  const { rows: pipelineRows, isLoading, isError, refetch } = useRecruiterStaffContracts({
    recruiterId,
    canViewContracts: canView,
  });

  const [filter, setFilter] = useState<RecruiterContractsFilter>('awaiting_upload');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    if (!canView) return [];
    const q = search.trim().toLowerCase();
    return pipelineRows
      .map((r) => ({
        row: r,
        pipeline: {
          applicationId: r.applicationId,
          contractId: r.contractId,
          status: r.contractStatus,
          currentVersionId: r.currentVersionId,
          riskTier: r.riskTier,
          updatedAt: r.updatedAt,
          hasDriverSignature: r.hasDriverSignature,
        } satisfies ContractsPipelineRow,
      }))
      .filter((r) => matchesRecruiterFilter(r.pipeline, filter, r.row.applicationStatus))
      .filter((r) => {
        if (!q) return true;
        const hay = [
          r.row.opportunityTitle,
          r.row.opportunityCompanyName,
          r.row.driverFullName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
  }, [canView, pipelineRows, filter, search]);

  // Fail closed: no contracts_view => no contract surface at all.
  if (!canView) {
    return (
      <Card
        className="p-6 border-border/60 bg-card"
        data-testid="recruiter-staff-contracts-forbidden"
        role="alert"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-muted p-3 shrink-0">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">Contracts unavailable</h3>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have contract access in this workspace. Ask the workspace owner if you
              need it.
            </p>
          </div>
        </div>
        {onBack && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" data-testid="recruiter-staff-contracts-view">
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <FileSignature className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Recruiter Workspace
            </p>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1 break-words">
              Contracts
            </h1>
            <p className="text-sm text-muted-foreground break-words">
              {companyName ? `${companyName} · ` : ''}
              {canManage
                ? 'Attach contracts, run AI risk review, and track driver approval before hire.'
                : 'View contract status and driver approval progress for this workspace.'}
            </p>
          </div>
        </div>
      </Card>

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
              type="button"
              onClick={() => setFilter(t.id)}
              className={`min-h-[36px] px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
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

      {isError ? (
        <EmptyState
          title="Unable to load contracts"
          body="We couldn't confirm contract access for this workspace right now. Please refresh and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : pipelineRows.length === 0 ? (
        <EmptyState
          title="No contract activity yet"
          body="When drivers apply to this workspace's opportunities, their contract status appears here."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No contracts match this filter"
          body="Try a different tab or clear your search."
        />
      ) : (
        <div className="space-y-4">
          {rows.map(({ row, pipeline: p }) => {
            const r = readinessFromStatus(p.status, !!p.currentVersionId);
            const tierCls = p.riskTier ? RISK_TIER_CLS[p.riskTier] : null;
            return (
              <Card key={row.applicationId} className="p-5 border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-foreground truncate">
                      {row.driverFullName || 'Applicant'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {row.opportunityTitle || 'Opportunity'}
                      {row.opportunityCompanyName ? ` · ${row.opportunityCompanyName}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="bg-muted text-foreground border-border capitalize"
                    >
                      {(row.applicationStatus || 'new').replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="outline" className={r.badgeClass}>
                      {r.label}
                    </Badge>
                    {tierCls && p.riskTier && (
                      <Badge variant="outline" className={`${tierCls} capitalize gap-1`}>
                        <AlertTriangle className="h-3 w-3" /> {p.riskTier} risk
                      </Badge>
                    )}
                    {p.hasDriverSignature && (
                      <Badge
                        variant="outline"
                        className="bg-green-500/15 text-green-400 border-green-500/30"
                      >
                        Driver signed
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground mb-3">
                  Last updated {fmtDate(p.updatedAt)}
                </p>

                <div className="mb-1">
                  <ContractAttachment
                    applicationId={row.applicationId}
                    role="recruiter"
                    canManageRecruiterContract={canManage}
                  />
                </div>

                {!canManage && (
                  <p className="text-[11px] text-muted-foreground">
                    View only — contract uploads and AI review are not enabled for your access.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {onBack && (
        <Button variant="outline" size="sm" onClick={onBack} className="min-h-[44px]">
          <ArrowLeft className="h-4 w-4" /> Back to workspace
        </Button>
      )}
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="p-8 border-dashed border-border/60 bg-muted/20 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{body}</p>
      {action ?? (
        <p className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-green-400" /> Driver approval is required before
          a hire can be marked.
        </p>
      )}
    </Card>
  );
}
