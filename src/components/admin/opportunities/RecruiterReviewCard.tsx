import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, ShieldCheck, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useAdmin } from '@/hooks/useAdmin';
import { useRecruiterProfile, type RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

interface Props {
  recruiter: RecruiterProfile;
}

/**
 * Admin-only review card for recruiter verification moderation.
 * Renders nothing for non-admin users. Server-side enforcement is handled
 * by the recruiter_profile_guard() trigger and admin RLS policies.
 */
export function RecruiterReviewCard({ recruiter }: Props) {
  const { isAdmin } = useAdmin();
  const { approveRecruiter, rejectRecruiter, suspendRecruiter } = useRecruiterProfile();

  if (!isAdmin) return null;

  const handle = (
    label: string,
    fn: () => void,
  ) => {
    if (!confirm(`${label} recruiter "${recruiter.recruiter_name}"?`)) return;
    fn();
  };

  const onApprove = () =>
    handle('Approve', () =>
      approveRecruiter.mutate(recruiter.id, {
        onSuccess: () => toast.success('Recruiter approved'),
        onError: (e: Error) => toast.error(e.message),
      }),
    );

  const onReject = () =>
    handle('Reject', () =>
      rejectRecruiter.mutate(
        { recruiterId: recruiter.id },
        {
          onSuccess: () => toast.success('Recruiter rejected'),
          onError: (e: Error) => toast.error(e.message),
        },
      ),
    );

  const onSuspend = () =>
    handle('Suspend', () =>
      suspendRecruiter.mutate(
        { recruiterId: recruiter.id },
        {
          onSuccess: () => toast.success('Recruiter suspended'),
          onError: (e: Error) => toast.error(e.message),
        },
      ),
    );

  const v = recruiter.verification_status;
  const variant: 'default' | 'outline' | 'secondary' | 'destructive' =
    v === 'approved' ? 'default'
    : v === 'rejected' ? 'secondary'
    : v === 'suspended' ? 'destructive'
    : 'outline';

  const isPending =
    approveRecruiter.isPending || rejectRecruiter.isPending || suspendRecruiter.isPending;

  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground truncate">
              {recruiter.recruiter_name}
            </h3>
            <Badge variant={variant} className="capitalize">{v}</Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate">{recruiter.company_name}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-4 text-sm">
        <Row label="Email" value={recruiter.recruiter_email} />
        <Row label="Submitted" value={new Date(recruiter.created_at).toLocaleDateString()} />
        <Row label="DOT" value={recruiter.dot_number} />
        <Row label="MC" value={recruiter.mc_number} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onApprove} disabled={isPending}>
          <CheckCircle2 className="h-4 w-4" /> Approve
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={isPending}>
          <XCircle className="h-4 w-4" /> Reject
        </Button>
        <Button size="sm" variant="destructive" onClick={onSuspend} disabled={isPending}>
          <Ban className="h-4 w-4" /> Suspend
        </Button>
        <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Admin only
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
        {label}
      </span>
      <span className="text-foreground truncate">{value || '—'}</span>
    </div>
  );
}
