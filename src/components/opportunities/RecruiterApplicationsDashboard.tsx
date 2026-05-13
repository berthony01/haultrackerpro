import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Inbox, RefreshCw, Search, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useOpportunityApplications, type RecruiterApplicationStatus } from '@/hooks/opportunities/useOpportunityApplications';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { calculateOpportunityFinancials } from '@/lib/opportunities/opportunityProfit';
import { calculateOpportunityMatch } from '@/lib/opportunities/opportunityMatch';
import { OpportunityMatchBadge } from './OpportunityMatchBadge';

interface Props {
  onBack: () => void;
}

const ANY = 'any';

const STATUS_VARIANT: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-primary/15 text-primary border-primary/30' },
  viewed: { label: 'Viewed', cls: 'bg-muted text-foreground border-border' },
  contacted: { label: 'Contacted', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  interviewing: { label: 'Interviewing', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  hired: { label: 'Hired', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  rejected: { label: 'Rejected', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-muted text-muted-foreground border-border' },
};

const RECRUITER_TRANSITIONS: { value: RecruiterApplicationStatus; label: string }[] = [
  { value: 'viewed', label: 'Mark Viewed' },
  { value: 'contacted', label: 'Mark Contacted' },
  { value: 'interviewing', label: 'Mark Interviewing' },
  { value: 'hired', label: 'Mark Hired' },
  { value: 'rejected', label: 'Mark Rejected' },
];

const STATUS_RANK: Record<string, number> = {
  new: 1,
  viewed: 2,
  contacted: 3,
  interviewing: 4,
  hired: 5,
  rejected: 5,
  withdrawn: 5,
};

function getAllowedTransitions(currentStatus: string): RecruiterApplicationStatus[] {
  const currentRank = STATUS_RANK[currentStatus] ?? 0;
  // Terminal statuses get no recruiter actions
  if (['hired', 'rejected', 'withdrawn'].includes(currentStatus)) return [];
  return RECRUITER_TRANSITIONS.filter((t) => {
    const targetRank = STATUS_RANK[t.value] ?? 0;
    return targetRank > currentRank;
  }).map((t) => t.value);
}

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

export function RecruiterApplicationsDashboard({ onBack }: Props) {
  const { profile, isApproved, isSuspended, isLoading: recruiterLoading } = useRecruiterProfile();
  const {
    recruiterApplications,
    isLoadingRecruiter,
    isErrorRecruiter,
    refetchRecruiter,
    updateApplicationStatus,
  } = useOpportunityApplications({ recruiterId: profile?.id });

  const [statusFilter, setStatusFilter] = useState<string>(ANY);
  const [opportunityFilter, setOpportunityFilter] = useState<string>(ANY);
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const opportunityOptions = useMemo(() => {
    const map = new Map<string, string>();
    recruiterApplications.forEach((a: any) => {
      const opp = a.opportunities;
      if (opp?.id) map.set(opp.id, opp.title || 'Opportunity');
    });
    return Array.from(map.entries());
  }, [recruiterApplications]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (recruiterApplications as any[]).filter((a) => {
      if (statusFilter !== ANY && a.status !== statusFilter) return false;
      if (opportunityFilter !== ANY && a.opportunity_id !== opportunityFilter) return false;
      if (q) {
        const hay = [
          a.driver_profile?.full_name,
          a.driver_profile?.city,
          a.driver_profile?.state,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recruiterApplications, statusFilter, opportunityFilter, search]);

  const handleUpdate = (id: string, status: RecruiterApplicationStatus) => {
    setPendingId(id);
    updateApplicationStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Marked ${status}`),
        onError: (e: Error) => toast.error(e.message || 'Update failed'),
        onSettled: () => setPendingId(null),
      }
    );
  };

  const renderHeader = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
    </div>
  );

  if (recruiterLoading) {
    return (
      <div className="space-y-5 animate-fade-in">
        {renderHeader}
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isSuspended) {
    return (
      <div className="space-y-5 animate-fade-in">
        {renderHeader}
        <Card className="p-10 border-dashed border-destructive/40 text-center">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-destructive/10 p-3">
            <Ban className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="text-base font-bold text-foreground mb-1">Recruiter Access Suspended</h3>
          <p className="text-sm text-muted-foreground">
            Please contact support regarding your recruiter account.
          </p>
        </Card>
      </div>
    );
  }

  if (!isApproved) {
    return (
      <div className="space-y-5 animate-fade-in">
        {renderHeader}
        <Card className="p-10 border-dashed border-border/60 text-center">
          <h3 className="text-base font-bold text-foreground mb-1">Awaiting Approval</h3>
          <p className="text-sm text-muted-foreground">
            Your recruiter profile must be approved before you can view applications.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {renderHeader}

      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <h1 className="text-2xl font-black tracking-tight text-foreground mb-1">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Review drivers who requested information about your opportunities.
        </p>
      </Card>

      <Card className="p-4 border-border/60 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search driver name, city, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {Object.keys(STATUS_VARIANT).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_VARIANT[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Opportunity</label>
            <Select value={opportunityFilter} onValueChange={setOpportunityFilter}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {opportunityOptions.map(([id, title]) => (
                  <SelectItem key={id} value={id}>{title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {isErrorRecruiter ? (
        <EmptyState
          title="Unable to load applications"
          body="Something went wrong while loading driver applications."
          action={
            <Button variant="outline" onClick={() => refetchRecruiter()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      ) : isLoadingRecruiter ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : recruiterApplications.length === 0 ? (
        <EmptyState
          title="No driver requests yet"
          body="When drivers request info about your opportunities, they will appear here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No results match your filters"
          body="Try clearing filters or broadening your search."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch(''); setStatusFilter(ANY); setOpportunityFilter(ANY);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((a: any) => {
            const dp = a.driver_profile;
            const opp = a.opportunities;
            const isTerminal = ['hired', 'rejected', 'withdrawn'].includes(a.status);
            const match = dp && opp
              ? calculateOpportunityMatch({
                  opportunity: opp,
                  driverProfile: dp,
                  opportunityFinancials: calculateOpportunityFinancials(opp),
                })
              : null;
            return (
              <Card key={a.id} className="p-5 border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-foreground">
                      {dp?.full_name || 'Driver'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {[dp?.city, dp?.state].filter(Boolean).join(', ') || '—'}
                      {dp?.cdl_class ? <> · CDL {dp.cdl_class}</> : null}
                      {dp?.years_experience != null ? <> · {dp.years_experience} yrs</> : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {match && <OpportunityMatchBadge score={match.matchScore} tier={match.matchTier} />}
                    <StatusBadge status={a.status} />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                  <Field label="Opportunity" value={opp?.title || '—'} />
                  <Field label="Application" value={a.application_type?.replace('_', ' ') || '—'} />
                  <Field label="Contact" value={a.preferred_contact_method || '—'} />
                  <Field label="Submitted" value={fmtDate(a.created_at)} />
                  {dp?.preferred_driver_type && <Field label="Driver Type" value={dp.preferred_driver_type} />}
                  {dp?.preferred_route_type && <Field label="Route" value={dp.preferred_route_type} />}
                  {a.driver_phone_snapshot && <Field label="Phone" value={a.driver_phone_snapshot} />}
                  {a.driver_email_snapshot && <Field label="Email" value={a.driver_email_snapshot} />}
                </div>

                {a.message && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90 mb-3 whitespace-pre-wrap">
                    {a.message}
                  </div>
                )}

                {(() => {
                  const allowed = getAllowedTransitions(a.status);
                  if (allowed.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {allowed.map((status) => {
                        const t = RECRUITER_TRANSITIONS.find((x) => x.value === status)!;
                        return (
                          <Button
                            key={t.value}
                            variant={t.value === 'hired' ? 'default' : t.value === 'rejected' ? 'ghost' : 'outline'}
                            size="sm"
                            onClick={() => handleUpdate(a.id, t.value)}
                            disabled={pendingId === a.id || updateApplicationStatus.isPending}
                          >
                            {t.label}
                          </Button>
                        );
                      })}
                    </div>
                  );
                })()}
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
