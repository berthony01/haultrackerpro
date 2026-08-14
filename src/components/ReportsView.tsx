import { useMemo, useState } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { useLoadStops } from '@/hooks/useLoadStops';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useFuelLogs } from '@/hooks/useFuelLogs';
import { useAuth } from '@/hooks/useAuth';
import { getWeekSummaries, formatCurrency, formatNumber, exportToCSV, getCurrentMonthLoads, getEffectiveDate, weekStartDayToNumber } from '@/lib/loadUtils';
import { summarizeLoads, excludeCancelled, onlyCancelled, FINANCIAL_TOOLTIPS } from '@/lib/financialCalculations';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Download, FileText, FileSpreadsheet, Calendar, TrendingUp, Lock, Receipt, BarChart3, DollarSign, Ban, FileDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { parseISO, isWithinInterval, format } from 'date-fns';
import { toast } from 'sonner';
import { aggregateReport, REPORT_TYPE_LABELS, type ReportType } from '@/lib/reportAggregator';
import { buildReportCSV, downloadCSV } from '@/lib/reportCsv';
import { buildReportPdf, downloadPdfBlob } from '@/lib/reportPdf';
import { TAX_DISCLAIMER } from '@/lib/reportTax';

interface ReportsViewProps {
  loads: Load[];
  expenses?: Expense[];
  onNavigate?: (page: string) => void;
  isPro?: boolean;
  /**
   * Phase DA-1 — report settings of the account the report belongs to. When an
   * assistant is acting for a driver this MUST be the managed driver's safe
   * report settings, never the signed-in assistant's own settings.
   */
  settingsOverride?: Partial<Record<string, any>> | null;
  /**
   * Phase DA-1 — explicit export capability. Assistants without
   * `export_reports` may view but never download PDF / CSV / weekly CSV.
   */
  canExport?: boolean;
}


interface ExportRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  locked?: boolean;
}

