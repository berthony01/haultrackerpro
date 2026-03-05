import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, DollarSign, BarChart3, CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

const expenses = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs for daily driving, deadhead miles, and long-haul routes — often the largest single expense.' },
  { icon: '🅿️', name: 'Parking', desc: 'Truck stop parking, rest area fees, and shipper/receiver lot charges that add up week after week.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges across every route you run.' },
  { icon: '🔧', name: 'Maintenance', desc: 'Oil changes, tire replacements, brake repairs, and preventive upkeep to keep your truck running.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, gloves, flashlights, and other load-securing gear.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Truck wash, interior cleaning products, and laundry expenses on the road.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone bills, mobile hotspots, and data plans used for dispatch, load boards, and ELD.' },
  { icon: '🍔', name: 'Food on the Road', desc: 'Meals and per diem expenses while away from your tax home overnight.' },
];

export default function TruckDriverExpenses() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Truck Driver Expenses | Complete List for Owner Operators"
        description="Learn all common truck driver expenses including fuel, tolls, parking, supplies, maintenance, and communication costs."
        path="/truck-driver-expenses"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Truck Driver Expenses | Complete List for Owner Operators',
          description: 'Learn all common truck driver expenses including fuel, tolls, parking, supplies, maintenance, and communication costs.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Truck Driver Expenses</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Truck className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Truck Driver Expenses Explained</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand every expense truck drivers face on the road.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Your Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Major Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Major Truck Driver Expenses</h2>
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

        {/* Why Tracking Matters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Tracking Expenses Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Every dollar you spend on the road is a potential tax deduction — but only if you have proof.
            Tracking expenses consistently lowers your taxable income, which means you keep more of what
            you earn. Without organized records, deductions slip through the cracks and you end up paying
            the IRS more than you owe. The drivers who save the most at tax time are the ones who track
            every expense as it happens, not the ones scrambling for receipts in April.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro automatically organizes every trucking expense you log — fuel, parking, tolls,
            maintenance, and more. Categorize expenses in seconds from your phone, see exactly where your
            money goes each week, and have clean, tax-ready records when filing season arrives. No
            spreadsheets, no shoeboxes, no guesswork.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Track Trucking Expenses Automatically</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/truck-driver-expenses" />
      </main>
    </div>
  );
}
