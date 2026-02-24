import { Load } from '@/lib/types';
import { getWeekSummaries, formatCurrency, formatNumber, exportToCSV, getCurrentMonthLoads } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';

interface ReportsViewProps {
  loads: Load[];
}

export function ReportsView({ loads }: ReportsViewProps) {
  const summaries = getWeekSummaries(loads);
  const monthLoads = getCurrentMonthLoads(loads);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black font-heading">Reports</h1>
        <p className="text-sm text-muted-foreground">Export and review summaries</p>
      </div>

      <div className="grid gap-3">
        <Button
          variant="outline"
          className="h-14 justify-start gap-3"
          onClick={() => exportToCSV(loads, 'all-loads')}
          disabled={loads.length === 0}
        >
          <Download className="h-5 w-5 text-primary" />
          <div className="text-left">
            <p className="font-semibold text-sm">Export All Loads</p>
            <p className="text-xs text-muted-foreground">{loads.length} loads as CSV</p>
          </div>
        </Button>
        <Button
          variant="outline"
          className="h-14 justify-start gap-3"
          onClick={() => exportToCSV(monthLoads, 'monthly-loads')}
          disabled={monthLoads.length === 0}
        >
          <FileText className="h-5 w-5 text-primary" />
          <div className="text-left">
            <p className="font-semibold text-sm">Export This Month</p>
            <p className="text-xs text-muted-foreground">{monthLoads.length} loads as CSV</p>
          </div>
        </Button>
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
                    <p className="font-black font-mono text-primary">{formatCurrency(s.totalPay)}</p>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full text-xs"
                    onClick={() => {
                      const weekLoads = loads.filter(l => {
                        const d = new Date(l.date);
                        return d >= new Date(s.startDate) && d <= new Date(s.endDate);
                      });
                      exportToCSV(weekLoads, `week-${s.weekLabel.replace(/\s/g, '-')}`);
                    }}
                  >
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
