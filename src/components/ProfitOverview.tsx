import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { formatCurrency } from '@/lib/loadUtils';
import { sumExpectedPay, sumOperatingMiles } from '@/lib/loadMetrics';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, Info, Plus } from 'lucide-react';

interface ProfitOverviewProps {
  loads: Load[];
  expenses: Expense[];
  onAddExpense?: () => void;
}

export function ProfitOverview({ loads, expenses, onAddExpense }: ProfitOverviewProps) {
  const paidLoads = loads.filter(l => l.actual_pay_received != null);
  const hasActual = paidLoads.length > 0;

  const grossRevenue = hasActual
    ? paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0) +
      sumExpectedPay(loads.filter(l => l.actual_pay_received == null))
    : sumExpectedPay(loads);

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = grossRevenue - totalExpenses;

  const totalMiles = sumOperatingMiles(loads);
  const netPerMile = totalMiles > 0 ? netProfit / totalMiles : 0;

  const revenueLabel = hasActual ? 'Gross Revenue' : 'Projected Revenue';
  const noExpenses = expenses.length === 0;

  return (
    <Card className="card-premium border-primary/20 shadow-elevated">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <p className="text-label">Profit Overview</p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Net Profit = Gross Revenue − Logged Expenses</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {noExpenses && onAddExpense && (
            <Button
              size="sm"
              className="h-8 text-xs font-bold rounded-lg gap-1 px-3"
              onClick={onAddExpense}
            >
              <Plus className="h-3 w-3" /> Add Expense
            </Button>
          )}
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

        {noExpenses && (
          <p className="text-[11px] text-muted-foreground mt-3 leading-snug">
            Log expenses to see your true net profit after fuel, repairs, meals, and other costs.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
