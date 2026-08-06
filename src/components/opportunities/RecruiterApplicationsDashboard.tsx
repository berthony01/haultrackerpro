import { useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PhoneCall, CheckCircle2, XCircle, Clock } from 'lucide-react';
import {
  useRecruiterContactRequests,
  latestRequestForApp,
} from '@/hooks/opportunities/useRecruiterContactRequests';
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
import {
  ArrowLeft,
  Inbox,
  RefreshCw,
  Search,
  Ban,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useOpportunityApplications,
} from '@/hooks/opportunities/useOpportunityApplications';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';
import { calculateOpportunityFinancials } from '@/lib/opportunities/opportunityProfit';
import { calculateOpportunityMatch } from '@/lib/opportunities/opportunityMatch';
import { OpportunityMatchBadge } from './OpportunityMatchBadge';
import { ContractAttachment } from '@/components/contracts/ContractAttachment';
import { useContractReadinessMap } from '@/hooks/contracts/useContractReadinessMap';
import {
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  RECRUITER_ACTION_LABEL,
  RECRUITER_PIPELINE_GROUPS,
  getAllowedRecruiterTransitions,
  type RecruiterTransition,
} from '@/lib/opportunities/applicationStatus';
import { ApplicationTimeline } from './ApplicationTimeline';
import {
  pipelineCounts,
  hireConversionRate,
} from '@/lib/opportunities/pipelineAnalytics';

interface Props {
  onBack: () => void;
}

const ANY = 'any';

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={STATUS_BADGE_CLASS[status] ?? 'bg-muted text-foreground border-border'}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const PREFERRED_CONTACT_LABELS: Record<string, string> = {
  in_app: 'In-app',
  email: 'Email',
  phone: 'Phone',
  sms: 'SMS',
};

function formatPreferredContact(value?: string | null): string {
  if (!value) return '—';
  const key = String(value).toLowerCase();
  return (
    PREFERRED_CONTACT_LABELS[key] ??
    key
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
  );
}

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

