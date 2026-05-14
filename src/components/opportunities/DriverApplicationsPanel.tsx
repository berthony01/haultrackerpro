import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Inbox, RefreshCw, Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { ContractAttachment } from '@/components/contracts/ContractAttachment';

interface Props {
  onBack: () => void;
  onViewOpportunity?: (opportunityId: string) => void;
}

const STATUS_VARIANT: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-primary/15 text-primary border-primary/30' },
  viewed: { label: 'Viewed', cls: 'bg-muted text-foreground border-border' },
  contacted: { label: 'Contacted', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  interviewing: { label: 'Interviewing', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  hired: { label: 'Hired', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  rejected: { label: 'Rejected', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-muted text-muted-foreground border-border' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_VARIANT[status] ?? { label: status, cls: 'bg-muted text-foreground border-border' };
  return <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>;
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function DriverApplicationsPanel({ onBack, onViewOpportunity }: Props) {
  const {
    driverApplications,
    isLoadingDriver,
    isErrorDriver,
    refetchDriver,
    withdrawApplication,
  } = useOpportunityApplications();

  const [pendingId, setPendingId] = useState<string | null>(null);

  const apps = useMemo(() => driverApplications, [driverApplications]);

  const handleWithdraw = (id: string) => {
    setPendingId(id);
    withdrawApplication.mutate(id, {
      onSuccess: () => toast.success('Request withdrawn'),
      onError: (e: Error) => toast.error(e.message || 'Failed to withdraw'),
      onSettled: () => setPendingId(null),
    });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <h1 className="text-2xl font-black tracking-tight text-foreground mb-1">My Requests</h1>
        <p className="text-sm text-muted-foreground">
          Track the opportunities you requested information about.
        </p>
      </Card>

      {isErrorDriver ? (
        <EmptyState
          title="Unable to load your requests"
          body="Something went wrong while loading your opportunity requests."
          action={
            <Button variant="outline" onClick={() => refetchDriver()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      ) : isLoadingDriver ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          title="You haven’t requested any opportunities yet"
          body="When you request info on an opportunity it will show up here."
        />
      ) : (
        <div className="space-y-3">
          {apps.map((a: any) => {
            const opp = a.opportunities;
            const canWithdraw = !['hired', 'rejected', 'withdrawn'].includes(a.status);
            return (
              <Card key={a.id} className="p-5 border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-foreground">
                      {opp?.title || 'Opportunity'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {opp?.company_name}
                      {opp?.hiring_city || opp?.hiring_state ? (
                        <> · {[opp?.hiring_city, opp?.hiring_state].filter(Boolean).join(', ')}</>
                      ) : null}
                    </p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                  <Field label="Type" value={a.application_type?.replace('_', ' ')} />
                  <Field label="Contact" value={a.preferred_contact_method || '—'} />
                  <Field label="Submitted" value={fmtDate(a.created_at)} />
                  <Field label="Updated" value={fmtDate(a.updated_at)} />
                </div>

                {a.message && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90 mb-3 whitespace-pre-wrap">
                    {a.message}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {opp?.id && onViewOpportunity && (
                    <Button variant="outline" size="sm" onClick={() => onViewOpportunity(opp.id)}>
                      <Eye className="h-4 w-4" /> View Opportunity
                    </Button>
                  )}
                  {canWithdraw && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleWithdraw(a.id)}
                      disabled={pendingId === a.id || withdrawApplication.isPending}
                    >
                      <X className="h-4 w-4" /> Withdraw Request
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground capitalize">{value}</p>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="p-10 border-dashed border-border/60 text-center">
      <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </Card>
  );
}
