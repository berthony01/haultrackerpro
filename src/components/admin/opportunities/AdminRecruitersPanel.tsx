import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  CheckCircle2, XCircle, Ban, Eye, RefreshCw, Building2, ShieldCheck,
  Search, Copy, ExternalLink, Download,
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

type SortKey =
  | 'newest'
  | 'oldest'
  | 'company_az'
  | 'recruiter_az'
  | 'active_desc'
  | 'billing_plan'
  | 'verification';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'company_az', label: 'Company A–Z' },
  { value: 'recruiter_az', label: 'Recruiter A–Z' },
  { value: 'active_desc', label: 'Most active listings' },
  { value: 'billing_plan', label: 'Billing plan' },
  { value: 'verification', label: 'Verification status' },
];

const PLAN_ORDER: Record<string, number> = { starter: 1, growth: 2, fleet: 3 };

function recruiterMatches(r: AdminRecruiter, q: string): boolean {
  if (!q) return true;
  const hay = [
    r.recruiter_name,
    r.recruiter_email,
    r.recruiter_phone,
    r.company_name,
    r.company_phone,
    r.company_website,
    r.dot_number,
    r.mc_number,
    r.company_city,
    r.company_state,
    r.verification_status,
    r.status,
    r.billing?.plan,
    r.billing?.status,
  ]
    .filter(Boolean)
    .join(' \u0001 ')
    .toLowerCase();
  return hay.includes(q);
}

