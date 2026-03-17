import { useState } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { useLoadStops } from '@/hooks/useLoadStops';
import { useUserSettings } from '@/hooks/useUserSettings';
import { getWeekSummaries, formatCurrency, formatNumber, exportToCSV, exportToPDF, exportProfitCSV, getCurrentMonthLoads, getEffectiveDate } from '@/lib/loadUtils';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText, FileSpreadsheet, Filter, Calendar, TrendingUp, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { parseISO, isWithinInterval } from 'date-fns';
import { toast } from 'sonner';

interface ReportsViewProps {
  loads: Load[];
  expenses?: Expense[];
  onNavigate?: (page: string) => void;
  isPro?: boolean;
}

export function ReportsView({ loads, expenses = [], onNavigate, isPro = false }: ReportsViewProps) {
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { stops } = useLoadStops();
  const { settings } = useUserSettings();

  const companyMeta = {
    companyName: settings?.company_name ?? undefined,
    companyStartDate: settings?.company_start_date ?? undefined,
  };

  const filteredLoads = loads.filter(l => {
    if (!dateRange.from && !dateRange.to) return true;
    const d = parseISO(getEffectiveDate(l));
    const start = dateRange.from ? parseISO(dateRange.from) : new Date(0);
    const end = dateRange.to ? parseISO(dateRange.to) : new Date('2099-12-31');
    return isWithinInterval(d, { start, end });
  });

  const summaries = getWeekSummaries(filteredLoads);
  const monthLoads = getCurrentMonthLoads(loads);
  const hasFilter = !!(dateRange.from || dateRange.to);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">Reports</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Export summaries for payroll, tax, or carrier disputes.
        </p>
      </div>

      <DateRangeFilter onRangeChange={(from, to) => setDateRange({ from, to })} />

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

      <div>
        <h2 className="text-label mb-3">Export Options</h2>
        <div className="grid gap-3">
          <Button variant="outline" className="h-14 justify-start gap-3 rounded-xl" onClick={() => exportToCSV(loads, 'all-loads', stops, companyMeta)} disabled={loads.length === 0}>
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-semibold text-sm">Export All Loads (CSV)</p>
              <p className="text-xs text-muted-foreground">{loads.length} loads</p>
            </div>
          </Button>

          {hasFilter && (
            <Button variant="outline" className="h-14 justify-start gap-3 rounded-xl" onClick={() => exportToCSV(filteredLoads, 'filtered-loads', stops, companyMeta)} disabled={filteredLoads.length === 0}>
              <Filter className="h-5 w-5 text-primary" />
              <div className="text-left">
                <p className="font-semibold text-sm">Export Filtered Loads (CSV)</p>
                <p className="text-xs text-muted-foreground">{filteredLoads.length} loads in range</p>
              </div>
            </Button>
          )}

          <Button variant="outline" className="h-14 justify-start gap-3 rounded-xl" onClick={() => exportToCSV(monthLoads, 'monthly-summary', stops, companyMeta)} disabled={monthLoads.length === 0}>
            <FileText className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-semibold text-sm">Export Monthly Summary (CSV)</p>
              <p className="text-xs text-muted-foreground">{monthLoads.length} loads this month</p>
            </div>
          </Button>

          <div className="relative">
            <Button variant="outline" className="h-14 justify-start gap-3 rounded-xl w-full" onClick={() => {
              if (!isPro) { toast.error('PDF export is a Pro feature. Upgrade to unlock.'); return; }
              exportToPDF(filteredLoads.length > 0 ? filteredLoads : loads, hasFilter ? 'filtered-loads' : 'all-loads', stops, companyMeta);
            }} disabled={loads.length === 0}>
              <Download className="h-5 w-5 text-destructive" />
              <div className="text-left flex-1">
                <p className="font-semibold text-sm">Export as PDF</p>
                <p className="text-xs text-muted-foreground">{hasFilter ? `${filteredLoads.length} filtered loads` : `${loads.length} loads`}</p>
              </div>
              {!isPro && <Badge variant="outline" className="text-[9px] gap-0.5 border-primary/30 text-primary shrink-0"><Lock className="h-2 w-2" /> Pro</Badge>}
            </Button>
          </div>

          <div className="relative">
            <Button variant="outline" className="h-14 justify-start gap-3 rounded-xl w-full" onClick={() => {
              if (!isPro) { toast.error('Profit reports are a Pro feature. Upgrade to unlock.'); return; }
              exportProfitCSV(filteredLoads.length > 0 ? filteredLoads : loads, expenses, 'profit-report', stops, companyMeta);
            }} disabled={loads.length === 0}>
              <TrendingUp className="h-5 w-5 text-success" />
              <div className="text-left flex-1">
                <p className="font-semibold text-sm">Export Profit Report (CSV)</p>
                <p className="text-xs text-muted-foreground">Includes expenses & net profit</p>
              </div>
              {!isPro && <Badge variant="outline" className="text-[9px] gap-0.5 border-primary/30 text-primary shrink-0"><Lock className="h-2 w-2" /> Pro</Badge>}
            </Button>
          </div>
        </div>
      </div>

      {summaries.length > 0 && (
        <div>
          <h2 className="text-label mb-3">Weekly Breakdown</h2>
          <div className="space-y-2">
            {summaries.map(s => (
              <Card key={s.startDate} className="card-premium">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <p className="font-semibold text-sm">{s.weekLabel}</p>
                    <div className="text-right">
                      <p className="text-value-lg text-primary">{formatCurrency(s.totalEstimatedPay)}</p>
                      {s.totalActualPay > 0 && (
                        <p className={`text-xs font-mono ${s.totalActualPay >= s.totalEstimatedPay ? 'text-success' : 'text-destructive'}`}>
                          Actual: {formatCurrency(s.totalActualPay)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground">{s.totalLoads}</p>
                      <p>Loads</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{formatNumber(s.totalLoadedMiles)}</p>
                      <p>Miles</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{formatCurrency(s.avgRatePerMile)}</p>
                      <p>Avg $/mi</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="mt-2 w-full text-xs" onClick={() => {
                    const weekLoads = loads.filter(l => {
                      const d = new Date(l.load_date);
                      return d >= new Date(s.startDate) && d <= new Date(s.endDate);
                    });
                    exportToCSV(weekLoads, `week-${s.weekLabel.replace(/\s/g, '-')}`, stops, companyMeta);
                  }}>
                    <Download className="h-3 w-3 mr-1" /> Export Week
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
