import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ExternalLink, RefreshCw, FileText, Shield, Archive, Clock, NotebookPen } from "lucide-react";
import { toast } from "sonner";

type RiskTier = "low" | "medium" | "high" | "severe" | null;

interface ContractRow {
  id: string;
  status: string;
  risk_score: number | null;
  risk_tier: RiskTier;
  title: string | null;
  created_at: string;
  updated_at: string;
  recruiter: { id: string; company_name: string; contact_email?: string | null } | null;
  driver: { id: string; email: string; display_name?: string | null } | null;
  opportunity: { id: string; title: string; company_name: string } | null;
  current_version: {
    id: string;
    version_number: number;
    uploaded_at: string | null;
    parse_status: string;
    upload_status: string;
    file_name: string;
    page_count: number | null;
  } | null;
  ai_review: { id: string; summary: string | null; risk_tier: RiskTier; risk_score: number | null; top_flags: any[]; created_at: string } | null;
  driver_review: { id: string; decision: string; note: string | null; created_at: string } | null;
}

interface ContractDetail {
  contract: any;
  versions: any[];
  reviews: any[];
  clauses: any[];
  audit: any[];
  recruiter: any;
  driver: any;
  opportunity: any;
  current_ai_review: {
    id: string;
    version_id: string;
    summary: string | null;
    risk_tier: RiskTier;
    risk_score: number | null;
    top_flags: any[];
    created_at: string;
  } | null;
}

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "high_risk", label: "High / severe risk" },
  { value: "rejected", label: "Rejected" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "missing_ai_review", label: "Missing AI review" },
  { value: "failed_parse", label: "Failed parse" },
];

function tierBadgeVariant(tier: RiskTier): "default" | "secondary" | "destructive" | "outline" {
  if (tier === "severe" || tier === "high") return "destructive";
  if (tier === "medium") return "default";
  if (tier === "low") return "secondary";
  return "outline";
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "rejected" || status === "expired") return "destructive";
  if (status === "approved" || status === "signed") return "default";
  if (status === "changes_requested") return "outline";
  return "secondary";
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

async function adminFetch(action: string, params?: Record<string, string>) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) return null;
  const qp = new URLSearchParams({ action, ...(params || {}) });
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contract-admin?${qp}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function adminPost(action: string, body: unknown) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) return null;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contract-admin?action=${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { error: j?.error || `HTTP ${res.status}` };
  }
  return res.json();
}

