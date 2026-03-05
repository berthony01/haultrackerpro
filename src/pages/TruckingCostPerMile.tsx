import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Gauge, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

const expenses = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs that fluctuate with routes, speed, and market prices.' },
  { icon: '🔧', name: 'Maintenance', desc: 'Oil changes, brake repairs, engine work, and preventive upkeep.' },
  { icon: '🛞', name: 'Tires', desc: 'Replacement tires, retreads, and blowout-related repairs.' },
  { icon: '🛡️', name: 'Insurance', desc: 'Liability, cargo, physical damage, and bobtail insurance premiums.' },
  { icon: '🅿️', name: 'Parking', desc: 'Truck stop parking, rest area fees, and lot charges.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, and load-securing gear.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone, mobile hotspot, and data plans for dispatch and ELD.' },
];

export default function TruckingCostPerMile() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Cost Per Mile | Calculate Operating Cost"
        description="Learn how to calculate trucking cost per mile including fuel, maintenance, insurance, and other operating expenses."
        path="/trucking-cost-per-mile"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Cost Per Mile | Calculate Operating Cost',
          description: 'Learn how to calculate trucking cost per mile including fuel, maintenance, insurance, and other operating expenses.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Cost Per Mile</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Gauge className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucking Cost Per Mile Explained</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand the real operating cost of running a truck.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Trucking Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* What Is Cost Per Mile */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Is Cost Per Mile</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Cost per mile measures how much it costs to operate a truck for every mile driven. It's
            calculated by dividing your total operating expenses by the number of miles you drive in a
            given period. Knowing your cost per mile is essential for evaluating whether a load is
            profitable — if the rate per mile you're paid is lower than your cost per mile, you're
            losing money on that load.
          </p>
        </section>

        {/* Common Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Cost Per Mile Expenses</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {expenses.map((e) => (
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

        {/* Example Calculation */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Example Cost Per Mile Calculation</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Expenses</span>
              <span className="font-semibold">$9,000</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Miles Driven</span>
              <span className="font-semibold">10,000</span>
            </div>
            <div className="border-t border-border my-2" />
            <div className="flex justify-between text-base">
              <span className="font-semibold">Cost Per Mile</span>
              <span className="font-black text-primary text-lg">$0.90</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Knowing your cost per mile helps you choose profitable loads. If a load pays $1.50 per mile
            and your cost is $0.90, you're netting $0.60 per mile. Without this number, you're guessing.
          </p>
        </section>

        {/* Why Drivers Lose Money */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Many Drivers Lose Money</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Without knowing their cost per mile, drivers may accept loads that look profitable on the
            surface but actually lose money once expenses are factored in. A $2.00 per mile rate sounds
            great — until you realize your operating costs are $1.10 per mile and the load includes 200
            deadhead miles. Drivers who don't track expenses consistently have no way to calculate this
            number accurately, leading to poor load decisions and shrinking margins.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks expenses automatically and helps drivers understand their real
            operating costs. Every expense you log — fuel, maintenance, parking, tolls, and more —
            feeds into a clear picture of what it costs to run your truck. With accurate data, you
            can calculate your cost per mile, evaluate loads with confidence, and make smarter
            business decisions.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Track Your Trucking Costs Automatically</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/trucking-cost-per-mile" />
      </main>
    </div>
  );
}