export function RecruiterApplicationsDashboard({ onBack }: Props) {
  const { profile, canPost, isSuspended, isLoading: recruiterLoading } = useRecruiterProfile();
  const recruiterBilling = useRecruiterBilling();
  const canUseContractWorkflow = recruiterBilling.canUseContractWorkflowTools === true;
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
  const [expandedTimeline, setExpandedTimeline] = useState<Record<string, boolean>>({});

  const appIds = useMemo(() => recruiterApplications.map((a: any) => a.id), [recruiterApplications]);
  const { readinessMap } = useContractReadinessMap(appIds);
  const { requests: contactRequests, requestContact } = useRecruiterContactRequests(appIds);
  const [contactModalAppId, setContactModalAppId] = useState<string | null>(null);
  const [contactNote, setContactNote] = useState('');

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

  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    RECRUITER_PIPELINE_GROUPS.forEach((g) => m.set(g.key, []));
    filtered.forEach((a) => {
      const group = RECRUITER_PIPELINE_GROUPS.find((g) => g.statuses.includes(a.status));
      if (group) m.get(group.key)!.push(a);
    });
    return m;
  }, [filtered]);

  const analytics = useMemo(() => {
    const counts = pipelineCounts(recruiterApplications as any[]);
    return {
      total: recruiterApplications.length,
      open: (recruiterApplications as any[]).filter(
        (a) => !['hired', 'rejected', 'withdrawn'].includes(a.status),
      ).length,
      hired: counts['hired'] ?? 0,
      conversion: Math.round(hireConversionRate(recruiterApplications as any[]) * 100),
    };
  }, [recruiterApplications]);

  // FIX 4: no direct-hire code path. Recruiter selects only RecruiterTransition
  // values. Hired/onboarding/withdrawn are server-workflow-only and never
  // reachable from this dashboard.
  const handleUpdate = (id: string, status: RecruiterTransition) => {
    setPendingId(id);
    updateApplicationStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Marked ${STATUS_LABEL[status] ?? status}`),
        onError: (e: Error) => toast.error(e?.message || 'Update failed'),
        onSettled: () => setPendingId(null),
      },
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

  if (!canPost) {
    return (
      <div className="space-y-5 animate-fade-in">
        {renderHeader}
        <Card className="p-10 border-dashed border-border/60 text-center">
          <h3 className="text-base font-bold text-foreground mb-1">Complete Your Recruiter Profile</h3>
          <p className="text-sm text-muted-foreground">
            Complete the required recruiter profile fields and accept the current posting terms before managing applications.
          </p>
        </Card>
      </div>
    );
  }

  const renderCard = (a: any) => {
    const dp = a.driver_profile;
    const opp = a.opportunities;
    const match =
      dp && opp
        ? calculateOpportunityMatch({
            opportunity: opp,
            driverProfile: dp,
            opportunityFinancials: calculateOpportunityFinancials(opp),
          })
        : null;
    const allowed = getAllowedRecruiterTransitions(a.status);
    const isOpen = !!expandedTimeline[a.id];
    return (
      <Card key={a.id} className="p-5 border-border/60">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-foreground">
              {dp?.full_name || 'Driver (name not provided)'}
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
            {(() => {
              const info = readinessMap.get(a.id);
              if (!info) return null;
              return (
                <Badge variant="outline" className={`gap-1 ${info.badgeClass}`}>
                  <FileText className="h-3 w-3" />
                  {info.label}
                </Badge>
              );
            })()}
          </div>
        </div>

        {(() => {
          const contactReq = latestRequestForApp(contactRequests, a.id);
          const contactApproved = contactReq?.status === 'approved';
          const appClosed = ['hired', 'rejected', 'withdrawn'].includes(a.status);
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                <Field label="Opportunity" value={opp?.title || '—'} />
                <Field label="Submitted" value={fmtDate(a.created_at)} />
                <Field label="Last Activity" value={fmtDate(a.updated_at)} />
                <Field label="Preferred Contact" value={formatPreferredContact(a.preferred_contact_method)} />
                {dp?.preferred_driver_type && <Field label="Driver Type" value={dp.preferred_driver_type} />}
                {dp?.preferred_route_type && <Field label="Route" value={dp.preferred_route_type} />}
                {contactApproved && a.driver_phone_snapshot && (
                  <Field label="Phone" value={a.driver_phone_snapshot} />
                )}
                {contactApproved && a.driver_email_snapshot && (
                  <Field label="Email" value={a.driver_email_snapshot} />
                )}
              </div>

              {a.message && (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90 mb-3 whitespace-pre-wrap">
                  {a.message}
                </div>
              )}

              <div className="mb-3">
                <RecruiterContactRequestRow
                  status={contactReq?.status ?? null}
                  appClosed={appClosed}
                  onRequest={() => {
                    setContactNote('');
                    setContactModalAppId(a.id);
                  }}
                />
              </div>

              <div className="mb-3">
                {canUseContractWorkflow ? (
                  <ContractAttachment applicationId={a.id} role="recruiter" />
                ) : (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex items-start gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      <div className="font-semibold text-foreground/90 mb-0.5">
                        Contract workflow tools are available on Growth and Fleet plans.
                      </div>
                      Upgrade for contract transparency tools, document workflow, and premium recruiting features.
                    </div>
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {allowed.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {allowed.map((status) => (
              <Button
                key={status}
                variant={status === 'rejected' ? 'ghost' : 'outline'}
                size="sm"
                onClick={() => handleUpdate(a.id, status)}
                disabled={pendingId === a.id || updateApplicationStatus.isPending}
              >
                {RECRUITER_ACTION_LABEL[status]}
              </Button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={() => setExpandedTimeline((m) => ({ ...m, [a.id]: !m[a.id] }))}
        >
          {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {isOpen ? 'Hide activity' : 'Show activity'}
        </button>
        {isOpen && (
          <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <ApplicationTimeline applicationId={a.id} />
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {renderHeader}

      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <h1 className="text-2xl font-black tracking-tight text-foreground mb-1">Recruiting Pipeline</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Move drivers through your hiring workflow.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total Applicants" value={analytics.total} />
          <Stat label="Open" value={analytics.open} />
          <Stat label="Hired" value={analytics.hired} />
          <Stat label="Hire Rate" value={`${analytics.conversion}%`} />
        </div>
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
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Status
            </label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {Object.keys(STATUS_LABEL)
                  .filter((s) => s !== 'contacted')
                  .map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Opportunity
            </label>
            <Select value={opportunityFilter} onValueChange={setOpportunityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {opportunityOptions.map(([id, title]) => (
                  <SelectItem key={id} value={id}>
                    {title}
                  </SelectItem>
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
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
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
                setSearch('');
                setStatusFilter(ANY);
                setOpportunityFilter(ANY);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {RECRUITER_PIPELINE_GROUPS.map((g) => {
            const apps = grouped.get(g.key) ?? [];
            if (apps.length === 0) return null;
            return (
              <section key={g.key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </h2>
                  <Badge variant="outline" className="bg-muted/50">
                    {apps.length}
                  </Badge>
                </div>
                <div className="space-y-3">{apps.map(renderCard)}</div>
              </section>
            );
          })}
        </div>
      )}



      <Dialog
        open={!!contactModalAppId}
        onOpenChange={(o) => { if (!o) setContactModalAppId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-primary" />
              Request Driver Contact
            </DialogTitle>
            <DialogDescription>
              The driver will be asked to approve contact for this opportunity. Add an optional short
              note explaining why (max 300 chars).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={contactNote}
            onChange={(e) => setContactNote(e.target.value.slice(0, 300))}
            maxLength={300}
            placeholder="Optional note for the driver…"
            className="min-h-[90px]"
          />
          <p className="text-[10px] text-muted-foreground text-right">{contactNote.length}/300</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setContactModalAppId(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!contactModalAppId) return;
                const id = contactModalAppId;
                setContactModalAppId(null);
                requestContact.mutate(
                  { applicationId: id, recruiterNote: contactNote.trim() || undefined },
                  {
                    onSuccess: () => toast.success('Contact request sent'),
                    onError: (e: Error) => toast.error(e.message || 'Failed to send'),
                  },
                );
              }}
              disabled={requestContact.isPending}
            >
              Send Contact Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecruiterContactRequestRow({
  status,
  appClosed,
  onRequest,
}: {
  status: 'pending' | 'approved' | 'declined' | 'expired' | null;
  appClosed: boolean;
  onRequest: () => void;
}) {
  if (status === 'approved') {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Contact Approved
      </div>
    );
  }
  if (status === 'pending') {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-400">
        <Clock className="h-3.5 w-3.5" /> Contact Request Pending
      </div>
    );
  }
  if (status === 'declined') {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground">
        <XCircle className="h-3.5 w-3.5" /> Contact Declined
      </div>
    );
  }
  if (appClosed) return null;
  return (
    <Button variant="outline" size="sm" onClick={onRequest}>
      <PhoneCall className="h-4 w-4" /> Request Contact
    </Button>
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-black text-foreground">{value}</p>
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
