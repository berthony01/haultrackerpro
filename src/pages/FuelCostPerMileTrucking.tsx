import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Fuel, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

export default function FuelCostPerMileTrucking() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Fuel Cost Per Mile Trucking | Calculate Your Diesel Costs"
        description="Learn how to calculate fuel cost per mile for trucking. Understand diesel expenses, MPG impact, and how to lower your fuel cost per mile."
        path="/fuel-cost-per-mile-trucking"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Fuel Cost Per Mile Trucking | Calculate Your Diesel Costs',
          description: 'Learn how to calculate fuel cost per mile for trucking.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Fuel Cost Per Mile</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Fuel className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Fuel Cost Per Mile in Trucking</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Fuel is the single largest expense for most truck drivers. Learn how to calculate and reduce your fuel cost per mile.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Fuel Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Is Fuel Cost Per Mile</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Fuel cost per mile is the amount you spend on diesel for every mile you drive. It's calculated by dividing your total fuel cost by total miles driven. This metric helps you evaluate whether a load is worth hauling after fuel expenses. For most owner operators, fuel accounts for 30–40% of total operating costs, making it the most important expense to track accurately.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How to Calculate Fuel Cost Per Mile</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <p className="text-sm text-muted-foreground mb-4">Formula: Fuel Cost Per Mile = Total Fuel Cost ÷ Total Miles Driven</p>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Diesel Price Per Gallon</span>
              <span className="font-semibold">$3.80</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Truck MPG</span>
              <span className="font-semibold">6.5 MPG</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Miles Driven (Monthly)</span>
              <span className="font-semibold">10,000</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Fuel Cost</span>
              <span className="font-semibold">$5,846</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Fuel Cost Per Mile</span>
              <span className="font-black text-xl text-primary">$0.58</span>
            </div>
          </div>
        </section>

        <ProblemSolutionSection />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Fuel Cost Per Mile Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            If you don't know your fuel cost per mile, you can't evaluate loads accurately. A load paying $2.00/mile looks great — but if your fuel alone costs $0.65/mile and total operating costs are $1.50/mile, your real margin is thin. Drivers who track fuel cost per mile can spot bad loads before accepting them, plan better routes, and identify when their truck's efficiency is declining.
          </p>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro lets you log every fuel purchase in seconds — including gallons, cost, and location. Your fuel cost per mile is calculated automatically so you always know where your biggest expense stands. Compare fuel costs week over week, spot trends, and make smarter decisions about routes and loads.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/fuel-cost-per-mile-trucking" />
      </main>
    </div>
  );
}
