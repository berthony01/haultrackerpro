import { useState, useMemo, useEffect } from 'react';
import SEOHead from '@/components/SEOHead';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, DollarSign, Fuel, Truck, TrendingUp, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@/lib/loadUtils';
import { trackCalculatorUsed } from '@/lib/analytics';
import { estimateFinancialScenario } from '@/lib/financialEstimates';

export default function LoadProfitCalculator() {
  const navigate = useNavigate();
  const [miles, setMiles] = useState('');
  const [ratePerMile, setRatePerMile] = useState('');
  const [fuelPrice, setFuelPrice] = useState('');
  const [mpg, setMpg] = useState('');
  const [maintenancePerMile, setMaintenancePerMile] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [otherExpenses, setOtherExpenses] = useState('');

  const calculation = useMemo(() => estimateFinancialScenario({
    miles,
    revenue: { kind: 'rate', ratePerMile },
    nonFuelCostPerMile: maintenancePerMile,
    fuel: { kind: 'consumption', pricePerGallon: fuelPrice, mpg },
    otherExpenses,
    taxReservePercent: taxRate,
  }), [miles, ratePerMile, fuelPrice, mpg, maintenancePerMile, taxRate, otherExpenses]);
  const results = calculation.ok ? calculation.estimate : null;
  const hasInput = results != null;
  const hasAnyInput = [miles, ratePerMile, fuelPrice, mpg, maintenancePerMile, taxRate, otherExpenses].some(v => v !== '');

  useEffect(() => {
    if (hasInput) {
      trackCalculatorUsed('load_profit_calculator');
    }
  }, [hasInput]);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Load Profit Calculator for Truckers | HaulTrackerPro"
        description="Calculate your true load profit after fuel, maintenance, taxes, and expenses. Free trucking load profit calculator."
        path="/tools/load-profit-calculator"
      />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4 mb-2">
            <Calculator className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black font-heading">Load Profit Calculator</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Estimate load profit after fuel, maintenance, other expenses, and a separate tax reserve.
          </p>
        </div>

        <Card className="shadow-card">
          <CardContent className="p-5 space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Load Details</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Miles</Label>
                <Input type="number" placeholder="500" value={miles} onChange={e => setMiles(e.target.value)} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Rate Per Mile ($)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="number" step="0.01" placeholder="2.50" value={ratePerMile} onChange={e => setRatePerMile(e.target.value)} className="h-11 pl-9 rounded-xl" />
                </div>
              </div>
            </div>

            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider pt-2">Costs</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1"><Fuel className="h-3 w-3" /> Fuel Price/Gal</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="number" step="0.01" placeholder="3.50" value={fuelPrice} onChange={e => setFuelPrice(e.target.value)} className="h-11 pl-9 rounded-xl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Truck MPG</Label>
                <Input type="number" step="0.1" placeholder="6.5" value={mpg} onChange={e => setMpg(e.target.value)} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Maintenance/Mile ($)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="number" step="0.01" placeholder="0.15" value={maintenancePerMile} onChange={e => setMaintenancePerMile(e.target.value)} className="h-11 pl-9 rounded-xl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tax Rate (%)</Label>
                <Input type="number" step="1" placeholder="30" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="h-11 rounded-xl" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Other Expenses ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="number" step="0.01" placeholder="0.00" value={otherExpenses} onChange={e => setOtherExpenses(e.target.value)} className="h-11 pl-9 rounded-xl" />
              </div>
            </div>
          </CardContent>
        </Card>

        {hasAnyInput && calculation.ok === false && (
          <div role="alert" className="text-sm text-destructive">{calculation.errors.join(' ')}</div>
        )}
        {/* Results */}
        {results && (
          <Card className="shadow-card border-primary/20">
            <CardContent className="p-5 space-y-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Scenario Estimate</p>

              <div className="space-y-2">
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Gross Revenue</span>
                  <span className="text-lg font-bold font-mono text-primary">{formatCurrency(results.grossRevenue)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-t border-border/50">
                  <span className="text-sm text-muted-foreground">Fuel Cost</span>
                  <span className="text-sm font-mono text-destructive">−{formatCurrency(results.fuelCost)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-t border-border/50">
                  <span className="text-sm text-muted-foreground">Maintenance</span>
                  <span className="text-sm font-mono text-destructive">−{formatCurrency(results.nonFuelCost)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-t border-border/50">
                  <span className="text-sm text-muted-foreground">Tax Reserve Estimate</span>
                  <span className="text-sm font-mono text-destructive">−{formatCurrency(results.taxReserve)}</span>
                </div>
                {results.otherExpenses > 0 && (
                  <div className="flex justify-between items-center py-2 border-t border-border/50">
                    <span className="text-sm text-muted-foreground">Other Expenses</span>
                    <span className="text-sm font-mono text-destructive">−{formatCurrency(results.otherExpenses)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-t border-border/50">
                  <span className="text-sm text-muted-foreground">Operating Profit Estimate (before tax reserve)</span>
                  <span className="text-sm font-mono">{formatCurrency(results.operatingProfit)}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-t-2 border-primary/30">
                  <span className="font-bold">After-Tax Estimate</span>
                  <span className={`text-xl font-black font-mono ${results.afterTaxEstimate >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(results.afterTaxEstimate)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-t border-border/50">
                  <span className="text-sm text-muted-foreground">{Number(taxRate) > 0 ? 'After-tax estimate per mile' : 'Estimated operating profit per mile'}</span>
                  <span className="text-sm font-bold font-mono">${(Number(taxRate) > 0 ? results.profitPerMile : results.operatingProfitPerMile).toFixed(4)}/mi</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Tax reserve uses your entered percentage of gross revenue; it is not actual tax owed or a recorded financial report.</p>
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <Card className="shadow-card bg-primary/5 border-primary/20">
          <CardContent className="p-5 text-center space-y-3">
            <Truck className="h-8 w-8 text-primary mx-auto" />
            <p className="font-bold text-lg">Track every load automatically</p>
            <p className="text-sm text-muted-foreground">
              Stop calculating manually. HaulTrackerPro tracks loads, expenses, fuel, and profit in real time.
            </p>
            <Button className="gap-2 rounded-xl font-bold" onClick={() => navigate('/auth')}>
              Get Started Free <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
