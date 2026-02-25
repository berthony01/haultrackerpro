import { useState } from 'react';
import { Load } from '@/hooks/useLoads';
import { getWeekSummaries, formatCurrency, formatNumber, exportToCSV, exportToPDF, getCurrentMonthLoads } from '@/lib/loadUtils';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText, FileSpreadsheet, Filter, Calendar } from 'lucide-react';
import { parseISO, isWithinInterval } from 'date-fns';

interface ReportsViewProps {
  loads: Load[];
  onNavigate?: (page: string) => void;
}

export function ReportsView({ loads, onNavigate }: ReportsViewProps) {
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});

  const filteredLoads = loads.filter(l => {
    if (!dateRange.from && !dateRange.to) return true;
    const d = parseISO(l.load_date);
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
        <p className="text-sm text-muted-foreground">Export and review summaries</p>
      </div>

      <DateRangeFilter onRangeChange={(from, to) => setDateRange({ from, to })} />

      {/* Monthly Summary Button */}
      {onNavigate && (
        <Button
          variant="outline"
          className="w-full h-12 gap-2 rounded-xl border-primary/30 text-primary font-bold active:scale-95 transition-transform"
          onClick={() => onNavigate('monthly')}
        >
          <Calendar className="h-5 w-5" /> Month Summary
        </Button>
      )}

      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Export Options</h2>
        <div className="grid gap-3">
          <Button variant="outline" className="h-14 justify-start gap-3" onClick={() => exportToCSV(loads, 'all-loads')} disabled={loads.length === 0}>
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-semibold text-sm">Export All Loads (CSV)</p>
              <p className="text-xs text-muted-foreground">{loads.length} loads</p>
            </div>
          </Button>

          {hasFilter && (
            <Button variant="outline" className="h-14 justify-start gap-3" onClick={() => exportToCSV(filteredLoads, 'filtered-loads')} disabled={filteredLoads.length === 0}>
              <Filter className="h-5 w-5 text-primary" />
              <div className="text-left">
                <p className="font-semibold text-sm">Export Filtered Loads (CSV)</p>
                <p className="text-xs text-muted-foreground">{filteredLoads.length} loads in range</p>
              </div>
            </Button>
          )}

          <Button variant="outline" className="h-14 justify-start gap-3" onClick={() => exportToCSV(monthLoads, 'monthly-summary')} disabled={monthLoads.length === 0}>
            <FileText className="h-5 w-5 text-primary" />
            <div className="text-left">
              <p className="font-semibold text-sm">Export Monthly Summary (CSV)</p>
              <p className="text-xs text-muted-foreground">{monthLoads.length} loads this month</p>
            </div>
          </Button>

          <Button variant="outline" className="h-14 justify-start gap-3" onClick={() => exportToPDF(filteredLoads.length > 0 ? filteredLoads : loads, hasFilter ? 'filtered-loads' : 'all-loads')} disabled={loads.length === 0}>
            <Download className="h-5 w-5 text-destructive" />
            <div className="text-left">
              <p className="font-semibold text-sm">Export as PDF</p>
              <p className="text-xs text-muted-foreground">{hasFilter ? `${filteredLoads.length} filtered loads` : `${loads.length} loads`}</p>
            </div>
          </Button>
        </div>
      </div>

      {summaries.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Weekly Breakdown</h2>
          <div className="space-y-2">
            {summaries.map(s => (
              <Card key={s.startDate}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-semibold text-sm">{s.weekLabel}</p>
                    <div className="text-right">
                      <p className="font-black font-mono text-primary">{formatCurrency(s.totalEstimatedPay)}</p>
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
                    exportToCSV(weekLoads, `week-${s.weekLabel.replace(/\s/g, '-')}`);
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
