import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calculator, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { FinalCTASection } from '@/components/SEOConversionSections';

export default function TruckingCostPerMileCalculator() {
  const navigate = useNavigate();
  const [miles, setMiles] = useState('');
  const [fuel, setFuel] = useState('');
  const [maintenance, setMaintenance] = useState('');
  const [insurance, setInsurance] = useState('');
  const [truckPayment, setTruckPayment] = useState('');
  const [other, setOther] = useState('');
  const [result, setResult] = useState<{ total: number; cpm: number } | null>(null);

  const handleCalculate = () => {
    const m = parseFloat(miles) || 0;
    const totalExpenses =
      (parseFloat(fuel) || 0) +
      (parseFloat(maintenance) || 0) +
      (parseFloat(insurance) || 0) +
      (parseFloat(truckPayment) || 0) +
      (parseFloat(other) || 0);
    if (m > 0) {
      setResult({ total: totalExpenses, cpm: totalExpenses / m });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Cost Per Mile Calculator | Owner Operator Tool"
        description="Calculate your real trucking cost per mile. Enter fuel, maintenance, insurance, truck payment, and other expenses to see your true operating cost."
        path="/trucking-cost-per-mile-calculator"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Cost Per Mile Calculator',
          description: 'Interactive calculator for owner operators to determine their real cost per mile.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-10">
        {/* Back */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* Title */}
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-black font-heading">Trucking Cost Per Mile Calculator</h1>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Calculate the real operating cost of your truck per mile.
          </p>
        </header>

        {/* Calculator */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Enter Your Monthly Expenses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Miles Driven', value: miles, set: setMiles, placeholder: 'e.g. 10000' },
                { label: 'Fuel Cost ($)', value: fuel, set: setFuel, placeholder: 'e.g. 4500' },
                { label: 'Maintenance Cost ($)', value: maintenance, set: setMaintenance, placeholder: 'e.g. 800' },
                { label: 'Insurance Cost ($)', value: insurance, set: setInsurance, placeholder: 'e.g. 1200' },
                { label: 'Truck Payment ($)', value: truckPayment, set: setTruckPayment, placeholder: 'e.g. 1800' },
                { label: 'Other Expenses ($)', value: other, set: setOther, placeholder: 'e.g. 600' },
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
                <p className="text-sm text-muted-foreground">Total Monthly Operating Cost</p>
                <p className="text-3xl font-black text-foreground">${result.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <div className="h-px bg-border" />
                <p className="text-sm text-muted-foreground">Cost Per Mile</p>
                <p className="text-3xl font-black text-primary">${result.cpm.toFixed(4)}</p>
                <p className="text-xs text-muted-foreground">Formula: Total Expenses ÷ Miles Driven</p>
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
                An owner-operator drives <strong className="text-foreground">10,000 miles</strong> in a month with the following expenses:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                <li>Fuel: $4,500</li>
                <li>Maintenance: $800</li>
                <li>Insurance: $1,200</li>
                <li>Truck Payment: $1,800</li>
                <li>Other (tolls, parking, supplies): $600</li>
              </ul>
              <div className="rounded-lg bg-muted/50 p-4 space-y-1">
                <p className="text-sm font-semibold text-foreground">Total Expenses: $8,900</p>
                <p className="text-sm font-semibold text-foreground">Cost Per Mile: $8,900 ÷ 10,000 = <span className="text-primary">$0.89/mile</span></p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This means it costs $0.89 for every mile driven. To be profitable, loads must pay more than this rate after all expenses.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Explanation */}
        <section className="space-y-3">
          <h2 className="text-2xl font-black font-heading">Why Cost Per Mile Matters</h2>
          <p className="text-muted-foreground leading-relaxed">
            Cost per mile is the single most important number for any owner-operator. Without knowing your true operating cost, 
            you cannot determine whether a load is profitable. Many drivers accept loads based on gross revenue alone, but the 
            real question is whether the rate per mile exceeds the cost per mile.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Tracking cost per mile helps you set minimum rate requirements, identify which expenses are rising, negotiate better 
            rates with brokers, and plan for seasonal fluctuations. Drivers who know their cost per mile make better business 
            decisions and keep more of what they earn.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              'Set minimum rate per mile targets',
              'Identify rising expense categories',
              'Negotiate from a position of knowledge',
              'Plan for seasonal revenue changes',
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
          <h2 className="text-xl font-black font-heading">Track It Automatically</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
            HaulTrackerPro automatically tracks your expenses and calculates profit per load — so you always know your real cost per mile.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/trucking-cost-per-mile-calculator" />
      </div>
    </div>
  );
}