function ExportRow({ icon, title, subtitle, onClick, disabled, locked }: ExportRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="premium-card p-4 w-full flex items-center gap-3 text-left transition-all duration-200 hover:border-primary/30 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
    >
      <div className="rounded-xl bg-primary/10 ring-1 ring-primary/20 p-2.5 text-primary shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{title}</p>
        <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
      </div>
      {locked ? (
        <Badge variant="outline" className="text-[9px] gap-0.5 border-primary/30 text-primary shrink-0">
          <Lock className="h-2 w-2" /> Pro
        </Badge>
      ) : (
        <Download className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

export function ReportsView({
  loads,
  expenses = [],
  onNavigate,
  isPro = false,
  settingsOverride = null,
  canExport = true,
}: ReportsViewProps) {
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { stops } = useLoadStops();
  const { settings: ownSettings } = useUserSettings();
  // Managed-driver settings win whenever provided (assistant acting mode).
  const settings: any = settingsOverride ?? ownSettings;
  const exportsAllowed = canExport && isPro;


  const companyMeta = {
    companyName: settings?.company_name ?? undefined,
    companyStartDate: settings?.company_start_date ?? undefined,
  };

  const filteredLoads = useMemo(() => loads.filter(l => {
    if (!dateRange.from && !dateRange.to) return true;
    const d = parseISO(getEffectiveDate(l));
    const start = dateRange.from ? parseISO(dateRange.from) : new Date(0);
    const end = dateRange.to ? parseISO(dateRange.to) : new Date('2099-12-31');
    return isWithinInterval(d, { start, end });
  }), [loads, dateRange]);

  const filteredExpenses = useMemo(() => expenses.filter(e => {
    if (!dateRange.from && !dateRange.to) return true;
    const d = parseISO(e.expense_date);
    const start = dateRange.from ? parseISO(dateRange.from) : new Date(0);
    const end = dateRange.to ? parseISO(dateRange.to) : new Date('2099-12-31');
    return isWithinInterval(d, { start, end });
  }), [expenses, dateRange]);

  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const summaries = useMemo(() => getWeekSummaries(filteredLoads, weekStartsOn), [filteredLoads, weekStartsOn]);

  const monthLoads = useMemo(() => getCurrentMonthLoads(loads), [loads]);
  const hasFilter = !!(dateRange.from || dateRange.to);

  const summary = useMemo(
    () => summarizeLoads(filteredLoads, filteredExpenses),
    [filteredLoads, filteredExpenses]
  );
  const cancelledLoads = useMemo(() => onlyCancelled(filteredLoads), [filteredLoads]);
  const actualPayTotal = useMemo(
    () => excludeCancelled(filteredLoads).reduce(
      (s, l) => s + (l.actual_pay_received != null ? Number(l.actual_pay_received) : 0),
      0,
    ),
    [filteredLoads],
  );

  // ── Report Center state ──────────────────────────────────────────────
  const { user } = useAuth();
  const { fuelLogs } = useFuelLogs();
  const [reportType, setReportType] = useState<ReportType>('full_profit');

  const aggregation = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return null;
    const range = { from: dateRange.from, to: dateRange.to, label: 'Selected Range', key: 'custom' as const };
    return aggregateReport({
      loads,
      expenses,
      fuelLogs,
      settings: settings ?? null,
      range,
      preparedFor:
        settings?.company_name ||
        (settingsOverride
          ? 'HaulTrackerPro Driver'
          : (user?.user_metadata as any)?.display_name || user?.email || 'HaulTrackerPro Driver'),
    });
  }, [dateRange.from, dateRange.to, loads, expenses, fuelLogs, settings, settingsOverride, user]);

  const handleDownload = (kind: 'pdf' | 'csv') => {
    if (!canExport) { toast.error('You do not have permission to export reports for this driver.'); return; }
    if (!isPro) { toast.error(`${kind.toUpperCase()} reports are a Pro feature. Upgrade to unlock.`); return; }
    if (!aggregation) { toast.error('Select a date range first.'); return; }
    if (aggregation.isEmpty) { toast.error('No data found in the selected date range.'); return; }

    try {
      const base = `haultrackerpro-${reportType.replace(/_/g, '-')}-${aggregation.range.from}-to-${aggregation.range.to}`;
      if (kind === 'pdf') downloadPdfBlob(`${base}.pdf`, buildReportPdf(reportType, aggregation));
      else downloadCSV(`${base}.csv`, buildReportCSV(reportType, aggregation));
      toast.success(`${kind.toUpperCase()} report downloaded.`);
    } catch (err) {
      console.error(err);
      toast.error(`Failed to generate ${kind.toUpperCase()}.`);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-label">Analytics Center</p>
        <h1 className="text-2xl font-black font-heading tracking-tight">Reports Center</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Download professional trucking reports for taxes, settlements, profit tracking, and business records.
        </p>
      </div>

      {/* Report Center: type + range + download */}
      <div className="premium-card p-4 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-label mb-2 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-primary" /> Report Type</p>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger className="h-10 rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REPORT_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-label mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-primary" /> Date Range</p>
            <DateRangeFilter currentRange={dateRange} onRangeChange={(from, to) => setDateRange({ from, to })} />
          </div>
        </div>

        {!canExport && (
          <div
            data-testid="reports-export-not-permitted"
            className="rounded-xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground"
          >
            You can view these reports, but you do not have permission to export them.
          </div>
        )}

        {canExport && !isPro && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
            <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">Upgrade to Pro to download reports</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upgrade to Pro to download professional PDF and CSV reports for taxes, settlements, and profit tracking.
              </p>
              {onNavigate && (
                <Button size="sm" className="mt-2 h-8 rounded-lg" onClick={() => onNavigate('upgrade')}>
                  Upgrade to Pro
                </Button>
              )}
            </div>
          </div>
        )}

        {aggregation?.isEmpty && (
          <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            No loads, expenses, or fuel logs were found for this date range.
          </div>
        )}

        {!aggregation && (
          <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            Select a preset or apply a custom date range to preview and download a report.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11 rounded-xl gap-2 font-bold" onClick={() => handleDownload('pdf')} disabled={!exportsAllowed || !aggregation || aggregation.isEmpty}>
            {!exportsAllowed && <Lock className="h-3.5 w-3.5" />}
            <FileDown className="h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" className="h-11 rounded-xl gap-2 font-bold" onClick={() => handleDownload('csv')} disabled={!exportsAllowed || !aggregation || aggregation.isEmpty}>
            {!exportsAllowed && <Lock className="h-3.5 w-3.5" />}
            <FileSpreadsheet className="h-4 w-4" /> Export CSV
          </Button>
        </div>


        <p className="text-[10px] text-muted-foreground/70">{TAX_DISCLAIMER}</p>
      </div>

      {/* Financial KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            <p className="text-label" title={FINANCIAL_TOOLTIPS.grossRevenue}>Gross Revenue</p>
          </div>
          <p className="text-xl font-mono font-black text-foreground whitespace-nowrap">{formatCurrency(summary.grossRevenue)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{summary.loadCount} loads · cancelled excluded</p>
        </div>
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <Receipt className="h-3.5 w-3.5" />
            </div>
            <p className="text-label">Total Expenses</p>
          </div>
          <p className="text-xl font-mono font-black text-foreground whitespace-nowrap">{formatCurrency(summary.expensesTotal)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{filteredExpenses.length} entries</p>
        </div>
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <p className="text-label" title={FINANCIAL_TOOLTIPS.netProfit}>Net Profit</p>
          </div>
          <p className={`text-xl font-mono font-black whitespace-nowrap ${summary.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
            {formatCurrency(summary.netProfit)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">{summary.marginPct.toFixed(1)}% margin</p>
        </div>
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <BarChart3 className="h-3.5 w-3.5" />
            </div>
            <p className="text-label">Total Miles</p>
          </div>
          <p className="text-xl font-mono font-black text-foreground whitespace-nowrap">{formatNumber(summary.totalMiles)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{formatNumber(summary.loadedMiles)} loaded · {formatNumber(summary.deadheadMiles)} DH</p>
        </div>
      </div>

      {/* Hidden E2E fixture — exposes Reports KPIs with stable testids for parity assertions. */}
      <div data-testid="reports-metrics" className="sr-only" aria-hidden="true">
        <span data-testid="reports-gross-revenue" data-value={summary.grossRevenue} />
        <span data-testid="reports-total-expenses" data-value={summary.expensesTotal} />
        <span data-testid="reports-net-profit" data-value={summary.netProfit} />
        <span data-testid="reports-net-rpm" data-value={summary.netRPM} />
        <span data-testid="reports-loaded-miles" data-value={summary.loadedMiles} />
        <span data-testid="reports-operating-miles" data-value={summary.totalMiles} />
        <span data-testid="reports-effective-rpm" data-value={summary.effectiveRPM} />
      </div>

      {/* Detailed Financial Breakdown */}
      <div className="premium-card p-4">
        <p className="text-label mb-3">Financial Breakdown</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs">
          <div>
            <p className="text-muted-foreground">Actual Pay Received</p>
            <p className="font-mono font-bold text-foreground">{formatCurrency(actualPayTotal)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pending Pay</p>
            <p className="font-mono font-bold text-foreground">{formatCurrency(summary.pendingPaymentEstimated)}</p>
            <p className="text-[10px] text-muted-foreground">{summary.pendingPaymentCount} loads</p>
          </div>
          <div>
            <p className="text-muted-foreground">Payment Difference</p>
            <p className={`font-mono font-bold ${summary.paymentDifferenceTotal >= 0 ? 'text-success' : 'text-warning'}`}>
              {summary.paymentDifferenceTotal >= 0 ? '+' : ''}{formatCurrency(summary.paymentDifferenceTotal)}
            </p>
            <p className="text-[10px] text-muted-foreground">{summary.underpaidCount} under · {summary.overpaidCount} over</p>
          </div>
          <div>
            <p className="text-muted-foreground" title={FINANCIAL_TOOLTIPS.contractRate}>Avg Contract Rate</p>
            <p className="font-mono font-bold text-foreground">${summary.avgContractRate.toFixed(2)}/mi</p>
          </div>
          <div>
            <p className="text-muted-foreground" title={FINANCIAL_TOOLTIPS.effectiveRPM}>Effective RPM</p>
            <p className="font-mono font-bold text-primary">${summary.effectiveRPM.toFixed(2)}/mi</p>
          </div>
          <div>
            <p className="text-muted-foreground" title={FINANCIAL_TOOLTIPS.netRPM}>Net RPM</p>
            <p className={`font-mono font-bold ${summary.netRPM >= 0 ? 'text-success' : 'text-destructive'}`}>
              ${summary.netRPM.toFixed(2)}/mi
            </p>
          </div>
          <div>
            <p className="text-muted-foreground" title={FINANCIAL_TOOLTIPS.costPerMile}>Cost / Mile</p>
            <p className="font-mono font-bold text-foreground">${summary.costPerMile.toFixed(2)}/mi</p>
          </div>
          <div>
            <p className="text-muted-foreground" title={FINANCIAL_TOOLTIPS.deadheadPct}>Deadhead %</p>
            <p className={`font-mono font-bold ${summary.deadheadPct < 15 ? 'text-success' : summary.deadheadPct > 30 ? 'text-destructive' : 'text-warning'}`}>
              {summary.deadheadPct.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Cancelled Loads</p>
            <p className="font-mono font-bold text-foreground">{summary.cancelledCount}</p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-3 pt-3 border-t border-border/40">
          Cancelled loads are excluded from Gross Revenue, Net Profit, RPM, and load counts.
        </p>
      </div>

      {/* Cancelled Loads Section */}
      {cancelledLoads.length > 0 && (
        <div className="premium-card p-4 border-destructive/20">
          <div className="flex items-center gap-2 mb-3">
            <Ban className="h-3.5 w-3.5 text-destructive" />
            <p className="text-label text-destructive">Cancelled Loads ({cancelledLoads.length})</p>
          </div>
          <div className="space-y-1.5">
            {cancelledLoads.slice(0, 8).map(l => (
              <div key={l.id} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate">
                  {getEffectiveDate(l)} · {l.pickup_location} → {l.dropoff_location}
                </span>
                <span className="text-destructive font-mono shrink-0">$0</span>
              </div>
            ))}
            {cancelledLoads.length > 8 && (
              <p className="text-[11px] text-muted-foreground pt-1">+ {cancelledLoads.length - 8} more</p>
            )}
          </div>
        </div>
      )}

      {/* Monthly Summary Button */}
      {onNavigate && (
        <Button
          variant="outline"
          className="w-full h-12 gap-2 rounded-xl border-primary/30 text-primary font-bold active:scale-95 transition-all duration-200"
          onClick={() => onNavigate('monthly')}
        >
          <Calendar className="h-5 w-5" /> Monthly Summary
        </Button>
      )}

      {/* Legacy raw exports removed — replaced by the unified Report Center above. */}

      {/* Weekly Breakdown */}
      {summaries.length > 0 && (
        <div>
          <h2 className="text-label mb-3">Weekly Breakdown</h2>
          <div className="space-y-2">
            {summaries.map(s => (
              <div key={s.startDate} className="premium-card p-4">
                <div className="flex justify-between items-start mb-3 gap-3">
                  <p className="font-bold text-sm text-foreground">{s.weekLabel}</p>
                  <div className="text-right">
                    <p className="text-lg font-mono font-black text-primary whitespace-nowrap">{formatCurrency(s.totalEstimatedPay)}</p>
                    {s.totalActualPay > 0 && (
                      <p className={`text-xs font-mono whitespace-nowrap ${s.totalActualPay >= s.totalEstimatedPay ? 'text-success' : 'text-destructive'}`}>
                        Actual: {formatCurrency(s.totalActualPay)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/40">
                  <div>
                    <p className="text-label">Loads</p>
                    <p className="text-sm font-mono font-bold text-foreground mt-0.5">{s.totalLoads}</p>
                  </div>
                  <div>
                    <p className="text-label">Miles</p>
                    <p className="text-sm font-mono font-bold text-foreground mt-0.5 whitespace-nowrap">{formatNumber(s.totalLoadedMiles)}</p>
                  </div>
                  <div>
                    <p className="text-label">Avg $/mi</p>
                    <p className="text-sm font-mono font-bold text-foreground mt-0.5 whitespace-nowrap">{formatCurrency(s.avgRatePerMile)}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" disabled={!canExport} data-testid="export-week-csv" className="mt-3 w-full text-xs h-8 rounded-lg border border-border/60 hover:border-primary/30 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => {
                  if (!canExport) { toast.error('You do not have permission to export reports for this driver.'); return; }
                  const weekLoads = loads.filter(l => {
                    const d = new Date(getEffectiveDate(l));
                    return d >= new Date(s.startDate) && d <= new Date(s.endDate);
                  });
                  exportToCSV(weekLoads, `week-${s.weekLabel.replace(/\s/g, '-')}`, stops, companyMeta);
                }}>

                  <Download className="h-3 w-3 mr-1" /> Export Week
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
