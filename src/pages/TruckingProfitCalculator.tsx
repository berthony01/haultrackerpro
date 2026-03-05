import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, HelpCircle, DollarSign, Calculator, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

const expenses = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs for loaded and deadhead miles across every route.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges.' },
  { icon: '🅿️', name: 'Truck Parking', desc: 'Paid parking at truck stops, rest areas, and facilities.' },
  { icon: '🔧', name: 'Truck Maintenance', desc: 'Oil changes, tires, brakes, and preventive repairs.' },
  { icon: '🍔', name: 'Food on the Road', desc: 'Meals and per diem while away from your tax home overnight.' },
  { icon: '📱', name: 'Internet & Communication', desc: 'Cell phone, mobile hotspot, and data plans for dispatch.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, gloves, and load-securing gear.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Truck wash, interior cleaning, and laundry on the road.' },
];

export default function TruckingProfitCalculator() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Profit Calculator | Estimate Owner Operator Profit"
        description="Calculate trucking profit after expenses, fuel, parking, and taxes. Use the trucking profit calculator built for owner operators."
        path="/trucking-profit-calculator"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Profit Calculator | Estimate Owner Operator Profit',
          description: 'Calculate trucking profit after expenses, fuel, parking, and taxes.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Trucking Profit Calculator</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center space-y-4 py-4">
          <div className="flex justify-center">
            <TrendingUp className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucking Profit Calculator for Owner Operators</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Estimate your real profit after fuel, parking, tolls, maintenance, and taxes.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Tracking Profit <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Why Drivers Need a Profit Calculator */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Drivers Need a Profit Calculator</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Most truck drivers focus on revenue per mile — but that number doesn't tell the full story. After
            fuel, tolls, parking, maintenance, food, and supplies, your actual take-home profit can be dramatically
            lower than expected. Without tracking real expenses against every load, it's impossible to know which
            lanes are profitable and which ones are costing you money.
          </p>
        </section>

        {/* Expenses That Reduce Profit */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Expenses That Reduce Profit</h2>
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

        {/* Example Profit Calculation */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Example Profit Calculation</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Revenue</span>
              <span className="font-bold text-lg">$8,000</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Expenses</span>
              <span className="font-bold text-lg text-destructive">− $4,200</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-sm font-semibold">Estimated Profit</span>
              <span className="font-black text-xl text-primary">$3,800</span>
            </div>
          </div>
        </section>

        {/* Solution */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Always Know Your Real Profit</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro automatically tracks your loads and expenses so you always know your real profit —
            not just your gross revenue. See per-load profitability, weekly summaries, and expense breakdowns
            without spreadsheets or guesswork.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Know Your Real Trucking Profit</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      </main>
    </div>
  );
}
