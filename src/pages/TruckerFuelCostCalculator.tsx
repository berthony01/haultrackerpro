import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Fuel, Calculator, DollarSign, BarChart3, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

export default function TruckerFuelCostCalculator() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucker Fuel Cost Calculator | Estimate Diesel Expenses"
        description="Use our trucker fuel cost calculator guide to estimate diesel expenses per trip, per mile, and per month based on your truck's MPG and diesel prices."
        path="/trucker-fuel-cost-calculator"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucker Fuel Cost Calculator | Estimate Diesel Expenses',
          description: 'Estimate diesel expenses per trip, per mile, and per month.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Fuel Cost Calculator</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Calculator className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucker Fuel Cost Calculator</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Estimate your diesel costs per trip, per mile, and per month with simple calculations.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Fuel Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Fuel className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How to Calculate Fuel Costs</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            The basic fuel cost formula is simple: divide total trip miles by your truck's MPG to get gallons needed, then multiply by the diesel price per gallon. This gives you total fuel cost for any trip. Divide by miles for your fuel cost per mile.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Per-Trip Fuel Cost Example</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Trip Distance</span><span className="font-semibold">1,200 miles</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Truck MPG</span><span className="font-semibold">6.0</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Gallons Needed</span><span className="font-semibold">200</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Diesel Price / Gallon</span><span className="font-semibold">$3.90</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Trip Fuel Cost</span>
              <span className="font-black text-xl text-primary">$780</span>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Monthly Fuel Estimate</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Monthly Miles</span><span className="font-semibold">10,000</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">MPG</span><span className="font-semibold">6.0</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Gallons / Month</span><span className="font-semibold">1,667</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Diesel Price</span><span className="font-semibold">$3.90</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Monthly Fuel Cost</span>
              <span className="font-black text-xl text-primary">$6,500</span>
            </div>
            <div className="flex justify-between text-sm pt-1">
              <span className="text-muted-foreground">Fuel Cost Per Mile</span>
              <span className="font-semibold text-primary">$0.65</span>
            </div>
          </div>
        </section>

        <ProblemSolutionSection />
        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Estimating Fuel Costs Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Knowing your fuel cost before accepting a load helps you decide if the rate is profitable. A 1,200-mile load at $2.00/mile grosses $2,400 — but if fuel costs $780, your margin is already reduced by a third before other expenses. Drivers who estimate fuel costs upfront make better load decisions and protect their profit.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks every fuel purchase automatically. Log gallons, cost, and see your fuel cost per mile calculated in real time. Compare fuel spending across weeks and months, and have accurate fuel records ready for tax deductions. No manual calculations needed.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/trucker-fuel-cost-calculator" />
      </main>
    </div>
  );
}
