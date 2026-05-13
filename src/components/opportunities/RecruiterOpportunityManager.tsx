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
} from 'lucide-react';
import { toast } from 'sonner';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import {
  useRecruiterOpportunities,
  type Opportunity,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { RecruiterOpportunityForm } from './RecruiterOpportunityForm';

interface Props {
  onBack: () => void;
}

type View = 'list' | 'edit';

export function RecruiterOpportunityManager({ onBack }: Props) {
  const { profile, isLoading: profileLoading } = useRecruiterProfile();
  const { opportunities, isLoading, setStatus, refetch } = useRecruiterOpportunities();

  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<Opportunity | null>(null);

  if (profileLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Gating states
  if (!profile) return <Gate onBack={onBack} title="Recruiter Access Required" body="You need recruiter access before posting opportunities." Icon={ShieldCheck} />;
  const v = profile.verification_status;
  const s = profile.status;
  if (s === 'suspended' || v === 'suspended') {
    return <Gate onBack={onBack} title="Recruiter Access Suspended" body="Recruiter access suspended. Contact support." Icon={Ban} />;
  }
  if (v === 'rejected') {
    return <Gate onBack={onBack} title="Profile Needs Attention" body="Your recruiter profile needs attention before posting." Icon={AlertTriangle} />;
  }
  if (v !== 'approved') {
    return <Gate onBack={onBack} title="Pending Review" body="Your recruiter profile is pending review." Icon={Clock} />;
  }

  if (view === 'edit') {
    return (
      <RecruiterOpportunityForm
        initial={editing}
        onBack={() => { setView('list'); setEditing(null); }}
        onSaved={() => { setView('list'); setEditing(null); refetch(); }}
      />
    );
  }

  const handleStatus = (id: string, status: 'active' | 'paused' | 'closed') => {
    setStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Opportunity ${status}`),
        onError: (e: Error) => toast.error(e.message),
      }
    );
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
              Create and manage your trucking opportunities. Submissions are reviewed before going live.
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setView('edit'); }} className="shrink-0">
            <Plus className="h-4 w-4" /> New
          </Button>
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
          <Button onClick={() => { setEditing(null); setView('edit'); }}>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OpportunityRow({
  o, onEdit, onPause, onActivate, onClose, busy,
}: {
  o: Opportunity;
  onEdit: () => void;
  onPause: () => void;
  onActivate: () => void;
  onClose: () => void;
  busy: boolean;
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
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:w-44">
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          {o.status === 'active' ? (
            <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
              <PauseCircle className="h-4 w-4" /> Pause
            </Button>
          ) : o.status === 'draft' ? (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy}>
              <Send className="h-4 w-4" /> Submit for Review
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy}>
              <PlayCircle className="h-4 w-4" /> Activate
            </Button>
          )}
          {o.status !== 'closed' && (
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