function isPriorityPlacement(b: AdminRecruiter['billing']): boolean {
  return !!b
    && ['growth', 'fleet'].includes(b.plan)
    && ['active', 'trialing'].includes(b.status); // trial-allowlist
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`);
  }
}

function safeWebsiteUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

const CSV_HEADERS = [
  'Recruiter Name', 'Recruiter Contact Email', 'Recruiter Phone', 'Company Name',
  'Company Phone', 'Company Website', 'DOT Number', 'MC Number',
  'Company Address', 'Company City', 'Company State', 'Hiring States',
  'Equipment Types', 'Driver Types Hired', 'Verification Status',
  'Account Status', 'Billing Plan', 'Billing Status', 'Priority Placement',
  'Active Opportunity Count', 'Verified At', 'Created At', 'Admin Notes',
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s = Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value);
  // Formula injection protection
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Escape quotes
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

function recruiterToCsvRow(r: AdminRecruiter): string {
  const priority = isPriorityPlacement(r.billing) ? 'Included' : 'Not included';
  const cells = [
    r.recruiter_name, r.recruiter_email, r.recruiter_phone, r.company_name,
    r.company_phone, r.company_website, r.dot_number, r.mc_number,
    r.company_address, r.company_city, r.company_state, r.hiring_states,
    r.equipment_types, r.driver_types_hired, r.verification_status,
    r.status, r.billing?.plan ?? '', r.billing?.status ?? '', priority,
    r.active_opportunity_count ?? 0,
    r.verified_at ? new Date(r.verified_at).toISOString() : '',
    r.created_at ? new Date(r.created_at).toISOString() : '',
    r.admin_notes,
  ];
  return cells.map(csvCell).join(',');
}

function downloadRecruitersCsv(rows: AdminRecruiter[], filter: string) {
  const csv = [CSV_HEADERS.map(csvCell).join(','), ...rows.map(recruiterToCsvRow)].join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `haultrackerpro-recruiters-${filter}-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


export function AdminRecruitersPanel() {
  const [filter, setFilter] = useState<RecruiterFilter>('pending');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? recruiters.filter((r) => recruiterMatches(r, q))
      : recruiters.slice();

    const sorted = filtered.slice().sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        case 'company_az':
          return (a.company_name ?? '').localeCompare(b.company_name ?? '');
        case 'recruiter_az':
          return (a.recruiter_name ?? '').localeCompare(b.recruiter_name ?? '');
        case 'active_desc':
          return (b.active_opportunity_count ?? 0) - (a.active_opportunity_count ?? 0);
        case 'billing_plan': {
          const ap = a.billing?.plan ? (PLAN_ORDER[a.billing.plan] ?? 99) : 999;
          const bp = b.billing?.plan ? (PLAN_ORDER[b.billing.plan] ?? 99) : 999;
          return ap - bp;
        }
        case 'verification':
          return (a.verification_status ?? '').localeCompare(b.verification_status ?? '');
        case 'newest':
        default:
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
      }
    });
    return sorted;
  }, [recruiters, search, sort]);

  const viewSummary = useMemo(() => {
    const s = {
      showing: visible.length,
      pending: 0,
      approved: 0,
      active: 0,
      suspended: 0,
      growth_fleet: 0,
      past_due: 0,
    };
    for (const r of visible) {
      if (r.verification_status === 'pending') s.pending++;
      if (r.verification_status === 'approved') s.approved++;
      if (r.status === 'active') s.active++;
      if (r.status === 'suspended' || r.verification_status === 'suspended') s.suspended++;
      if (r.billing && ['growth', 'fleet'].includes(r.billing.plan)) s.growth_fleet++;
      if (r.billing && r.billing.status === 'past_due') s.past_due++;
    }
    return s;
  }, [visible]);

  return (
    <div className="space-y-4">
      {/* Global billing summary */}
      <Card className="p-4 border-border/60 bg-card/60">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-bold">Recruiter Billing Summary</p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-auto">
            All recruiters
          </span>
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

      {/* Current view summary */}
      <Card className="p-4 border-border/60 bg-card/60">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-bold">Current View Summary</p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-auto">
            Filter: {filter}{search.trim() ? ' · search' : ''}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
          <Mini label="Showing" value={viewSummary.showing} />
          <Mini label="Pending" value={viewSummary.pending} />
          <Mini label="Approved" value={viewSummary.approved} />
          <Mini label="Active" value={viewSummary.active} />
          <Mini label="Suspended" value={viewSummary.suspended} />
          <Mini label="Growth/Fleet" value={viewSummary.growth_fleet} />
          <Mini label="Past Due" value={viewSummary.past_due} />
        </div>
      </Card>

      {/* Filters + actions */}
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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={visible.length === 0}
            onClick={() => {
              if (visible.length === 0) {
                toast.error('No recruiters to export');
                return;
              }
              try {
                downloadRecruitersCsv(visible, filter);
                toast.success(`Exported ${visible.length} recruiter${visible.length === 1 ? '' : 's'}`);
              } catch {
                toast.error('Could not export CSV');
              }
            }}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        CSV exports the current filtered/search result only.
      </p>

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recruiters, contact emails, companies, DOT, MC..."
            className="pl-8"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      ) : visible.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-border/60">
          <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No recruiters match your search.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const phone = r.recruiter_phone ?? r.company_phone ?? null;
            return (
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
                      <Mini label="Contact email" value={r.recruiter_email ?? '—'} />
                      <Mini label="Phone" value={r.recruiter_phone ?? '—'} />
                      <Mini label="DOT" value={r.dot_number ?? '—'} />
                      <Mini label="MC" value={r.mc_number ?? '—'} />
                      <Mini label="Active listings" value={r.active_opportunity_count ?? 0} />
                      <Mini
                        label="Priority placement"
                        value={isPriorityPlacement(r.billing) ? 'Included' : 'Not included'}
                      />
                      <Mini
                        label="Created"
                        value={new Date(r.created_at).toLocaleDateString()}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:flex-col lg:w-44">
                    <Button size="sm" variant="outline" onClick={() => setDetail(r)}>
                      <Eye className="h-4 w-4" /> Profile
                    </Button>
                    {r.recruiter_email && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(r.recruiter_email!, 'Contact email')}
                      >
                        <Copy className="h-4 w-4" /> Copy Contact Email

                      </Button>
                    )}
                    {phone && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(phone, 'Phone')}
                      >
                        <Copy className="h-4 w-4" /> Copy Phone
                      </Button>
                    )}
                    {r.company_website && (
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                      >
                        <a
                          href={safeWebsiteUrl(r.company_website)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" /> Website
                        </a>
                      </Button>
                    )}
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
            );
          })}
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
              <div className="flex flex-wrap gap-2 mt-3">
                {detail.recruiter_email && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(detail.recruiter_email!, 'Contact email')}
                  >
                    <Copy className="h-4 w-4" /> Copy Contact Email

                  </Button>
                )}
                {(detail.recruiter_phone ?? detail.company_phone) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copyToClipboard(
                        (detail.recruiter_phone ?? detail.company_phone)!,
                        'Phone',
                      )
                    }
                  >
                    <Copy className="h-4 w-4" /> Copy Phone
                  </Button>
                )}
                {detail.company_website && (
                  <Button size="sm" variant="outline" asChild>
                    <a
                      href={safeWebsiteUrl(detail.company_website)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" /> Website
                    </a>
                  </Button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <KV k="Contact email" v={detail.recruiter_email ?? '—'} />
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
                    <KV
                      k="Priority placement"
                      v={isPriorityPlacement(detail.billing) ? 'Included' : 'Not included'}
                    />
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
