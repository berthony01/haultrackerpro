/**
 * Phase RC-1H — recruiter STAFF reports surface.
 *
 * Staff-only. Mounts NO owner surface: it does not import the owner
 * `RecruiterReportsPanel`, `useRecruiterReportData`, `useRecruiterProfile`,
 * `useRecruiterBilling`, any Agency hook, any billing/upgrade/checkout UI, or
 * any settlement/referral/application/contract operational hook.
 *
 * Fail-closed: without `canViewReports` nothing is fetched or rendered.
 * Export controls require BOTH `canViewReports` and `canExportReports`, and
 * every export re-fetches a fresh export-authorized payload from the database.
 * No plan, billing, subscription, entitlement-source or upgrade language is
 * ever displayed here.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  FileText,
  Download,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { useRecruiterStaffReportData } from '@/hooks/recruiter/useRecruiterStaffReportData';
import {
  aggregateRecruiterReport,
  REPORT_TYPE_LABEL,
  type RecruiterReportType,
  type RecruiterReportRange,
} from '@/lib/recruiterReports/aggregator';
import { buildRecruiterReportCSV, downloadCSV } from '@/lib/recruiterReports/csv';
import { buildRecruiterReportPDF, downloadBlob } from '@/lib/recruiterReports/pdf';

interface Props {
  recruiterId: string;
  companyName: string;
  canViewReports: boolean;
  canExportReports: boolean;
  onBack?: () => void;
}

const today = () => format(new Date(), 'yyyy-MM-dd');

const presets: { label: string; from: string; to: string }[] = [
  { label: 'Last 7 days', from: format(subDays(new Date(), 7), 'yyyy-MM-dd'), to: today() },
  { label: 'Last 30 days', from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: today() },
  {
    label: 'This month',
    from: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    to: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  },
];

const fmtDisplay = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${m}/${d}/${y}` : iso;
};

const labelStatus = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function RecruiterStaffReportsPanel({
  recruiterId,
  companyName,
  canViewReports,
  canExportReports,
  onBack,
}: Props) {
  const [from, setFrom] = useState<string>(presets[1].from);
  const [to, setTo] = useState<string>(presets[1].to);
  const [type, setType] = useState<RecruiterReportType>('activity');
  const [fmt, setFmt] = useState<'pdf' | 'csv'>('pdf');
  const [busy, setBusy] = useState(false);

  const canView = canViewReports === true;
  const canExport = canView && canExportReports === true;
  const invalidRange = !from || !to || from > to;

  const range: RecruiterReportRange = useMemo(
    () => ({ from, to, label: `${from} to ${to}` }),
    [from, to],
  );

  const { data, isLoading, isError, refetch, loadExportData } = useRecruiterStaffReportData({
    recruiterId,
    range: invalidRange ? null : range,
    canViewReports: canView,
    canExportReports: canExport,
  });

  const aggregate = useMemo(
    () => (canView && data ? aggregateRecruiterReport(data) : null),
    [canView, data],
  );
  const isEmpty = !!aggregate && aggregate.isEmpty;

  const backButton = onBack ? (
    <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
      <ArrowLeft className="h-4 w-4" /> Back
    </Button>
  ) : null;

  // Fail closed.
  if (!canView) {
    return (
      <div className="space-y-4" data-testid="recruiter-staff-reports-unavailable">
        {backButton}
        <Card>
          <CardHeader>
            <CardTitle>Reports</CardTitle>
            <CardDescription>
              Reporting is not available for your workspace access.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const generate = async () => {
    if (!canExport) return;
    if (invalidRange) {
      toast.error('Pick a valid date range');
      return;
    }
    setBusy(true);
    try {
      // Always re-authorize through the export RPC — never reuse the cached
      // view payload as the export authorization path.
      const exportInput = await loadExportData();
      if (!exportInput) {
        toast.error('Report export is not available');
        return;
      }
      const exportAggregate = aggregateRecruiterReport(exportInput);
      if (exportAggregate.isEmpty) {
        toast.error('No recruiter activity in this range');
        return;
      }
      const stamp = format(new Date(), 'yyyyMMdd-HHmm');
      const baseName = `haultrackerpro-recruiter-${type}-${stamp}`;
      if (fmt === 'csv') {
        downloadCSV(`${baseName}.csv`, buildRecruiterReportCSV(type, exportAggregate));
      } else {
        downloadBlob(`${baseName}.pdf`, await buildRecruiterReportPDF(type, exportAggregate));
      }
      toast.success(`${REPORT_TYPE_LABEL[type]} ready`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="recruiter-staff-reports-panel">
      {backButton}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle>Workspace Reports</CardTitle>
          </div>
          <CardDescription>
            Activity and pipeline reporting for {companyName}. Recruiter-owned workspace
            data only — no driver financial, load, expense, fuel, profit, or tax data.
          </CardDescription>
          <p className="text-xs text-muted-foreground pt-1">
            Showing data for{' '}
            <span className="font-medium text-foreground">
              {fmtDisplay(from)} – {fmtDisplay(to)}
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-rep-from">From</Label>
              <Input
                id="staff-rep-from"
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-rep-to">To</Label>
              <Input
                id="staff-rep-to"
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
              />
            </div>
          </div>

          {invalidRange && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-warning" />
              <span>Pick a valid date range — "From" must be on or before "To".</span>
            </div>
          )}

          {isLoading && !invalidRange && (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <div className="h-3 rounded bg-muted/40 animate-pulse w-2/3" />
              <div className="h-3 rounded bg-muted/40 animate-pulse w-1/2" />
              <div className="h-3 rounded bg-muted/40 animate-pulse w-3/4" />
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
                <span>Reports are unavailable right now.</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                className="gap-1.5 shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          )}

          {!isLoading && !isError && isEmpty && !invalidRange && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-4 text-sm">
              <div className="flex items-start gap-2">
                <Inbox className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No recruiter activity in this range.
                </p>
              </div>
            </div>
          )}

          {aggregate && !isEmpty && !invalidRange && (
            <div className="space-y-4" data-testid="recruiter-staff-report-preview">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Executive summary
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['Active opportunities', aggregate.kpis.activeOpportunities],
                    ['Applications', aggregate.kpis.totalApplications],
                    ['Interviews', aggregate.kpis.interviews],
                    ['Offers sent', aggregate.kpis.offersSent],
                    ['Hired', aggregate.kpis.hired],
                    ['Rejected', aggregate.kpis.rejected],
                    ['Withdrawn', aggregate.kpis.withdrawn],
                    ['Contact requests', aggregate.contactRequests.total],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-md border border-border/60 bg-card/60 p-3"
                    >
                      <p className="text-lg font-bold text-foreground">{String(value)}</p>
                      <p className="text-[11px] text-muted-foreground">{String(label)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {type === 'activity' ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ['Applications by status', aggregate.applicationsByStatus],
                    ['Contact requests by status', aggregate.contactRequests.byStatus],
                    ['Contract status', aggregate.contractStatusSummary],
                  ].map(([label, rows]) => (
                    <div key={String(label)}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {String(label)}
                      </p>
                      <ul className="mt-2 space-y-1 text-sm">
                        {(rows as Array<{ status: string; count: number }>).length === 0 && (
                          <li className="text-muted-foreground">—</li>
                        )}
                        {(rows as Array<{ status: string; count: number }>).map(r => (
                          <li key={r.status} className="flex justify-between gap-3">
                            <span className="text-muted-foreground">
                              {labelStatus(r.status)}
                            </span>
                            <span className="font-medium text-foreground">{r.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Pipeline by opportunity
                  </p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {aggregate.pipeline.slice(0, 10).map(p => (
                      <li
                        key={p.opportunityId}
                        className="rounded-md border border-border/60 bg-card/60 p-3"
                      >
                        <p className="font-medium text-foreground break-words">{p.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {labelStatus(p.status)} · {p.applications} applications ·{' '}
                          {p.interviews} interviews · {p.offers} offers · {p.hired} hired ·{' '}
                          {p.contractBlocked} contract-blocked
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Report type</Label>
              <Select value={type} onValueChange={v => setType(v as RecruiterReportType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">Recruiter Activity Report</SelectItem>
                  <SelectItem value="pipeline">Recruiter Pipeline Report</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canExport && (
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={fmt} onValueChange={v => setFmt(v as 'pdf' | 'csv')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {canExport && (
            <Button
              onClick={generate}
              disabled={busy || isLoading || isError || invalidRange}
              data-testid="staff-report-export"
              className="gap-2 w-full sm:w-auto"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Generate &amp; download
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground">
            Generated by HaulTrackerPro.com — recruiter-owned data only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
