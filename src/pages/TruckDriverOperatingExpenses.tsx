import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, DollarSign, Calculator, BarChart3, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const operatingExpenses = [
  { icon: '⛽', name: 'Fuel & Diesel', desc: 'The largest operating expense — typically 30–40% of total costs for most drivers.' },
  { icon: '🔧', name: 'Maintenance & Repairs', desc: 'Preventive maintenance, breakdowns, and parts replacement to keep the truck running.' },
  { icon: '🛡️', name: 'Insurance', desc: 'Required coverage including liability, cargo, physical damage, and workers comp.' },
  { icon: '💰', name: 'Truck Payment or Lease', desc: 'Monthly payment for financing or leasing your truck and/or trailer.' },
  { icon: '🛞', name: 'Tires', desc: 'Regular replacements, recaps, and emergency tire service on the road.' },
  { icon: '🅿️', name: 'Parking', desc: 'Truck stop parking fees, reserved spots, and overflow lot charges.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges on your routes.' },
  { icon: '🍔', name: 'Meals & Per Diem', desc: 'Food costs while away from home — deductible at 80% for truckers.' },
  { icon: '📱', name: 'Phone & Technology', desc: 'Cell service, ELD subscriptions, GPS, and load board memberships.' },
  { icon: '📋', name: 'Permits & Compliance', desc: 'IFTA, IRP, UCR, DOT physicals, drug tests, and regulatory fees.' },
];

export default function TruckDriverOperatingExpenses() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Truck Driver Operating Expenses | Full Cost Guide"
        description="Complete guide to truck driver operating expenses including fuel, maintenance, insurance, truck payments, and all costs of running a trucking business."
        path="/truck-driver-operating-expenses"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Truck Driver Operating Expenses | Full Cost Guide',
          description: 'Complete guide to truck driver operating expenses.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Operating Expenses</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Truck className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Truck Driver Operating Expenses</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Every expense involved in running a truck — from fuel to permits. Know your numbers.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track All Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Are Operating Expenses</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Operating expenses are all the costs required to keep your truck on the road and your business running. They include everything from fuel and maintenance to insurance and permits. For most truck drivers, total operating expenses range from $8,000 to $15,000 per month depending on truck age, miles driven, and region. Understanding these costs is the foundation of running a profitable trucking business.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">All Operating Expense Categories</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {operatingExpenses.map((e) => (
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
            <h2 className="text-2xl font-black font-heading">Monthly Operating Expense Example</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fuel</span><span className="font-semibold">$5,800</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Truck Payment</span><span className="font-semibold">$2,000</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Insurance</span><span className="font-semibold">$1,800</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Maintenance</span><span className="font-semibold">$1,200</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tires</span><span className="font-semibold">$400</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Parking, Tolls, Other</span><span className="font-semibold">$800</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Total Operating Expenses</span>
              <span className="font-black text-xl text-primary">$12,000</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            At 10,000 miles/month, this equals $1.20/mile in operating costs. You need to earn above this rate on every load to be profitable.
          </p>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro gives truck drivers a complete view of their operating expenses in one dashboard. Log every expense, see categorized totals, track cost per mile, and understand your real profit after all costs. With organized records, you can set minimum rates, plan for expenses, and have clean data ready for tax season.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/truck-driver-operating-expenses" />
      </main>
    </div>
  );
}
