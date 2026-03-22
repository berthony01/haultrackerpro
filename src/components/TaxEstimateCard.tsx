import { useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { Expense } from '@/hooks/useExpenses';
import { UserSettings } from '@/hooks/useUserSettings';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Calculator, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TaxEstimateCardProps {
  loads: Load[];
  expenses: Expense[];
  settings: UserSettings | null;
  isPro?: boolean;
}

export function TaxEstimateCard({ loads, expenses, settings, isPro = false }: TaxEstimateCardProps) {
  const result = useMemo(() => {
    if (!settings?.tax_estimator_enabled) return null;

    const federalRate = Number(settings.federal_tax_percent ?? 0) / 100;
    const stateRate = Number(settings.state_tax_percent ?? 0) / 100;
    const includeSE = settings.include_se_tax ?? false;
    const seRate = includeSE ? Number(settings.se_tax_percent ?? 15.3) / 100 : 0;
    const bufferRate = Number(settings.buffer_percent ?? 0) / 100;

    if (federalRate + stateRate + seRate + bufferRate <= 0) return null;

    // Calculate gross revenue (actual when available, estimated as fallback)
    const paidLoads = loads.filter(l => l.actual_pay_received != null);
    const grossRevenue = paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0) +
      loads.filter(l => l.actual_pay_received == null).reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);

    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const netProfit = grossRevenue - totalExpenses;

    // Determine tax base (gross or net, based on user setting)
    const taxBase = settings.tax_base_type === 'gross' ? grossRevenue : netProfit;
    if (taxBase <= 0) {
      return { 
        seTax: 0, federalTax: 0, stateTax: 0, bufferTax: 0,
        totalTax: 0, profitAfterTax: netProfit, netProfit, 
        baseLabel: settings.tax_base_type === 'gross' ? 'gross' : 'net',
        totalPercent: (federalRate + stateRate + seRate + bufferRate) * 100,
      };
    }

    // ── CORRECTED SE TAX CALCULATION (IRS method) ──
    // Step 1: Multiply base by 92.35% (IRS requires this adjustment)
    // Step 2: Apply SE rate (typically 15.3%) to the adjusted amount
    const seAdjustedBase = taxBase * 0.9235;
    const seTax = includeSE ? seAdjustedBase * seRate : 0;

    // ── CORRECTED INCOME TAX CALCULATION ──
    // Half of SE tax is deductible from income before calculating income tax
    const seDeduction = seTax / 2;
    const incomeForIncomeTax = Math.max(0, taxBase - seDeduction);

    const federalTax = incomeForIncomeTax * federalRate;
    const stateTax = incomeForIncomeTax * stateRate;
    const bufferTax = taxBase * bufferRate;

    const totalTax = seTax + federalTax + stateTax + bufferTax;
    const profitAfterTax = netProfit - totalTax;

    const totalPercent = (federalRate + stateRate + seRate + bufferRate) * 100;

    return {
      seTax,
      federalTax,
      stateTax,
      bufferTax,
      totalTax,
      profitAfterTax,
      netProfit,
      baseLabel: settings.tax_base_type === 'gross' ? 'gross' : 'net',
      totalPercent,
    };
  }, [loads, expenses, settings]);

  if (!result) return null;

  return (
    <Card className="border-warning/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-2">
          <Calculator className="h-3.5 w-3.5 text-warning" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Est. Tax Set-Aside
          </p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/40 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[250px]">
                <p className="text-xs leading-relaxed">
                  SE tax uses the IRS method: {result.baseLabel} income × 92.35% × SE rate. Half of SE tax is deducted before calculating income tax.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Total tax — always visible */}
        <p className="text-lg font-black font-mono text-warning">
          {formatCurrency(result.totalTax)}
        </p>

        {/* Profit After Tax — visible to ALL users, prominent */}
        <div className="mt-2 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Profit After Est. Tax</p>
            <p className={`text-base font-black font-mono ${result.profitAfterTax >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(result.profitAfterTax)}
            </p>
          </div>
        </div>

        {/* Pro breakdown — detailed tax components */}
        {isPro && result.totalTax > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
            {result.seTax > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">Self-Employment Tax</p>
                <p className="text-[11px] font-mono font-bold">{formatCurrency(result.seTax)}</p>
              </div>
            )}
            {result.federalTax > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">Federal Income Tax</p>
                <p className="text-[11px] font-mono font-bold">{formatCurrency(result.federalTax)}</p>
              </div>
            )}
            {result.stateTax > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">State Income Tax</p>
                <p className="text-[11px] font-mono font-bold">{formatCurrency(result.stateTax)}</p>
              </div>
            )}
            {result.bufferTax > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">Buffer</p>
                <p className="text-[11px] font-mono font-bold">{formatCurrency(result.bufferTax)}</p>
              </div>
            )}
          </div>
        )}

        <p className="text-[9px] text-muted-foreground/50 mt-2">
          Uses IRS SE tax method (92.35% adjustment + half-SE deduction). Estimate only — not tax advice.
        </p>
      </CardContent>
    </Card>
  );
}
