import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  Briefcase,
  Plus,
  Pencil,
  PauseCircle,
  PlayCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Ban,
  ShieldCheck,
  Inbox,
  Send,
  UserPlus,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useUserRole } from '@/hooks/useUserRole';
import { describeRecruiterBlock } from '@/lib/opportunities/describeRecruiterBlock';
import {
  useRecruiterOpportunities,
  type Opportunity,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { RecruiterOpportunityForm } from './RecruiterOpportunityForm';
import { RecruiterQuickPostForm } from './RecruiterQuickPostForm';
import { RecruiterReferralsPanel } from './RecruiterReferralsPanel';
import { useRecruiterBilling } from '@/hooks/opportunities/useRecruiterBilling';
import type { OpportunityInsert } from '@/hooks/opportunities/useRecruiterOpportunities';

interface Props {
  onBack: () => void;
}

type View = 'list' | 'quick' | 'edit' | 'referrals';

export function RecruiterOpportunityManager({ onBack }: Props) {
  const { profile, isLoading: profileLoading } = useRecruiterProfile();
  const { intentRecruiter } = useUserRole();
  const { opportunities, isLoading, setStatus, refetch } = useRecruiterOpportunities();
  const billing = useRecruiterBilling();

  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [seed, setSeed] = useState<Partial<OpportunityInsert> | null>(null);

  if (profileLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Gating states — Phase 1F-A: only suspended / missing / incomplete
  // block posting. Pending or rejected (non-suspended) recruiters may
  // post standard opportunities immediately.
  const block = describeRecruiterBlock(profile, { intentRecruiter });
  if (block.reason !== 'ok') {
    const Icon =
      block.reason === 'suspended'
        ? Ban
        : block.reason === 'incomplete_profile'
        ? AlertTriangle
        : ShieldCheck;
    return <Gate onBack={onBack} title={block.title} body={block.body} Icon={Icon} />;
  }

  // Verified recruiters can submit unlimited standard opportunities.
  // Approval/suspension gating is already enforced above; billing is only for premium tools.
  if (view === 'quick') {
    return (
      <RecruiterQuickPostForm
        onBack={() => { setView('list'); setSeed(null); }}
        onSaved={() => { setView('list'); setSeed(null); refetch(); }}
        onSwitchToDetailed={(values) => { setSeed(values); setEditing(null); setView('edit'); }}
      />
    );
  }

  if (view === 'edit') {
    return (
      <RecruiterOpportunityForm
        initial={editing}
        seed={editing ? null : seed}
        onBack={() => { setView('list'); setEditing(null); setSeed(null); }}
        onSaved={() => { setView('list'); setEditing(null); setSeed(null); refetch(); }}
        canSubmitForReview={true}
        submitBlockReason={null}
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

  const canActivate = true;

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
              Create and manage your trucking opportunities. Verified recruiter posts go live to drivers immediately.
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setSeed(null); setView('quick'); }} className="shrink-0">
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
          <Button onClick={() => { setEditing(null); setSeed(null); setView('quick'); }}>
            <Plus className="h-4 w-4" /> Create Opportunity
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => (
            <OpportunityRow
              key={o.id}
              o={o}
              onEdit={() => { setEditing(o); setView('edit'); }}
              onPause={() => handleStatus(o.id, 'paused')}
              onActivate={() => handleStatus(o.id, 'active')}
              onClose={() => handleStatus(o.id, 'closed')}
              busy={setStatus.isPending}
              canActivate={canActivate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OpportunityRow({
  o, onEdit, onPause, onActivate, onClose, busy, canActivate,
}: {
  o: Opportunity;
  onEdit: () => void;
  onPause: () => void;
  onActivate: () => void;
  onClose: () => void;
  busy: boolean;
  canActivate: boolean;
}) {
  const statusVariant: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
    active: 'default',
    draft: 'outline',
    paused: 'secondary',
    closed: 'destructive',
  };
  const reviewVariant: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
    approved: 'default',
    pending: 'outline',
    rejected: 'destructive',
  };

  return (
    <Card className="p-5 border-border/60">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground truncate">{o.title}</h3>
            <Badge variant={statusVariant[o.status] ?? 'outline'} className="capitalize">{o.status}</Badge>
            <Badge variant={reviewVariant[o.admin_review_status] ?? 'outline'} className="capitalize">
              Review: {o.admin_review_status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-2">{o.company_name}</p>
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
          {o.admin_review_status === 'rejected' && (
            <p className="text-[11px] mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive">
              This post was rejected by admin review. Edit it and resubmit — changes are reviewed before going live again.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:w-44">
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          {o.admin_review_status === 'rejected' ? (
            <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
              <Send className="h-4 w-4" /> Resubmit for Review
            </Button>
          ) : o.status === 'active' ? (
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
          )}
          {o.status !== 'closed' && o.admin_review_status !== 'rejected' && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              <XCircle className="h-4 w-4" /> Close
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
