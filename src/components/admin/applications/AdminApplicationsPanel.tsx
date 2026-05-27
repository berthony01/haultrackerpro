import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Inbox, MessageSquare, Search, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useAdminApplications,
  useAdminContactRequests,
  type AdminApplicationRow,
  type AdminContactRequestRow,
} from '@/hooks/admin/useAdminApplications';

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function preview(text: string | null | undefined, n = 140): string {
  if (!text) return '';
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function classifyApp(status: string): 'pending' | 'approved' | 'rejected' | 'other' {
  const s = (status || '').toLowerCase();
  if (['new', 'pending', 'open', 'submitted'].includes(s)) return 'pending';
  if (['approved', 'accepted', 'active', 'hired', 'contacted'].includes(s)) return 'approved';
  if (['rejected', 'declined', 'denied', 'withdrawn'].includes(s)) return 'rejected';
  return 'other';
}

function classifyCR(status: string): 'pending' | 'approved' | 'rejected' | 'responded' | 'other' {
  const s = (status || '').toLowerCase();
  if (['pending', 'open', 'new', 'requested'].includes(s)) return 'pending';
  if (['approved', 'accepted'].includes(s)) return 'approved';
  if (['declined', 'rejected', 'denied'].includes(s)) return 'rejected';
  if (['responded'].includes(s)) return 'responded';
  return 'other';
}

const APP_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending / Open' },
  { value: 'approved', label: 'Approved / Accepted' },
  { value: 'rejected', label: 'Rejected / Declined' },
  { value: 'other', label: 'Other' },
];

const CR_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending / Open' },
  { value: 'approved', label: 'Approved / Accepted' },
  { value: 'responded', label: 'Responded' },
  { value: 'rejected', label: 'Rejected / Declined' },
  { value: 'other', label: 'Other' },
];

export function AdminApplicationsPanel() {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h2 className="text-base font-bold">Recruiter Applications</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          View driver interest, applications, and contact request activity across recruiter opportunities.
          Read-only.
        </p>
      </div>

      <Tabs defaultValue="apps">
        <TabsList>
          <TabsTrigger value="apps">
            <Inbox className="h-4 w-4 mr-1" /> Opportunity Applications
          </TabsTrigger>
          <TabsTrigger value="contact">
            <MessageSquare className="h-4 w-4 mr-1" /> Contact Requests
          </TabsTrigger>
        </TabsList>
        <TabsContent value="apps" className="space-y-3">
          <ApplicationsSection />
        </TabsContent>
        <TabsContent value="contact" className="space-y-3">
          <ContactRequestsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-foreground font-bold text-sm truncate">{value}</div>
    </div>
  );
}

