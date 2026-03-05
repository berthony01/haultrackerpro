import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

const expenses = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs for daily driving, deadhead miles, and long-haul routes.' },
  { icon: '🔧', name: 'Truck Maintenance', desc: 'Oil changes, tire replacements, brake repairs, and preventive upkeep.' },
  { icon: '🛡️', name: 'Insurance', desc: 'Liability, cargo, physical damage, and bobtail insurance premiums.' },
  { icon: '🅿️', name: 'Parking', desc: 'Truck stop parking, rest area fees, and shipper/receiver lot charges.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges across your routes.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, gloves, and other load-securing gear.' },
  { icon: '🍔', name: 'Food on the Road', desc: 'Meals and per diem expenses while away from your tax home overnight.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone bills, mobile hotspots, and data plans for dispatch and ELD.' },
];

export default function OwnerOperatorSalary() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Owner Operator Salary | How Much Do Owner Operators Make?"
        description="Learn how much owner operator truck drivers make and how expenses affect trucking profit."
        path="/owner-operator-salary"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Owner Operator Salary | How Much Do Owner Operators Make?',
          description: 'Learn how much owner operator truck drivers make and how expenses affect trucking profit.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Owner Operator Salary</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TrendingUp className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Owner Operator Salary Explained</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand how much owner operator truck drivers really earn after expenses.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Your Profit <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Average Revenue */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Average Owner Operator Revenue</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Owner operators can generate significant revenue depending on miles driven, freight rates,
            and the lanes they run. Many gross between $150,000 and $300,000 or more per year. However,
            gross revenue is not take-home pay — operating expenses consume a large portion of every
            dollar earned. Understanding the difference between revenue and profit is the first step
            toward knowing what you actually make.
          </p>
        </section>

        {/* Common Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Expenses</h2>
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

        {/* Example Income Breakdown */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Example Income Breakdown</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Revenue</span>
              <span className="font-semibold">$18,000</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Expenses</span>
              <span className="font-semibold">−$10,500</span>
            </div>
            <div className="border-t border-border my-2" />
            <div className="flex justify-between text-base">
              <span className="font-semibold">Estimated Monthly Profit</span>
              <span className="font-black text-primary text-lg">$7,500</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Tracking expenses is essential to understanding your real income. Without clear records,
            it's impossible to know how much of your revenue you actually keep.
          </p>
        </section>

        {/* Why Drivers Miscalculate */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Many Drivers Miscalculate Profit</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Many owner operators focus on gross revenue — what they're paid per load or per mile — but
            forget to subtract the operating expenses that eat into every dollar. Fuel, insurance,
            maintenance, parking, tolls, and supplies add up fast. Without tracking these costs
            consistently, drivers overestimate their take-home pay and make financial decisions based
            on incomplete numbers.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks loads, revenue, and expenses so you always know your real profit.
            See exactly how much you're earning after every expense is accounted for — fuel, maintenance,
            parking, tolls, and more. No spreadsheets, no guessing. Just clear, accurate numbers that
            show what you actually take home.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Understand Your Real Trucking Income</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>
      </main>
    </div>
  );
}
