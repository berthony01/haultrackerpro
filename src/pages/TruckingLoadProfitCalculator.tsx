import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calculator, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

export default function TruckingLoadProfitCalculator() {
  const navigate = useNavigate();
  const [loadPay, setLoadPay] = useState('');
  const [totalMiles, setTotalMiles] = useState('');
  const [costPerMile, setCostPerMile] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const [otherExpenses, setOtherExpenses] = useState('');
  const [result, setResult] = useState<{
    ratePerMile: number;
    totalCost: number;
    profit: number;
    profitPerMile: number;
  } | null>(null);

  const handleCalculate = () => {
    const pay = parseFloat(loadPay) || 0;
    const miles = parseFloat(totalMiles) || 0;
    const cpm = parseFloat(costPerMile) || 0;
    const fuel = parseFloat(fuelCost) || 0;
    const other = parseFloat(otherExpenses) || 0;

    if (miles > 0 && pay > 0) {
      const totalCost = cpm * miles + fuel + other;
      const profit = pay - totalCost;
      setResult({
        ratePerMile: pay / miles,
        totalCost,
        profit,
        profitPerMile: profit / miles,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Load Profit Calculator | Is This Load Worth It?"
        description="Calculate your real profit before accepting a trucking load. Enter load pay, miles, and expenses to see rate per mile, total cost, and estimated profit."
        path="/trucking-load-profit-calculator"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Is This Trucking Load Profitable?',
          description: 'Interactive calculator to help owner operators determine if a load is profitable before accepting it.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-black font-heading">Is This Trucking Load Profitable?</h1>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Calculate your real profit before accepting a load.
          </p>
        </header>

        {/* Calculator */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Enter Load Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Load Pay ($)', value: loadPay, set: setLoadPay, placeholder: 'e.g. 3200' },
                { label: 'Total Miles', value: totalMiles, set: setTotalMiles, placeholder: 'e.g. 1200' },
                { label: 'Estimated Cost Per Mile ($)', value: costPerMile, set: setCostPerMile, placeholder: 'e.g. 1.50' },
                { label: 'Fuel Cost (optional) ($)', value: fuelCost, set: setFuelCost, placeholder: 'e.g. 400' },
                { label: 'Other Expenses (optional) ($)', value: otherExpenses, set: setOtherExpenses, placeholder: 'e.g. 100' },
              ].map((field) => (
                <div key={field.label} className="space-y-1.5">
                  <Label>{field.label}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={field.placeholder}
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                  />
                </div>
              ))}
            </div>

            <Button className="w-full gap-2" size="lg" onClick={handleCalculate}>
              <Calculator className="h-4 w-4" /> Calculate
            </Button>

            {result && (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3 text-center">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Rate Per Mile</p>
                    <p className="text-2xl font-black text-foreground">${result.ratePerMile.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Cost</p>
                    <p className="text-2xl font-black text-foreground">${result.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <div className="h-px bg-border" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Estimated Profit</p>
                    <p className={`text-2xl font-black ${result.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      ${result.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Profit Per Mile</p>
                    <p className={`text-2xl font-black ${result.profitPerMile >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      ${result.profitPerMile.toFixed(4)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Profit = Load Pay − (Cost Per Mile × Miles + Fuel + Other)</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Example */}
        <section className="space-y-3">
          <h2 className="text-2xl font-black font-heading">Example Calculation</h2>
          <Card>
            <CardContent className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground leading-relaxed">
                A driver is offered a load paying <strong className="text-foreground">$3,200</strong> for <strong className="text-foreground">1,200 miles</strong>. Their estimated cost per mile is <strong className="text-foreground">$1.50</strong>, with <strong className="text-foreground">$400</strong> in fuel and <strong className="text-foreground">$100</strong> in tolls.
              </p>
              <div className="rounded-lg bg-muted/50 p-4 space-y-1 text-sm">
                <p className="font-semibold text-foreground">Rate Per Mile: $3,200 ÷ 1,200 = $2.67/mile</p>
                <p className="font-semibold text-foreground">Total Cost: ($1.50 × 1,200) + $400 + $100 = $2,300</p>
                <p className="font-semibold text-foreground">Estimated Profit: $3,200 − $2,300 = <span className="text-primary">$900</span></p>
                <p className="font-semibold text-foreground">Profit Per Mile: $900 ÷ 1,200 = <span className="text-primary">$0.75/mile</span></p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This load is profitable. Without knowing total costs, the driver might only look at the $2.67 rate per mile — but real profit depends on expenses.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Explanation */}
        <section className="space-y-3">
          <h2 className="text-2xl font-black font-heading">Why This Matters</h2>
          <p className="text-muted-foreground leading-relaxed">
            Most drivers evaluate loads based on rate per mile alone, but that number means nothing without knowing your real cost per mile. A $3.00/mile load can lose money if your operating costs are $3.10/mile. Knowing your true expenses — fuel, insurance, maintenance, truck payments, and incidentals — is the only way to determine whether a load puts money in your pocket or takes it out.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Calculating profit before accepting a load helps you set minimum rate thresholds, avoid unprofitable freight, and make smarter decisions about which loads to run.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              'Avoid accepting loads that lose money',
              'Set a minimum profitable rate per mile',
              'Factor in deadhead miles and extra costs',
              'Make data-driven dispatching decisions',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
          <h2 className="text-xl font-black font-heading">Track Every Load Automatically</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Stop guessing your trucking profit. HaulTrackerPro automatically tracks loads, expenses, and real profit per mile — so you always know which loads are worth running.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/trucking-load-profit-calculator" />
      </div>
    </div>
  );
}
