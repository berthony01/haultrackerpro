import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Receipt, DollarSign } from 'lucide-react';

interface ProfitOverviewProps {
  loads: Load[];
  expenses: Expense[];
}

export function ProfitOverview({ loads, expenses }: ProfitOverviewProps) {
  const paidLoads = loads.filter(l => l.actual_pay_received != null);
  const hasActual = paidLoads.length > 0;

  const grossRevenue = hasActual
    ? paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0) +
      loads.filter(l => l.actual_pay_received == null).reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0)
    : loads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = grossRevenue - totalExpenses;

  const loadedMiles = loads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const deadheadMiles = loads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const totalMiles = loadedMiles + deadheadMiles;
  const netPerMile = totalMiles > 0 ? netProfit / totalMiles : 0;

  if (expenses.length === 0) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="py-6 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Add expenses to calculate true profit.</p>
        </CardContent>
      </Card>
    );
  }

  const revenueLabel = hasActual ? 'Gross Revenue' : 'Projected Revenue';

  return (
    <Card className="card-premium border-primary/10">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-label">Profit Overview</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="rounded-xl bg-secondary p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{revenueLabel}</p>
            <p className="text-lg font-black font-mono text-primary">{formatCurrency(grossRevenue)}</p>
          </div>
          <div className="rounded-xl bg-secondary p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Expenses</p>
            <p className="text-lg font-black font-mono text-destructive">{formatCurrency(totalExpenses)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-xl p-3 ${netProfit >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Net Profit</p>
            <div className="flex items-center gap-1.5">
              {netProfit >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
              <p className={`text-lg font-black font-mono ${netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(netProfit)}
              </p>
            </div>
          </div>
          <div className="rounded-xl bg-secondary p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Net $/Mile</p>
            <p className="text-lg font-black font-mono text-primary">{formatCurrency(netPerMile)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
