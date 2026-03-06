import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gauge, DollarSign, Calculator, BarChart3, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const costCategories = [
  { icon: '⛽', name: 'Fuel', range: '$0.50–$0.70', desc: 'Largest variable cost — depends on MPG, diesel prices, and route.' },
  { icon: '💰', name: 'Truck Payment', range: '$0.15–$0.25', desc: 'Monthly truck loan or lease payment divided by miles driven.' },
  { icon: '🛡️', name: 'Insurance', range: '$0.05–$0.12', desc: 'All insurance premiums spread across monthly miles.' },
  { icon: '🔧', name: 'Maintenance', range: '$0.10–$0.20', desc: 'Repairs, oil changes, preventive services, and parts.' },
  { icon: '🛞', name: 'Tires', range: '$0.03–$0.06', desc: 'Tire replacements, recaps, and road service.' },
  { icon: '🅿️', name: 'Parking & Tolls', range: '$0.03–$0.08', desc: 'Truck stop fees, rest area charges, and highway tolls.' },
  { icon: '📋', name: 'Permits & Fees', range: '$0.02–$0.04', desc: 'IFTA, IRP, UCR, and other regulatory fees.' },
  { icon: '📱', name: 'Communication', range: '$0.01–$0.02', desc: 'Phone, data plans, and ELD subscription costs.' },
];

export default function TruckerCostPerMileBreakdown() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucker Cost Per Mile Breakdown | Complete Analysis"
        description="Detailed trucker cost per mile breakdown covering fuel, truck payments, insurance, maintenance, tires, and every operating expense category."
        path="/trucker-cost-per-mile-breakdown"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucker Cost Per Mile Breakdown | Complete Analysis',
          description: 'Detailed trucker cost per mile breakdown for owner operators.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Cost Per Mile Breakdown</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Gauge className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucker Cost Per Mile Breakdown</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            See exactly where every cent per mile goes in your trucking operation.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Your Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Understanding Cost Per Mile</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Your total cost per mile is the sum of every expense category divided by miles driven. Most owner operators operate between $1.00 and $1.80 per mile in total costs. Knowing this number is critical — it's the minimum rate you need to break even, and every cent below it means you're losing money.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Cost Breakdown by Category</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {costCategories.map((e) => (
              <div key={e.name} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-card">
                <span className="text-2xl leading-none mt-0.5">{e.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{e.name}</p>
                    <span className="text-xs font-mono text-primary">{e.range}</span>
                  </div>
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
            <h2 className="text-2xl font-black font-heading">Full Cost Per Mile Example</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fuel</span><span className="font-semibold">$0.58</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Truck Payment</span><span className="font-semibold">$0.20</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Insurance</span><span className="font-semibold">$0.08</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Maintenance</span><span className="font-semibold">$0.15</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tires</span><span className="font-semibold">$0.04</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Parking & Tolls</span><span className="font-semibold">$0.05</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Permits & Fees</span><span className="font-semibold">$0.03</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Communication</span><span className="font-semibold">$0.01</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Total Cost Per Mile</span>
              <span className="font-black text-xl text-primary">$1.14</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            With a total cost of $1.14/mile, you need loads paying above this rate to be profitable. A $1.50/mile load nets $0.36/mile in profit.
          </p>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro automatically calculates your cost per mile by tracking every expense and every mile you drive. See a real-time breakdown of where your money goes, compare costs week over week, and set your minimum rate with confidence. Stop guessing and start knowing your numbers.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/trucker-cost-per-mile-breakdown" />
      </main>
    </div>
  );
}
