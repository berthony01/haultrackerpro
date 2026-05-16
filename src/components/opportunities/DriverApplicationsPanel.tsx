import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft,
  Inbox,
  RefreshCw,
  Eye,
  X,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  PhoneCall,
  HelpCircle,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useOpportunityApplications,
  type DriverResponseType,
} from '@/hooks/opportunities/useOpportunityApplications';
import {
  useRecruiterContactRequests,
  latestRequestForApp,
  type RecruiterContactRequest,
} from '@/hooks/opportunities/useRecruiterContactRequests';
import { ContractAttachment } from '@/components/contracts/ContractAttachment';
import {
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  DRIVER_PIPELINE_GROUPS,
  isTerminal,
} from '@/lib/opportunities/applicationStatus';
import { ApplicationTimeline } from './ApplicationTimeline';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  onBack: () => void;
  onViewOpportunity?: (opportunityId: string) => void;
}

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

const RESPONSE_OPTIONS: { value: DriverResponseType; label: string; icon: any }[] = [
  { value: 'still_interested', label: 'Still Interested', icon: ThumbsUp },
  { value: 'request_callback', label: 'Request Callback', icon: PhoneCall },
  { value: 'need_more_info', label: 'Need More Info', icon: HelpCircle },
  { value: 'not_interested', label: 'Not Interested', icon: XCircle },
];

export function DriverApplicationsPanel({ onBack, onViewOpportunity }: Props) {
  const {
    driverApplications,
    isLoadingDriver,
    isErrorDriver,
    refetchDriver,
    withdrawApplication,
    recordDriverResponse,
  } = useOpportunityApplications();

  const appIds = useMemo(
    () => (driverApplications as any[]).map((a) => a.id),
    [driverApplications],
  );
  const { requests: contactRequests, respond: respondContact } =
    useRecruiterContactRequests(appIds);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [respondModal, setRespondModal] = useState<{
    applicationId: string;
    responseType: DriverResponseType;
    label: string;
  } | null>(null);
  const [responseNote, setResponseNote] = useState('');

  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    DRIVER_PIPELINE_GROUPS.forEach((g) => m.set(g.key, []));
    (driverApplications as any[]).forEach((a) => {
      const g = DRIVER_PIPELINE_GROUPS.find((x) => x.statuses.includes(a.status));
      if (g) m.get(g.key)!.push(a);
    });
    return m;
  }, [driverApplications]);

  const handleWithdraw = (id: string) => {
    setPendingId(id);
    withdrawApplication.mutate(id, {
      onSuccess: () => toast.success('Request withdrawn'),
      onError: (e: Error) => toast.error(e.message || 'Failed to withdraw'),
      onSettled: () => setPendingId(null),
    });
  };

  const openRespond = (applicationId: string, responseType: DriverResponseType, label: string) => {
    setResponseNote('');
    setRespondModal({ applicationId, responseType, label });
  };

  const submitRespond = () => {
    if (!respondModal) return;
    const { applicationId, responseType, label } = respondModal;
    setRespondModal(null);
    setPendingId(applicationId);
    recordDriverResponse.mutate(
      { applicationId, responseType, note: responseNote.trim() || undefined },
      {
        onSuccess: () => toast.success(`Sent: ${label}`),
        onError: (e: Error) => toast.error(e.message || 'Failed to send'),
        onSettled: () => setPendingId(null),
      },
    );
  };

  const renderCard = (a: any) => {
    const opp = a.opportunities;
    const canWithdraw = !isTerminal(a.status);
    const isOpen = !!expanded[a.id];
    return (
      <Card key={a.id} className="p-5 border-border/60">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-foreground">{opp?.title || 'Opportunity'}</h3>
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
          <Field label="Submitted" value={fmtDate(a.created_at)} />
          <Field label="Last Activity" value={fmtDate(a.updated_at)} />
          <Field label="Contact" value={a.preferred_contact_method || '—'} />
          <Field label="Type" value={(a.application_type || '').replace('_', ' ')} />
        </div>

        {a.message && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-foreground/90 mb-3 whitespace-pre-wrap">
            {a.message}
          </div>
        )}

        <DriverContactRequestBlock
          applicationId={a.id}
          request={latestRequestForApp(contactRequests, a.id)}
          isPending={pendingId === a.id}
          onRespond={(decision) => {
            const req = latestRequestForApp(contactRequests, a.id);
            if (!req) return;
            setPendingId(a.id);
            respondContact.mutate(
              { requestId: req.id, decision },
              {
                onSuccess: () =>
                  toast.success(decision === 'approved' ? 'Contact approved' : 'Contact declined'),
                onError: (e: Error) => toast.error(e.message || 'Failed'),
                onSettled: () => setPendingId(null),
              },
            );
          }}
        />

        <div className="mb-3">
          <ContractAttachment applicationId={a.id} role="driver" />
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {opp?.id && onViewOpportunity && (
            <Button variant="outline" size="sm" onClick={() => onViewOpportunity(opp.id)}>
              <Eye className="h-4 w-4" /> View Opportunity
            </Button>
          )}
          {!isTerminal(a.status) &&
            RESPONSE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  onClick={() => openRespond(a.id, opt.value, opt.label)}
                  disabled={pendingId === a.id}
                >
                  <Icon className="h-4 w-4" /> {opt.label}
                </Button>
              );
            })}
          {canWithdraw && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleWithdraw(a.id)}
              disabled={pendingId === a.id || withdrawApplication.isPending}
            >
              <X className="h-4 w-4" /> Withdraw
            </Button>
          )}
        </div>

        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={() => setExpanded((m) => ({ ...m, [a.id]: !m[a.id] }))}
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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <h1 className="text-2xl font-black tracking-tight text-foreground mb-1">Hiring Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Track every opportunity you've requested and the recruiter's progress.
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
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : driverApplications.length === 0 ? (
        <EmptyState
          title="You haven't requested any opportunities yet"
          body="When you request info on an opportunity it will show up here."
        />
      ) : (
        <div className="space-y-6">
          {DRIVER_PIPELINE_GROUPS.map((g) => {
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

      <Dialog open={!!respondModal} onOpenChange={(o) => { if (!o) setRespondModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              {respondModal?.label}
            </DialogTitle>
            <DialogDescription>
              Send a structured response to the recruiter. Add an optional short note (200 char max).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={responseNote}
            onChange={(e) => setResponseNote(e.target.value.slice(0, 200))}
            maxLength={200}
            placeholder="Optional note…"
            className="min-h-[80px]"
          />
          <p className="text-[10px] text-muted-foreground text-right">{responseNote.length}/200</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRespondModal(null)}>Cancel</Button>
            <Button onClick={submitRespond} disabled={recordDriverResponse.isPending}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
