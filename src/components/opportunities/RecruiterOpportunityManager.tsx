import { useState, type MouseEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Briefcase,
  Plus,
  Pencil,
  PauseCircle,
  PlayCircle,
  XCircle,
  Ban,
  ShieldCheck,
  Inbox,
  Send,
  UserPlus,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useUserRole } from '@/hooks/useUserRole';
import { describeRecruiterBlock } from '@/lib/opportunities/describeRecruiterBlock';
import { resolveRecruiterReadiness } from '@/lib/opportunities/resolveRecruiterReadiness';
import { RecruiterReadinessDialog } from './RecruiterReadinessDialog';
import {
  useRecruiterOpportunities,
  useRecruiterStaffOpportunities,
  type Opportunity,
  type RecruiterStaffOpportunityPermissions,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { RecruiterOpportunityForm } from './RecruiterOpportunityForm';
import { RecruiterReferralsPanel } from './RecruiterReferralsPanel';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';
import { getOpportunityPublicationStatus } from '@/lib/opportunities/publicationStatus';

interface Props {
  onBack: () => void;
}

type View = 'list' | 'form' | 'referrals';

export function RecruiterOpportunityManager({ onBack }: Props) {
  const { profile, isLoading: profileLoading, refetchProfile } = useRecruiterProfile();
  const { intentRecruiter } = useUserRole();
  const { opportunities, isLoading, setStatus, deleteOpportunity, refetch } =
    useRecruiterOpportunities();
  const billing = useRecruiterBilling();

  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Opportunity | null>(null);
  // Phase 1P-A4: exactly-one pending action queued behind readiness.
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    { kind: 'create' } | { kind: 'activate'; id: string } | null
  >(null);

  if (profileLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Suspended remains fully blocked. Incomplete profiles no longer dead-end;
  // they see the manager and are prompted via the inline readiness dialog
  // only when they attempt to create or activate an opportunity.
  const block = describeRecruiterBlock(profile, { intentRecruiter });
  if (block.reason === 'suspended') {
    return <Gate onBack={onBack} title={block.title} body={block.body} Icon={Ban} />;
  }

  if (view === 'form') {
    return (
      <RecruiterOpportunityForm
        initial={editing}
        activeOpportunityLimit={billing.effectiveActiveOpportunityLimit}
        isAtActiveOpportunityLimit={billing.isAtActiveOpportunityLimit}
        activeOpportunityLimitMessage={billing.activeOpportunityLimitMessage}
        onBack={() => { setView('list'); setEditing(null); }}
        onSaved={() => { setView('list'); setEditing(null); refetch(); }}
      />
    );
  }


  if (view === 'referrals' && profile) {
    return (
      <RecruiterReferralsPanel
        recruiterId={profile.id}
        onBack={() => setView('list')}
      />
    );
  }

  const handleStatus = (id: string, status: 'active' | 'paused' | 'closed') => {
    setStatus.mutate(
      { id, status },
      {
        onSuccess: () => { toast.success(`Opportunity ${status}`); billing.refresh(); },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  };

  const executeCreate = () => { setEditing(null); setView('form'); };
  const executeActivate = (id: string) => handleStatus(id, 'active');

  // Phase 1R-E1 — canonical active-opportunity ceiling.
  const activeLimit = billing.effectiveActiveOpportunityLimit ?? 1;
  const activeUsed = billing.activeCount ?? 0;
  const atActiveLimit = billing.isAtActiveOpportunityLimit ?? false;
  const limitMessage =
    billing.activeOpportunityLimitMessage ??
    `You've reached your plan limit of ${activeLimit} active ${
      activeLimit === 1 ? 'opportunity' : 'opportunities'
    }. Pause or close a listing, or upgrade your plan, to publish another.`;

  const gateOrRun = async (action: { kind: 'create' } | { kind: 'activate'; id: string }) => {
    if (action.kind === 'activate' && atActiveLimit) {
      toast.error(limitMessage);
      return;
    }
    const fresh = await refetchProfile();
    const rr = resolveRecruiterReadiness(fresh);
    if (rr.ready) {
      if (action.kind === 'create') executeCreate();
      else executeActivate(action.id);
      return;
    }
    setPendingAction(action);
    setReadinessOpen(true);
  };

  const openCreate = () => { void gateOrRun({ kind: 'create' }); };
  const openEdit = (o: Opportunity) => { setEditing(o); setView('form'); };
  const requestActivate = (o: Opportunity) => { void gateOrRun({ kind: 'activate', id: o.id }); };
  const canActivate = !atActiveLimit;
  const deletionPending = deleteOpportunity?.isPending ?? false;
  const busy = setStatus.isPending || deletionPending;


  const confirmDelete = (event: MouseEvent) => {
    event.preventDefault();
    if (!pendingDelete) return;
    deleteOpportunity.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success('Opportunity deleted permanently');
        setPendingDelete(null);
      },
      onError: (e: Error) => {
        toast.error(e.message);
      },
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <Briefcase className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Manage Opportunities
            </h1>
            <p className="text-sm text-muted-foreground">
              Completed Recruiter profiles can post opportunities immediately. Verification adds trust and a badge; it does not control posting access. Each listing shows its driver visibility separately from its lifecycle status.
            </p>
            <p
              className="mt-2 text-xs font-semibold text-foreground"
              data-testid="active-opportunity-usage"
            >
              {`Active opportunities: ${activeUsed} of ${activeLimit}`}
            </p>
            {/* Phase 1R-E1-R2 — the ceiling applies to ACTIVE listings only. */}
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="active-opportunity-drafts-note"
            >
              Drafts are unlimited. Only active listings count toward your plan
              limit.
            </p>

            {atActiveLimit && (
              <p
                className="mt-1 text-xs text-destructive"
                data-testid="active-opportunity-limit-message"
              >
                {limitMessage}
              </p>
            )}
          </div>
          <Button onClick={openCreate} className="shrink-0" data-testid="post-opportunity-cta">
            <Plus className="h-4 w-4" /> Post Opportunity
          </Button>

        </div>
      </Card>

      <Card className="p-5 border-border/60">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
            <UserPlus className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground mb-1">Driver Referrals</h3>
            <p className="text-sm text-muted-foreground mb-3">
              View driver referrals tied to your opportunities and update their status.
              Bonuses, if offered, are paid externally by you — Haul Tracker Pro tracks progress only.
            </p>
            <Button onClick={() => setView('referrals')} variant="outline">
              Manage Referrals <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : opportunities.length === 0 ? (
        <Card className="p-10 border-dashed border-border/60 text-center">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-bold text-foreground mb-1">No opportunities yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Create your first opportunity to start connecting with serious drivers.
          </p>
          <Button onClick={openCreate} data-testid="empty-state-cta">
            <Plus className="h-4 w-4" /> Create Opportunity
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => (
            <OpportunityRow
              key={o.id}
              o={o}
              onEdit={() => openEdit(o)}
              onPause={() => handleStatus(o.id, 'paused')}
              onActivate={() => requestActivate(o)}
              onClose={() => handleStatus(o.id, 'closed')}
              onDelete={() => setPendingDelete(o)}
              busy={busy}
              canActivate={canActivate}
            />
          ))}
        </div>
      )}

      <RecruiterReadinessDialog
        open={readinessOpen}
        onOpenChange={(v) => {
          setReadinessOpen(v);
          if (!v) setPendingAction(null);
        }}
        profile={profile}
        onReady={() => {
          const pending = pendingAction;
          setPendingAction(null);
          if (!pending) return;
          if (pending.kind === 'create') executeCreate();
          else executeActivate(pending.id);
        }}
        actionLabel="Post Opportunity"
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletionPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete opportunity permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {`You are about to permanently delete "${pendingDelete?.title ?? ''}" at ${pendingDelete?.company_name ?? ''}.`}
                </p>
                <p>This cannot be undone.</p>
                <p>
                  Listings with connected applications, referrals, offers, contracts, or reports cannot be deleted.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletionPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-delete-opportunity"
              disabled={deletionPending}
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OpportunityRow({
  o, onEdit, onPause, onActivate, onClose, onDelete, busy, canActivate,
  canEdit = true, canChangeStatus = true, canDeletePermission = true,
}: {
  o: Opportunity;
  onEdit: () => void;
  onPause: () => void;
  onActivate: () => void;
  onClose: () => void;
  onDelete: () => void;
  busy: boolean;
  canActivate: boolean;
  /** Phase RC-1D — staff permission visibility. Owner path keeps defaults. */
  canEdit?: boolean;
  canChangeStatus?: boolean;
  canDeletePermission?: boolean;
}) {
  const statusVariant: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
    active: 'default',
    draft: 'outline',
    paused: 'secondary',
    closed: 'destructive',
  };

  const publication = getOpportunityPublicationStatus(o);
  const canDelete =
    canDeletePermission && (o.status === 'draft' || o.status === 'closed');


  return (
    <Card className="p-5 border-border/60" data-testid={`opportunity-row-${o.id}`}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground truncate">{o.title}</h3>
            <Badge variant={statusVariant[o.status] ?? 'outline'} className="capitalize">{`Listing: ${o.status}`}</Badge>
            <Badge
              variant={publication.variant}
              data-testid={`publication-status-${o.id}`}
              data-publication-state={publication.key}
            >
              {publication.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-2">{o.company_name}</p>
          <p
            className="text-xs text-muted-foreground mb-2"
            data-testid={`publication-status-description-${o.id}`}
          >
            {publication.description}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {o.driver_type && <Badge variant="outline">{o.driver_type}</Badge>}
            {o.route_type && <Badge variant="outline">{o.route_type}</Badge>}
            {o.trailer_type && <Badge variant="outline">{o.trailer_type}</Badge>}
            {o.estimated_weekly_gross != null && (
              <Badge variant="outline">
                ${Math.round(Number(o.estimated_weekly_gross)).toLocaleString()}/wk
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Created {new Date(o.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:w-44">
          {canEdit && (
            <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}
              data-testid={`edit-opportunity-${o.id}`}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {canChangeStatus && (o.status === 'active' ? (
            <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
              <PauseCircle className="h-4 w-4" /> Pause
            </Button>
          ) : o.status === 'draft' ? (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy || !canActivate}>
              <Send className="h-4 w-4" /> Publish
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy || !canActivate}>
              <PlayCircle className="h-4 w-4" /> Activate
            </Button>
          ))}
          {canChangeStatus && o.status !== 'closed' && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              <XCircle className="h-4 w-4" /> Close
            </Button>
          )}

          {canDelete && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={busy}
              data-testid={`delete-opportunity-${o.id}`}
            >
              <Trash2 className="h-4 w-4" /> Delete permanently
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Gate({
  onBack, title, body, Icon,
}: { onBack: () => void; title: string; body: string; Icon: typeof ShieldCheck }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <Briefcase className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Manage Opportunities
            </h1>
          </div>
        </div>
      </Card>
      <Card className="p-10 text-center border-border/60">
        <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{body}</p>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Phase RC-1D — RECRUITER STAFF opportunity manager.
 *
 * Separate component so the staff path NEVER mounts useRecruiterProfile,
 * useRecruiterBilling, useUserRole, referrals, readiness, or Agency hooks.
 * Client permission booleans are UX only; the database is authoritative.
 * ---------------------------------------------------------------------- */

export interface RecruiterStaffOpportunityManagerProps {
  recruiterId: string;
  companyName: string | null;
  permissions: RecruiterStaffOpportunityPermissions;
  onBack: () => void;
}

export function RecruiterStaffOpportunityManager({
  recruiterId,
  companyName,
  permissions,
  onBack,
}: RecruiterStaffOpportunityManagerProps) {
  const store = useRecruiterStaffOpportunities({ recruiterId, permissions });
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Opportunity | null>(null);

  const deletionPending = store.deleteOpportunity.isPending;
  const busy =
    store.setStatus.isPending ||
    store.updateOpportunity.isPending ||
    deletionPending;

  // Defensive: view permission is required to render anything operational.
  if (!permissions.canViewOpportunities) {
    return (
      <Gate
        onBack={onBack}
        title="Opportunities unavailable"
        body="You do not have permission to view opportunities in this workspace."
        Icon={ShieldCheck}
      />
    );
  }

  if (view === 'form') {
    return (
      <RecruiterOpportunityForm
        initial={editing}
        onBack={() => { setView('list'); setEditing(null); }}
        onSaved={() => { setView('list'); setEditing(null); void store.refetch(); }}
        staffController={{
          recruiterId,
          companyName,
          isPending:
            store.createOpportunity.isPending || store.updateOpportunity.isPending,
          permissions: {
            canCreate: permissions.canCreateOpportunities,
            canEdit: permissions.canEditOpportunities,
            canChangeStatus: permissions.canChangeOpportunityStatus,
          },
          create: (payload, handlers) => store.createOpportunity.mutate(payload, handlers),
          update: (id, payload, handlers) =>
            store.updateOpportunity.mutate({ id, data: payload }, handlers),
        }}
      />
    );
  }

  const handleStatus = (id: string, status: 'active' | 'paused' | 'closed') => {
    store.setStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Opportunity ${status}`),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  const confirmDelete = (event: MouseEvent) => {
    event.preventDefault();
    if (!pendingDelete) return;
    store.deleteOpportunity.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success('Opportunity deleted permanently');
        setPendingDelete(null);
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-6 animate-fade-in" data-testid="recruiter-staff-opportunity-manager">
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <Briefcase className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Manage Opportunities
            </h1>
            <p className="text-sm text-muted-foreground break-words">
              {companyName ?? 'Recruiter workspace'} · team access
            </p>
          </div>
          {permissions.canCreateOpportunities && (
            <Button
              onClick={() => { setEditing(null); setView('form'); }}
              className="shrink-0"
              data-testid="staff-post-opportunity-cta"
            >
              <Plus className="h-4 w-4" /> Post Opportunity
            </Button>
          )}
        </div>
      </Card>

      {store.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : store.opportunities.length === 0 ? (
        <Card className="p-10 border-dashed border-border/60 text-center">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-bold text-foreground mb-1">No opportunities yet</h3>
        </Card>
      ) : (
        <div className="space-y-3">
          {store.opportunities.map((o) => (
            <OpportunityRow
              key={o.id}
              o={o}
              onEdit={() => { setEditing(o); setView('form'); }}
              onPause={() => handleStatus(o.id, 'paused')}
              onActivate={() => handleStatus(o.id, 'active')}
              onClose={() => handleStatus(o.id, 'closed')}
              onDelete={() => setPendingDelete(o)}
              busy={busy}
              canActivate={permissions.canChangeOpportunityStatus}
              canEdit={permissions.canEditOpportunities}
              canChangeStatus={permissions.canChangeOpportunityStatus}
              canDeletePermission={permissions.canDeleteOpportunities}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletionPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete opportunity permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {`You are about to permanently delete "${pendingDelete?.title ?? ''}" at ${pendingDelete?.company_name ?? ''}.`}
                </p>
                <p>This cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletionPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-delete-opportunity"
              disabled={deletionPending}
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
