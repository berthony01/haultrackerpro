import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const fixedCosts = [
  { icon: '💰', name: 'Truck Payment', desc: 'Monthly loan or lease payment — typically $1,500–$2,500/month.' },
  { icon: '🛡️', name: 'Insurance', desc: 'Liability, cargo, physical damage, and bobtail — $1,200–$2,500/month.' },
  { icon: '📋', name: 'Permits & Licensing', desc: 'IFTA, IRP, UCR, authority, and DOT fees — $200–$500/month averaged.' },
  { icon: '📱', name: 'Technology & Subscriptions', desc: 'ELD, GPS, load board subscriptions, and accounting software.' },
];

const variableCosts = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs that scale with miles driven — the largest variable expense.' },
  { icon: '🔧', name: 'Maintenance & Repairs', desc: 'Routine maintenance and unexpected repairs that increase with usage.' },
  { icon: '🛞', name: 'Tires', desc: 'Tire wear and replacements that correlate with miles driven.' },
  { icon: '🅿️', name: 'Parking & Tolls', desc: 'Route-dependent costs that vary by trip and region.' },
];

export default function OwnerOperatorOperatingCosts() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Owner Operator Operating Costs | Fixed & Variable Expenses"
        description="Complete breakdown of owner operator operating costs including fixed expenses like insurance and truck payments, and variable costs like fuel and maintenance."
        path="/owner-operator-operating-costs"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Owner Operator Operating Costs | Fixed & Variable Expenses',
          description: 'Complete breakdown of owner operator operating costs.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Operating Costs</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Truck className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Owner Operator Operating Costs</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand every cost of running your trucking business — fixed and variable.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Operating Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Fixed vs. Variable Costs</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Operating costs fall into two categories: fixed costs that stay the same regardless of miles driven (truck payment, insurance, permits), and variable costs that increase with usage (fuel, maintenance, tires). Understanding both is essential for setting minimum rates and forecasting profitability.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Fixed Monthly Costs</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fixedCosts.map((e) => (
              <div key={e.name} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-card">
                <span className="text-2xl leading-none mt-0.5">{e.icon}</span>
                <div>
                  <p className="font-semibold text-sm">{e.name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{e.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Variable Costs</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {variableCosts.map((e) => (
              <div key={e.name} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-card">
                <span className="text-2xl leading-none mt-0.5">{e.icon}</span>
                <div>
                  <p className="font-semibold text-sm">{e.name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{e.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <ProblemSolutionSection />

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Monthly Operating Cost Example</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Fixed Costs</p>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Truck Payment</span><span className="font-semibold">$2,000</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Insurance</span><span className="font-semibold">$1,800</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Permits & Fees</span><span className="font-semibold">$300</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subscriptions</span><span className="font-semibold">$150</span></div>
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mt-4 mb-2">Variable Costs</p>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fuel</span><span className="font-semibold">$5,800</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Maintenance</span><span className="font-semibold">$1,500</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tires</span><span className="font-semibold">$400</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Parking & Tolls</span><span className="font-semibold">$500</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Total Monthly Operating Cost</span>
              <span className="font-black text-xl text-primary">$12,450</span>
            </div>
          </div>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks both fixed and variable operating costs in one place. See your total monthly operating costs, cost per mile, and profit after all expenses. Know exactly what it costs to run your truck so you can set rates, evaluate loads, and plan for the future with confidence.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/owner-operator-operating-costs" />
      </main>
    </div>
  );
}