export function AdminContractsPanel() {
  const [filter, setFilter] = useState("all");
  const [recruiterFilter, setRecruiterFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const [confirmAction, setConfirmAction] = useState<{ kind: "archived" | "expired" } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { filter, limit: "100" };
    if (recruiterFilter) params.recruiter_id = recruiterFilter;
    if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
    if (dateTo) params.date_to = new Date(dateTo).toISOString();
    const data = await adminFetch("list-contracts", params);
    if (data?.contracts) {
      setRows(data.contracts);
      setTotal(data.total ?? data.contracts.length);
    } else {
      setRows([]);
      setTotal(0);
    }
    setLoading(false);
  }, [filter, recruiterFilter, dateFrom, dateTo]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    const data = await adminFetch("get-contract", { contract_id: id });
    setDetail(data || null);
    setDetailLoading(false);
  }, []);

  const handleViewFile = useCallback(async () => {
    if (!detail?.contract?.current_version_id) return;
    const res = await adminPost("view-file", { version_id: detail.contract.current_version_id });
    if (res?.signed_url) {
      window.open(res.signed_url, "_blank", "noopener,noreferrer");
    } else {
      toast.error(res?.error || "Could not open file");
    }
  }, [detail]);

  const handleAddNote = useCallback(async () => {
    if (!selectedId || !noteText.trim()) return;
    setNoteSaving(true);
    const res = await adminPost("add-note", { contract_id: selectedId, note: noteText.trim() });
    setNoteSaving(false);
    if (res?.ok) {
      toast.success("Note added");
      setNoteText("");
      setNoteOpen(false);
      openDetail(selectedId);
    } else {
      toast.error(res?.error || "Failed to add note");
    }
  }, [selectedId, noteText, openDetail]);

  const handleStatusAction = useCallback(async () => {
    if (!confirmAction || !selectedId) return;
    setActionLoading(true);
    const res = await adminPost(confirmAction.kind === "archived" ? "mark-archived" : "mark-expired", {
      contract_id: selectedId,
    });
    setActionLoading(false);
    if (res?.ok) {
      toast.success(`Marked ${confirmAction.kind}`);
      setConfirmAction(null);
      openDetail(selectedId);
      fetchList();
    } else {
      toast.error(res?.error || "Failed");
    }
  }, [confirmAction, selectedId, openDetail, fetchList]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-3">
      <Card className="shadow-card">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Contract Moderation
          </CardTitle>
          <Button size="sm" variant="outline" onClick={fetchList} disabled={loading} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger><SelectValue placeholder="Filter" /></SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="Recruiter ID (optional)"
              value={recruiterFilter}
              onChange={(e) => setRecruiterFilter(e.target.value)}
            />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {total} contract{total === 1 ? "" : "s"} · {Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ") || "—"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recruiter</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Opportunity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Driver decision</TableHead>
              <TableHead className="text-right">Ver</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">Loading...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No contracts match.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r.id)}>
                <TableCell className="text-xs">
                  <div className="font-medium">{r.recruiter?.company_name || "—"}</div>
                  <div className="text-muted-foreground truncate max-w-[180px]">{r.recruiter?.contact_email || ""}</div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{r.driver?.display_name || "—"}</div>
                  <div className="text-muted-foreground truncate max-w-[180px]">{r.driver?.email}</div>
                </TableCell>
                <TableCell className="text-xs truncate max-w-[200px]">{r.opportunity?.title || "—"}</TableCell>
                <TableCell><Badge variant={statusBadgeVariant(r.status)} className="text-xs whitespace-nowrap">{r.status}</Badge></TableCell>
                <TableCell>
                  {r.ai_review && r.ai_review.risk_tier ? (
                    <Badge variant={tierBadgeVariant(r.ai_review.risk_tier)} className="text-xs whitespace-nowrap">
                      {r.ai_review.risk_tier} {r.ai_review.risk_score != null ? `· ${Number(r.ai_review.risk_score).toFixed(0)}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs whitespace-nowrap">No AI review</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {r.driver_review ? (
                    <Badge variant="secondary" className="text-xs whitespace-nowrap">{r.driver_review.decision}</Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right text-xs">{r.current_version?.version_number ?? "—"}</TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap">{new Date(r.updated_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selectedId} onOpenChange={(o) => { if (!o) { setSelectedId(null); setDetail(null); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Contract detail</DialogTitle>
            <DialogDescription>Admin moderation view. AI findings are read-only.</DialogDescription>
          </DialogHeader>

          {detailLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-muted-foreground">Recruiter</div>
                <div>{detail.recruiter?.company_name || "—"} <span className="text-muted-foreground">({detail.recruiter?.contact_email})</span></div>
                <div className="text-muted-foreground">Driver</div>
                <div>{detail.driver?.display_name || detail.driver?.email || "—"}</div>
                <div className="text-muted-foreground">Opportunity</div>
                <div>{detail.opportunity?.title || "—"}</div>
                <div className="text-muted-foreground">Status</div>
                <div><Badge variant={statusBadgeVariant(detail.contract.status)} className="text-xs">{detail.contract.status}</Badge></div>
                <div className="text-muted-foreground">Risk (current version)</div>
                <div>
                  {detail.current_ai_review && detail.current_ai_review.risk_tier ? (
                    <Badge variant={tierBadgeVariant(detail.current_ai_review.risk_tier)} className="text-xs">
                      {detail.current_ai_review.risk_tier} · score {detail.current_ai_review.risk_score != null ? Number(detail.current_ai_review.risk_score).toFixed(0) : "—"}
                    </Badge>
                  ) : <span className="text-muted-foreground">No AI review on current version</span>}
                </div>
                <div className="text-muted-foreground">Created</div>
                <div>{fmtDate(detail.contract.created_at)}</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" onClick={handleViewFile} disabled={!detail.contract.current_version_id} className="gap-1">
                  <ExternalLink className="h-4 w-4" /> View file (signed URL)
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)} className="gap-1">
                  <NotebookPen className="h-4 w-4" /> Add note
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmAction({ kind: "archived" })} className="gap-1">
                  <Archive className="h-4 w-4" /> Mark archived
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmAction({ kind: "expired" })} className="gap-1">
                  <Clock className="h-4 w-4" /> Mark expired
                </Button>
              </div>

              {/* Versions */}
              <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Versions ({detail.versions.length})</h4>
                <div className="space-y-1">
                  {detail.versions.map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between rounded border border-border p-2 text-xs">
                      <div>
                        <span className="font-medium">v{v.version_number}</span>
                        <span className="text-muted-foreground"> · {v.file_name} · {v.upload_status} · parse:{v.parse_status}</span>
                      </div>
                      <span className="text-muted-foreground">{fmtDate(v.uploaded_at)}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* AI review */}
              <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">AI review (current version)</h4>
                {(() => {
                  const ai = detail.reviews.find((r: any) => r.reviewer_role === "ai" && r.version_id === detail.contract.current_version_id);
                  if (!ai) return <p className="text-xs text-muted-foreground">No AI review on current version.</p>;
                  const findings = (ai.ai_findings as any) || {};
                  return (
                    <div className="space-y-2 text-xs">
                      {ai.ai_summary && <p className="rounded bg-muted/40 p-2">{ai.ai_summary}</p>}
                      {Array.isArray(findings.top_flags) && findings.top_flags.length > 0 && (
                        <ul className="space-y-1">
                          {findings.top_flags.map((f: any, i: number) => (
                            <li key={i} className="flex gap-2">
                              <Badge variant={tierBadgeVariant((f.severity || "medium") as RiskTier)} className="text-[10px]">{f.severity || "info"}</Badge>
                              <span>{f.title || f.text || JSON.stringify(f)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </section>

              {/* Driver review */}
              <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Driver decision (current version)</h4>
                {(() => {
                  const drv = detail.reviews.find((r: any) => r.reviewer_role === "driver" && r.version_id === detail.contract.current_version_id);
                  if (!drv) return <p className="text-xs text-muted-foreground">No driver decision yet.</p>;
                  return (
                    <div className="text-xs space-y-1">
                      <div><Badge variant="secondary" className="text-xs">{drv.decision}</Badge> <span className="text-muted-foreground">{fmtDate(drv.created_at)}</span></div>
                      {drv.notes && <p className="rounded bg-muted/40 p-2">{drv.notes}</p>}
                    </div>
                  );
                })()}
              </section>

              {/* Clauses */}
              {detail.clauses.length > 0 && (
                <section>
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Clauses ({detail.clauses.length})</h4>
                  <div className="space-y-1">
                    {detail.clauses.slice(0, 20).map((c: any) => (
                      <div key={c.id} className="rounded border border-border p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant={tierBadgeVariant((c.severity || "info") as RiskTier)} className="text-[10px]">{c.severity}</Badge>
                          <span className="font-medium">{c.clause_type}</span>
                        </div>
                        {c.summary && <p className="mt-1 text-muted-foreground">{c.summary}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Audit */}
              <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Audit log ({detail.audit.length})</h4>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {detail.audit.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-xs rounded bg-muted/30 px-2 py-1">
                      <div>
                        <span className="font-medium">{a.action}</span>
                        {a.actor_role && <span className="text-muted-foreground"> · {a.actor_role}</span>}
                        {a.metadata?.note && <span className="text-muted-foreground"> · "{String(a.metadata.note).slice(0, 80)}"</span>}
                      </div>
                      <span className="text-muted-foreground whitespace-nowrap">{fmtDate(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add note dialog */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add admin note</DialogTitle>
            <DialogDescription>Notes are recorded in the contract audit log.</DialogDescription>
          </DialogHeader>
          <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Internal note..." rows={5} maxLength={4000} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button onClick={handleAddNote} disabled={noteSaving || noteText.trim().length < 2}>
              {noteSaving ? "Saving..." : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm archive/expire */}
      <AlertDialog open={!!confirmAction} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {confirmAction?.kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              This sets the contract status to <strong>{confirmAction?.kind}</strong>. The action is logged in the audit trail. This does not delete the contract or its versions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStatusAction} disabled={actionLoading}>
              {actionLoading ? "Working..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
