import { useMemo, useState } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { useLoadStops } from '@/hooks/useLoadStops';
import { useUserSettings } from '@/hooks/useUserSettings';
import { getWeekSummaries, formatCurrency, formatNumber, exportToCSV, exportToPDF, exportProfitCSV, exportScheduleCSummary, getCurrentMonthLoads, getEffectiveDate, weekStartDayToNumber } from '@/lib/loadUtils';
import { summarizeLoads, excludeCancelled, onlyCancelled, FINANCIAL_TOOLTIPS } from '@/lib/financialCalculations';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Button } from '@/components/ui/button';
import { Download, FileText, FileSpreadsheet, Filter, Calendar, TrendingUp, Lock, Receipt, BarChart3, Fuel, DollarSign, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { parseISO, isWithinInterval } from 'date-fns';
import { toast } from 'sonner';

interface ReportsViewProps {
  loads: Load[];
  expenses?: Expense[];
  onNavigate?: (page: string) => void;
  isPro?: boolean;
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

export function ReportsView({ loads, expenses = [], onNavigate, isPro = false }: ReportsViewProps) {
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { stops } = useLoadStops();
  const { settings } = useUserSettings();

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

  const summaries = useMemo(() => getWeekSummaries(filteredLoads), [filteredLoads]);
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-label">Analytics Center</p>
        <h1 className="text-2xl font-black font-heading tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Export summaries for payroll, tax, or carrier disputes.
        </p>
      </div>

      {/* Date Range */}
      <div className="premium-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <p className="text-label">Date Range</p>
        </div>
        <DateRangeFilter onRangeChange={(from, to) => setDateRange({ from, to })} />
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            <p className="text-label">Revenue</p>
          </div>
          <p className="text-xl font-mono font-black text-foreground whitespace-nowrap">{formatCurrency(kpis.revenue)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{kpis.loadsCount} loads</p>
        </div>
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <Receipt className="h-3.5 w-3.5" />
            </div>
            <p className="text-label">Expenses</p>
          </div>
          <p className="text-xl font-mono font-black text-foreground whitespace-nowrap">{formatCurrency(kpis.expenseTotal)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{filteredExpenses.length} entries</p>
        </div>
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <p className="text-label">Net Profit</p>
          </div>
          <p className={`text-xl font-mono font-black whitespace-nowrap ${kpis.net >= 0 ? 'text-primary' : 'text-destructive'}`}>
            {formatCurrency(kpis.net)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Revenue − Expenses</p>
        </div>
        <div className="premium-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 text-primary">
              <BarChart3 className="h-3.5 w-3.5" />
            </div>
            <p className="text-label">Miles</p>
          </div>
          <p className="text-xl font-mono font-black text-foreground whitespace-nowrap">{formatNumber(kpis.miles)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Loaded miles</p>
        </div>
      </div>

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

      {/* Exports */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-label">Export Options</h2>
          <span className="text-[10px] text-muted-foreground">CSV · PDF</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ExportRow
            icon={<FileSpreadsheet className="h-4 w-4" />}
            title="All Loads (CSV)"
            subtitle={`${loads.length} loads`}
            onClick={() => exportToCSV(loads, 'all-loads', stops, companyMeta)}
            disabled={loads.length === 0}
          />

          {hasFilter && (
            <ExportRow
              icon={<Filter className="h-4 w-4" />}
              title="Filtered Loads (CSV)"
              subtitle={`${filteredLoads.length} loads in range`}
              onClick={() => exportToCSV(filteredLoads, 'filtered-loads', stops, companyMeta)}
              disabled={filteredLoads.length === 0}
            />
          )}

          <ExportRow
            icon={<FileText className="h-4 w-4" />}
            title="Monthly Summary (CSV)"
            subtitle={`${monthLoads.length} loads this month`}
            onClick={() => exportToCSV(monthLoads, 'monthly-summary', stops, companyMeta)}
            disabled={monthLoads.length === 0}
          />

          <ExportRow
            icon={<Download className="h-4 w-4" />}
            title="Export as PDF"
            subtitle={hasFilter ? `${filteredLoads.length} filtered loads` : `${loads.length} loads`}
            onClick={() => {
              if (!isPro) { toast.error('PDF export is a Pro feature. Upgrade to unlock.'); return; }
              exportToPDF(filteredLoads.length > 0 ? filteredLoads : loads, hasFilter ? 'filtered-loads' : 'all-loads', stops, companyMeta);
            }}
            disabled={loads.length === 0}
            locked={!isPro}
          />

          <ExportRow
            icon={<TrendingUp className="h-4 w-4" />}
            title="Profit Report (CSV)"
            subtitle="Includes expenses & net profit"
            onClick={() => {
              if (!isPro) { toast.error('Profit reports are a Pro feature. Upgrade to unlock.'); return; }
              exportProfitCSV(filteredLoads.length > 0 ? filteredLoads : loads, expenses, 'profit-report', stops, companyMeta);
            }}
            disabled={loads.length === 0}
            locked={!isPro}
          />

          <ExportRow
            icon={<Receipt className="h-4 w-4" />}
            title="Schedule C Summary (CSV)"
            subtitle="Expenses grouped by IRS Schedule C lines"
            onClick={() => {
              if (!isPro) { toast.error('Schedule C export is a Pro feature. Upgrade to unlock.'); return; }
              exportScheduleCSummary(
                expenses.map(e => ({ category: e.category, amount: e.amount, expense_date: e.expense_date })),
                'schedule-c-summary',
                companyMeta
              );
            }}
            disabled={expenses.length === 0}
            locked={!isPro}
          />
        </div>
      </div>

      {/* Schedule C Preview */}
      {isPro && expenses.length > 0 && (() => {
        const scGroups: Record<string, { desc: string; cats: Set<string>; total: number }> = {};
        const SC_MAP: Record<string, { line: string; desc: string }> = {
          'Fuel': { line: '9', desc: 'Car & truck' }, 'Tolls': { line: '9', desc: 'Car & truck' },
          'Parking': { line: '9', desc: 'Car & truck' }, 'Maintenance': { line: '21', desc: 'Repairs & maint.' },
          'Repairs': { line: '21', desc: 'Repairs & maint.' }, 'Tires': { line: '21', desc: 'Repairs & maint.' },
          'Insurance': { line: '15', desc: 'Insurance' }, 'Permits': { line: '22', desc: 'Taxes & licenses' },
          'Licensing': { line: '22', desc: 'Taxes & licenses' }, 'Truck Payment': { line: '13', desc: 'Depreciation' },
          'Lease Payment': { line: '20a', desc: 'Rent/lease' }, 'Phone': { line: '25', desc: 'Utilities' },
          'ELD/Software': { line: '18', desc: 'Office expense' }, 'Meals': { line: '24b', desc: 'Meals (50%)' },
          'Lodging': { line: '24a', desc: 'Travel' }, 'Supplies': { line: '22', desc: 'Supplies' },
        };
        const getLine = (c: string) => SC_MAP[c] ?? { line: '27a', desc: 'Other' };

        expenses.forEach(e => {
          const sc = getLine(e.category);
          if (!scGroups[sc.line]) scGroups[sc.line] = { desc: sc.desc, cats: new Set(), total: 0 };
          scGroups[sc.line].cats.add(e.category);
          scGroups[sc.line].total += Number(e.amount);
        });

        const sorted = Object.entries(scGroups)
          .map(([line, d]) => ({ line, desc: d.desc, cats: [...d.cats], total: d.total }))
          .sort((a, b) => parseFloat(a.line) - parseFloat(b.line));

        const totalExp = expenses.reduce((s, e) => s + Number(e.amount), 0);

        return (
          <div>
            <h2 className="text-label mb-3">Schedule C Preview</h2>
            <div className="premium-card p-4 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Receipt className="h-3.5 w-3.5 text-primary" />
                <p className="text-label">IRS Schedule C Line Totals</p>
              </div>
              {sorted.map(g => (
                <div key={g.line} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground">Line {g.line}: {g.desc}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{g.cats.join(', ')}</p>
                  </div>
                  <p className="text-sm font-mono font-bold shrink-0 ml-3 whitespace-nowrap">{formatCurrency(g.total)}</p>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <p className="text-xs font-bold">Total Deductible Expenses</p>
                <p className="text-sm font-mono font-black text-primary whitespace-nowrap">{formatCurrency(totalExp)}</p>
              </div>
              <p className="text-[9px] text-muted-foreground/60 pt-1">
                Preview only. Verify all line assignments with your tax preparer.
              </p>
            </div>
          </div>
        );
      })()}

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
                <Button variant="ghost" size="sm" className="mt-3 w-full text-xs h-8 rounded-lg border border-border/60 hover:border-primary/30 hover:text-primary" onClick={() => {
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
