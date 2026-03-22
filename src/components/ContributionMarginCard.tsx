import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, Info, Layers } from 'lucide-react';

interface ContributionMarginCardProps {
  loads: Load[];
  expenses: Expense[];
}

export function ContributionMarginCard({ loads, expenses }: ContributionMarginCardProps) {
  const data = useMemo(() => {
    if (loads.length === 0) return null;

    const paidLoads = loads.filter(l => l.actual_pay_received != null);
    const grossRevenue = paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0) +
      loads.filter(l => l.actual_pay_received == null).reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);

    const variableExpenses = expenses
      .filter(e => (e as any).expense_type === 'variable' || !(e as any).expense_type)
      .reduce((s, e) => s + Number(e.amount), 0);

    const fixedExpenses = expenses
      .filter(e => (e as any).expense_type === 'fixed')
      .reduce((s, e) => s + Number(e.amount), 0);

    const totalExpenses = variableExpenses + fixedExpenses;
    const contributionMargin = grossRevenue - variableExpenses;
    const cmPercent = grossRevenue > 0 ? (contributionMargin / grossRevenue) * 100 : 0;
    const netProfit = grossRevenue - totalExpenses;

    const totalMiles = loads.reduce((s, l) => s + Number(l.loaded_miles) + Number(l.deadhead_miles), 0);
    const cmPerMile = totalMiles > 0 ? contributionMargin / totalMiles : 0;

    return {
      grossRevenue,
      variableExpenses,
      fixedExpenses,
      totalExpenses,
      contributionMargin,
      cmPercent,
      cmPerMile,
      netProfit,
    };
  }, [loads, expenses]);

  if (!data || data.grossRevenue === 0) return null;
  // Only show if there are both fixed and variable expenses
  if (data.fixedExpenses === 0 && data.variableExpenses === 0) return null;

  return (
    <Card className="shadow-card border-primary/10">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Cost Breakdown</p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/40 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[250px]">
                <p className="text-xs leading-relaxed">
                  Contribution Margin = Revenue − Variable Costs. This shows what each load contributes toward covering your fixed overhead. A positive CM means the load is worth taking.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Revenue → Variable → CM → Fixed → Net Profit waterfall */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Gross Revenue</p>
            <p className="text-sm font-mono font-bold text-primary">{formatCurrency(data.grossRevenue)}</p>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">− Variable Costs</p>
            <p className="text-sm font-mono font-bold text-destructive">−{formatCurrency(data.variableExpenses)}</p>
          </div>

          <div className="border-t border-border/50 pt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {data.contributionMargin >= 0
                ? <TrendingUp className="h-3.5 w-3.5 text-success" />
                : <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
              <p className="text-xs font-bold">Contribution Margin</p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-mono font-black ${data.contributionMargin >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(data.contributionMargin)}
              </p>
              <p className="text-[10px] text-muted-foreground">{data.cmPercent.toFixed(1)}% of revenue</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">− Fixed Overhead</p>
            <p className="text-sm font-mono font-bold text-destructive">−{formatCurrency(data.fixedExpenses)}</p>
          </div>

          <div className="border-t border-border pt-2 flex items-center justify-between">
            <p className="text-xs font-bold">Net Profit</p>
            <p className={`text-sm font-mono font-black ${data.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(data.netProfit)}
            </p>
          </div>
        </div>

        {/* CM per mile */}
        {data.cmPerMile > 0 && (
          <div className="mt-3 pt-2 border-t border-border/30 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">CM per Mile (all miles)</p>
            <p className="text-xs font-mono font-bold">{formatCurrency(data.cmPerMile)}/mi</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
