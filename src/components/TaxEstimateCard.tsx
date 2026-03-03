import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { UserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Calculator } from 'lucide-react';

interface TaxEstimateCardProps {
  loads: Load[];
  expenses: Expense[];
  settings: UserSettings | null;
  isPro?: boolean;
}

export function TaxEstimateCard({ loads, expenses, settings, isPro = false }: TaxEstimateCardProps) {
  const result = useMemo(() => {
    if (!settings?.tax_estimator_enabled) return null;

    const federal = Number(settings.federal_tax_percent ?? 0);
    const state = Number(settings.state_tax_percent ?? 0);
    const se = settings.include_se_tax ? Number(settings.se_tax_percent ?? 0) : 0;
    const buffer = Number(settings.buffer_percent ?? 0);
    const totalPercent = federal + state + se + buffer;

    if (totalPercent <= 0) return null;

    // Calculate gross revenue
    const paidLoads = loads.filter(l => l.actual_pay_received != null);
    const grossRevenue = paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0) +
      loads.filter(l => l.actual_pay_received == null).reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);

    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const netProfit = grossRevenue - totalExpenses;

    const base = settings.tax_base_type === 'gross' ? grossRevenue : netProfit;
    const estimatedTax = Math.max(0, base * (totalPercent / 100));
    const profitAfterTax = netProfit - estimatedTax;

    return { estimatedTax, profitAfterTax, totalPercent, netProfit, baseLabel: settings.tax_base_type === 'gross' ? 'gross' : 'net' };
  }, [loads, expenses, settings]);

  if (!result) return null;

  return (
    <Card className="border-warning/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-2">
          <Calculator className="h-3.5 w-3.5 text-warning" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Est. Tax Set-Aside ({result.totalPercent.toFixed(1)}% of {result.baseLabel})
          </p>
        </div>
        <p className="text-lg font-black font-mono text-warning">
          {formatCurrency(result.estimatedTax)}
        </p>
        {isPro && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Profit After Est. Tax: <span className="font-mono font-bold text-foreground">{formatCurrency(result.profitAfterTax)}</span>
          </p>
        )}
        <p className="text-[9px] text-muted-foreground/50 mt-1">
          Estimate only — not tax advice.
        </p>
      </CardContent>
    </Card>
  );
}