function ApplicationsSection() {
  const query = useAdminApplications();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = query.data ?? [];

  const now = Date.now();
  const summary = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0, other = 0, last7 = 0;
    for (const r of rows) {
      const c = classifyApp(r.status);
      if (c === 'pending') pending++;
      else if (c === 'approved') approved++;
      else if (c === 'rejected') rejected++;
      else other++;
      if (now - new Date(r.created_at).getTime() <= 7 * 86400000) last7++;
    }
    return { total: rows.length, pending, approved, rejected, other, last7 };
  }, [rows, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && classifyApp(r.status) !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        r.id, r.status, r.driver_user_id, r.recruiter_id, r.opportunity_id,
        r.opportunity?.title ?? '', r.opportunity?.company_name ?? '',
        r.recruiter?.recruiter_name ?? '', r.recruiter?.recruiter_email ?? '',
        r.recruiter?.company_name ?? '', r.message ?? '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, statusFilter]);

  const toggle = (id: string) => setExpanded((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
          Loaded Activity Summary (based on latest {rows.length} applications)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Mini label="Loaded" value={summary.total} />
          <Mini label="Last 7d" value={summary.last7} />
          <Mini label="Pending / Open" value={summary.pending} />
          <Mini label="Approved / Accepted" value={summary.approved} />
          <Mini label="Rejected / Declined" value={summary.rejected} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications, recruiters, companies, opportunities..."
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {APP_FILTERS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ApplicationsList
        isLoading={query.isLoading}
        error={query.error as Error | null}
        rows={rows}
        filtered={filtered}
        expanded={expanded}
        onToggle={toggle}
      />
    </div>
  );
}

function ApplicationsList({
  isLoading, error, rows, filtered, expanded, onToggle,
}: {
  isLoading: boolean;
  error: Error | null;
  rows: AdminApplicationRow[];
  filtered: AdminApplicationRow[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }
  if (error) {
    return (
      <Card className="p-6 border-destructive/40">
        <p className="text-sm text-destructive">Failed to load applications: {error.message}</p>
      </Card>
    );
  }
  if (rows.length === 0) {
    return <Card className="p-10 text-center border-dashed border-border/60">
      <p className="text-sm text-muted-foreground">No applications found.</p>
    </Card>;
  }
  if (filtered.length === 0) {
    return <Card className="p-10 text-center border-dashed border-border/60">
      <p className="text-sm text-muted-foreground">No applications match your filters.</p>
    </Card>;
  }
  return (
    <div className="space-y-2">
      {filtered.map((r) => {
        const isOpen = expanded.has(r.id);
        return (
          <Card key={r.id} className="p-3 border-border/60 bg-card/60">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{r.status}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  {r.opportunity?.admin_review_status && (
                    <Badge variant="secondary" className="text-[10px]">
                      review: {r.opportunity.admin_review_status}
                    </Badge>
                  )}
                  {r.opportunity?.status && (
                    <Badge variant="secondary" className="text-[10px]">
                      opp: {r.opportunity.status}
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium text-foreground mt-1 truncate">
                  {r.opportunity?.title || '(untitled opportunity)'}
                  {r.opportunity?.company_name ? ` — ${r.opportunity.company_name}` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Recruiter:{' '}
                  {r.recruiter?.recruiter_name || r.recruiter?.company_name || '—'}
                  {r.recruiter?.recruiter_email ? ` · ${r.recruiter.recruiter_email}` : ''}
                </p>
                {r.message && (
                  <p className="text-[11px] text-muted-foreground mt-1 italic break-words">
                    “{preview(r.message)}”
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-1.5 text-[10px] text-muted-foreground font-mono">
                  <span>driver: {shortId(r.driver_user_id)}</span>
                  <span>app: {shortId(r.id)}</span>
                  <span>opp: {shortId(r.opportunity_id)}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onToggle(r.id)}>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {isOpen ? 'Hide' : 'Details'}
              </Button>
            </div>
            {isOpen && (
              <div className="mt-2 rounded-md bg-muted/40 p-2 text-[11px] font-mono space-y-1">
                <div>application_id: {r.id}</div>
                <div>opportunity_id: {r.opportunity_id}</div>
                <div>recruiter_id: {r.recruiter_id}</div>
                <div>driver_user_id: {r.driver_user_id}</div>
                <div>application_type: {r.application_type}</div>
                <div>status: {r.status}</div>
                <div>created_at: {r.created_at}</div>
                <div>updated_at: {r.updated_at}</div>
                {r.recruiter && (
                  <div>
                    recruiter verification: {r.recruiter.verification_status ?? '—'} · status: {r.recruiter.status ?? '—'}
                  </div>
                )}
                {r.message && (
                  <div className="whitespace-pre-wrap break-words">
                    message: {r.message}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ContactRequestsSection() {
  const query = useAdminContactRequests();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = query.data ?? [];

  const now = Date.now();
  const summary = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0, responded = 0, other = 0, last7 = 0;
    for (const r of rows) {
      const c = classifyCR(r.status);
      if (c === 'pending') pending++;
      else if (c === 'approved') approved++;
      else if (c === 'rejected') rejected++;
      else if (c === 'responded') responded++;
      else other++;
      if (now - new Date(r.created_at).getTime() <= 7 * 86400000) last7++;
    }
    const respondedTotal = rows.filter((r) => r.responded_at).length;
    return { total: rows.length, pending, approved, rejected, responded, other, last7, respondedTotal };
  }, [rows, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && classifyCR(r.status) !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        r.id, r.status, r.driver_user_id, r.recruiter_user_id, r.application_id,
        r.opportunity?.title ?? '', r.opportunity?.company_name ?? '',
        r.recruiter?.recruiter_name ?? '', r.recruiter?.recruiter_email ?? '',
        r.recruiter?.company_name ?? '', r.driver_note ?? '', r.recruiter_note ?? '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, statusFilter]);

  const toggle = (id: string) => setExpanded((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
          Loaded Activity Summary (based on latest {rows.length} contact requests)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Mini label="Loaded" value={summary.total} />
          <Mini label="Last 7d" value={summary.last7} />
          <Mini label="Pending / Open" value={summary.pending} />
          <Mini label="Approved / Accepted" value={summary.approved} />
          <Mini label="Responded (any)" value={summary.respondedTotal} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications, recruiters, companies, opportunities..."
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CR_FILTERS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ContactRequestsList
        isLoading={query.isLoading}
        error={query.error as Error | null}
        rows={rows}
        filtered={filtered}
        expanded={expanded}
        onToggle={toggle}
      />
    </div>
  );
}

function ContactRequestsList({
  isLoading, error, rows, filtered, expanded, onToggle,
}: {
  isLoading: boolean;
  error: Error | null;
  rows: AdminContactRequestRow[];
  filtered: AdminContactRequestRow[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }
  if (error) {
    return (
      <Card className="p-6 border-destructive/40">
        <p className="text-sm text-destructive">Failed to load contact requests: {error.message}</p>
      </Card>
    );
  }
  if (rows.length === 0) {
    return <Card className="p-10 text-center border-dashed border-border/60">
      <p className="text-sm text-muted-foreground">No contact requests found.</p>
    </Card>;
  }
  if (filtered.length === 0) {
    return <Card className="p-10 text-center border-dashed border-border/60">
      <p className="text-sm text-muted-foreground">No contact requests match your filters.</p>
    </Card>;
  }
  return (
    <div className="space-y-2">
      {filtered.map((r) => {
        const isOpen = expanded.has(r.id);
        return (
          <Card key={r.id} className="p-3 border-border/60 bg-card/60">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{r.status}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  {r.responded_at && (
                    <Badge variant="secondary" className="text-[10px]">
                      responded {new Date(r.responded_at).toLocaleDateString()}
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium text-foreground mt-1 truncate">
                  {r.opportunity?.title || '(untitled opportunity)'}
                  {r.opportunity?.company_name ? ` — ${r.opportunity.company_name}` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Recruiter:{' '}
                  {r.recruiter?.recruiter_name || r.recruiter?.company_name || '—'}
                  {r.recruiter?.recruiter_email ? ` · ${r.recruiter.recruiter_email}` : ''}
                </p>
                {r.recruiter_note && (
                  <p className="text-[11px] text-muted-foreground mt-1 break-words">
                    <span className="font-semibold">Recruiter note:</span> “{preview(r.recruiter_note)}”
                  </p>
                )}
                {r.driver_note && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 break-words">
                    <span className="font-semibold">Driver note:</span> “{preview(r.driver_note)}”
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-1.5 text-[10px] text-muted-foreground font-mono">
                  <span>driver: {shortId(r.driver_user_id)}</span>
                  <span>recruiter-user: {shortId(r.recruiter_user_id)}</span>
                  <span>request: {shortId(r.id)}</span>
                  <span>app: {shortId(r.application_id)}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onToggle(r.id)}>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {isOpen ? 'Hide' : 'Details'}
              </Button>
            </div>
            {isOpen && (
              <div className="mt-2 rounded-md bg-muted/40 p-2 text-[11px] font-mono space-y-1">
                <div>request_id: {r.id}</div>
                <div>application_id: {r.application_id}</div>
                <div>driver_user_id: {r.driver_user_id}</div>
                <div>recruiter_user_id: {r.recruiter_user_id}</div>
                <div>status: {r.status}</div>
                <div>created_at: {r.created_at}</div>
                <div>updated_at: {r.updated_at}</div>
                <div>responded_at: {r.responded_at ?? '—'}</div>
                {r.opportunity && (
                  <div>opportunity: {r.opportunity.title ?? '—'} · {r.opportunity.company_name ?? '—'}</div>
                )}
                {r.recruiter && (
                  <div>
                    recruiter verification: {r.recruiter.verification_status ?? '—'} · status: {r.recruiter.status ?? '—'}
                  </div>
                )}
                {r.recruiter_note && (
                  <div className="whitespace-pre-wrap break-words">recruiter_note: {r.recruiter_note}</div>
                )}
                {r.driver_note && (
                  <div className="whitespace-pre-wrap break-words">driver_note: {r.driver_note}</div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
