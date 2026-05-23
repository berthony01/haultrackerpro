import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  CheckCircle2, XCircle, Ban, Eye, RefreshCw, Building2, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useAdminRecruiters,
  useRecruiterBillingSummary,
  type AdminRecruiter,
  type RecruiterFilter,
} from '@/hooks/admin/useAdminRecruiters';

const FILTERS: { value: RecruiterFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'all', label: 'All' },
];

export function AdminRecruitersPanel() {
  const [filter, setFilter] = useState<RecruiterFilter>('pending');
  const [detail, setDetail] = useState<AdminRecruiter | null>(null);
  const { recruiters, isLoading, refetch, approve, reject, suspend } =
    useAdminRecruiters(filter);
  const billingSummary = useRecruiterBillingSummary();

  const busy = approve.isPending || reject.isPending || suspend.isPending;

  const run = (label: string, id: string, fn: typeof approve) => {
    if (!confirm(`${label} this recruiter?`)) return;
    fn.mutate(id, {
      onSuccess: () => toast.success(`Recruiter ${label.toLowerCase()}`),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-4">
      {/* Billing summary */}
      <Card className="p-4 border-border/60 bg-card/60">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-bold">Recruiter Billing Summary</p>
        </div>
        {billingSummary.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : billingSummary.data ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
            <Mini label="Total" value={billingSummary.data.total} />
            <Mini label="Active" value={billingSummary.data.active} />
            <Mini label="Past Due" value={billingSummary.data.past_due} />
            <Mini label="Canceled" value={billingSummary.data.canceled} />
            <Mini label="Inactive" value={billingSummary.data.inactive} />
            <Mini label="Starter" value={billingSummary.data.starter} />
            <Mini label="Growth" value={billingSummary.data.growth} />
            <Mini label="Fleet" value={billingSummary.data.fleet} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No billing data.</p>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? 'default' : 'outline'}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : recruiters.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-border/60">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Building2 className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No recruiters in this view.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {recruiters.map((r) => (
            <Card key={r.id} className="p-4 border-border/60 bg-card/60">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold text-foreground truncate">
                      {r.recruiter_name}
                    </h3>
                    <Badge variant="outline" className="capitalize">
                      {r.verification_status}
                    </Badge>
                    <Badge
                      variant={r.status === 'suspended' ? 'destructive' : 'secondary'}
                      className="capitalize"
                    >
                      {r.status}
                    </Badge>
                    {r.billing && (
                      <Badge variant="outline" className="capitalize">
                        Billing: {r.billing.plan}/{r.billing.status}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{r.company_name}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <Mini label="Email" value={r.recruiter_email ?? '—'} />
                    <Mini label="Phone" value={r.recruiter_phone ?? '—'} />
                    <Mini label="DOT" value={r.dot_number ?? '—'} />
                    <Mini label="MC" value={r.mc_number ?? '—'} />
                    <Mini label="Active opps" value={r.active_opportunity_count ?? 0} />
                    <Mini
                      label="Capacity"
                      value={r.billing?.active_opportunity_limit ?? 0}
                    />
                    <Mini
                      label="Created"
                      value={new Date(r.created_at).toLocaleDateString()}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:flex-col lg:w-40">
                  <Button size="sm" variant="outline" onClick={() => setDetail(r)}>
                    <Eye className="h-4 w-4" /> Profile
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => run('Approve', r.id, approve)}
                    disabled={busy}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run('Reject', r.id, reject)}
                    disabled={busy}
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => run('Suspend', r.id, suspend)}
                    disabled={busy}
                  >
                    <Ban className="h-4 w-4" /> Suspend
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>{detail.recruiter_name}</SheetTitle>
                <SheetDescription>{detail.company_name}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <KV k="Email" v={detail.recruiter_email ?? '—'} />
                <KV k="Phone" v={detail.recruiter_phone ?? '—'} />
                <KV k="DOT" v={detail.dot_number ?? '—'} />
                <KV k="MC" v={detail.mc_number ?? '—'} />
                <KV k="Company phone" v={detail.company_phone ?? '—'} />
                <KV k="Website" v={detail.company_website ?? '—'} />
                <KV
                  k="Address"
                  v={[detail.company_address, detail.company_city, detail.company_state]
                    .filter(Boolean)
                    .join(', ') || '—'}
                />
                <KV k="Hiring states" v={(detail.hiring_states ?? []).join(', ') || '—'} />
                <KV k="Equipment" v={(detail.equipment_types ?? []).join(', ') || '—'} />
                <KV k="Driver types" v={(detail.driver_types_hired ?? []).join(', ') || '—'} />
                <KV k="Verification" v={detail.verification_status} />
                <KV k="Status" v={detail.status} />
                <KV
                  k="Verified"
                  v={detail.verified_at ? new Date(detail.verified_at).toLocaleString() : '—'}
                />
                <KV k="Created" v={new Date(detail.created_at).toLocaleString()} />
                <KV k="Active opportunities" v={String(detail.active_opportunity_count ?? 0)} />
                {detail.billing && (
                  <>
                    <KV k="Billing plan" v={detail.billing.plan} />
                    <KV k="Billing status" v={detail.billing.status} />
                    <KV k="Capacity" v={String(detail.billing.active_opportunity_limit)} />
                    <KV
                      k="Period end"
                      v={detail.billing.current_period_end
                        ? new Date(detail.billing.current_period_end).toLocaleDateString()
                        : '—'}
                    />
                  </>
                )}
              </div>
              {detail.admin_notes && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
                    Admin notes
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {detail.admin_notes}
                  </p>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 px-2 py-1.5 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-foreground font-bold truncate">{value}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-foreground font-medium truncate">{v}</div>
    </div>
  );
}
