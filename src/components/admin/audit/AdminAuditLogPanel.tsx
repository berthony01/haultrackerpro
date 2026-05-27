import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollText, RefreshCw, Search, ChevronDown, ChevronRight } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type AuditRow = Tables<'admin_audit_log'>;

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'group:recruiter', label: 'Recruiter actions' },
  { value: 'group:opportunity', label: 'Opportunity actions' },
  { value: 'group:other', label: 'Other' },
  { value: 'recruiter.approve', label: 'recruiter.approve' },
  { value: 'recruiter.reject', label: 'recruiter.reject' },
  { value: 'recruiter.suspend', label: 'recruiter.suspend' },
  { value: 'opportunity.approve', label: 'opportunity.approve' },
  { value: 'opportunity.reject', label: 'opportunity.reject' },
  { value: 'opportunity.flag', label: 'opportunity.flag' },
  { value: 'opportunity.remove', label: 'opportunity.remove' },
];

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

function short(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function metaObj(row: AuditRow): Record<string, unknown> {
  return (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function targetLabel(row: AuditRow): string {
  const m = metaObj(row);
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : null);
  if (row.action.startsWith('recruiter.')) {
    const name = str('recruiter_name') || str('company_name') || str('recruiter_email');
    if (name) return `Recruiter: ${name}`;
    const id = str('recruiter_profile_id');
    return `Recruiter profile: ${short(id)}`;
  }
  if (row.action.startsWith('opportunity.')) {
    const name = str('title') || str('company_name');
    if (name) return `Opportunity: ${name}`;
    const id = str('opportunity_id');
    return `Opportunity: ${short(id)}`;
  }
  return short(row.target_user_id);
}

function classify(action: string): 'recruiter' | 'opportunity' | 'other' {
  if (action.startsWith('recruiter.')) return 'recruiter';
  if (action.startsWith('opportunity.')) return 'opportunity';
  return 'other';
}

export function AdminAuditLogPanel() {
  const { isAdmin } = useAdmin();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['admin_audit_log'],
    enabled: isAdmin,
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = query.data ?? [];

  const summary = useMemo(() => {
    let recruiter = 0, opportunity = 0, other = 0;
    for (const r of rows) {
      const c = classify(r.action);
      if (c === 'recruiter') recruiter++;
      else if (c === 'opportunity') opportunity++;
      else other++;
    }
    return {
      total: rows.length,
      recruiter,
      opportunity,
      other,
      last: rows[0]?.created_at ?? null,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (action !== 'all') {
        if (action === 'group:recruiter' && classify(r.action) !== 'recruiter') return false;
        if (action === 'group:opportunity' && classify(r.action) !== 'opportunity') return false;
        if (action === 'group:other' && classify(r.action) !== 'other') return false;
        if (!action.startsWith('group:') && action !== 'all' && r.action !== action) return false;
      }
      if (!q) return true;
      const hay = [
        r.action,
        r.admin_user_id,
        r.target_user_id ?? '',
        r.created_at,
        JSON.stringify(r.metadata ?? {}),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, action]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold">Admin Audit Logs</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Read-only history of admin moderation and system actions.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Mini label="Loaded" value={summary.total} />
        <Mini label="Recruiter actions" value={summary.recruiter} />
        <Mini label="Opportunity actions" value={summary.opportunity} />
        <Mini label="Other actions" value={summary.other} />
        <Mini
          label="Last action"
          value={summary.last ? new Date(summary.last).toLocaleString() : '—'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, target, metadata..."
            className="pl-8"
          />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : query.error ? (
        <Card className="p-6 border-destructive/40">
          <p className="text-sm text-destructive">
            Failed to load audit logs: {(query.error as Error).message}
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-border/60">
          <p className="text-sm text-muted-foreground">No audit logs found.</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-border/60">
          <p className="text-sm text-muted-foreground">No audit logs match your filters.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const m = metaObj(r);
            const source = typeof m.source === 'string' ? (m.source as string) : null;
            const isOpen = expanded.has(r.id);
            return (
              <Card key={r.id} className="p-3 border-border/60 bg-card/60">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {r.action}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      {source && (
                        <Badge variant="secondary" className="text-[10px]">{source}</Badge>
                      )}
                    </div>
                    <p className="text-xs font-medium text-foreground mt-1 truncate">
                      {targetLabel(r)}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-1.5 text-[10px] text-muted-foreground font-mono">
                      <span>admin: {short(r.admin_user_id)}</span>
                      <span>target: {short(r.target_user_id)}</span>
                      <span>id: {short(r.id)}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => toggle(r.id)}>
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {isOpen ? 'Hide' : 'Details'}
                  </Button>
                </div>
                {isOpen && (
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
                    {r.metadata == null
                      ? 'No metadata.'
                      : JSON.stringify(redact(r.metadata), null, 2)}
                  </pre>
                )}
              </Card>
            );
          })}
        </div>
      )}
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
