import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, DollarSign, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

const expenses = [
  { icon: '🅿️', name: 'Parking', desc: 'Truck stop parking, rest area fees, and shipper/receiver lot charges.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges across routes.' },
  { icon: '⛽', name: 'Fuel', desc: 'Diesel fuel costs for daily driving, deadhead miles, and long-haul routes.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, and other load-securing gear.' },
  { icon: '🔧', name: 'Maintenance', desc: 'Oil changes, tire replacements, brake repairs, and preventive upkeep.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone bills, mobile hotspots, and data plans used for dispatch and load boards.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Truck wash, interior cleaning products, and laundry on the road.' },
  { icon: '🍔', name: 'Food While on the Road', desc: 'Meals and per diem expenses while away from your tax home overnight.' },
];

export default function OwnerOperatorExpenseTracker() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Owner Operator Expense Tracker | Track Trucking Expenses Easily"
        description="Track trucking expenses like parking, tolls, maintenance, and supplies with an expense tracker designed for owner operators."
        path="/owner-operator-expense-tracker"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Owner Operator Expense Tracker | Track Trucking Expenses Easily',
          description: 'Track trucking expenses like parking, tolls, maintenance, and supplies with an expense tracker designed for owner operators.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Owner Operator Expense Tracker</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Introduction */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Tracking Trucking Expenses Is Hard</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Owner operators juggle dozens of expenses every week — fuel, parking, tolls, meals, supplies, and more.
            Keeping track of every receipt while driving thousands of miles is nearly impossible with pen and paper.
            Spreadsheets get messy fast, and without a system, expenses slip through the cracks. That means lost
            deductions and higher taxes at the end of the year.
          </p>
        </section>

        {/* Common Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Expenses Owner Operators Track</h2>
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

        {/* Problem Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Lost Receipts Cost You Money</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Every lost receipt is a missed deduction. Without documentation, you can't claim expenses at tax time —
            and without deductions, you're paying taxes on your full gross income. The IRS requires proof for every
            write-off. Drivers who rely on memory or shoeboxes of receipts routinely overpay by thousands of dollars
            each year. The solution isn't working harder to save receipts — it's using a system that tracks them for you.
          </p>
        </section>

        {/* Solution Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">A Simpler Way to Track Expenses</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro is a digital expense tracker built specifically for owner operators. Log expenses in
            seconds from your phone, categorize them automatically, and have everything organized when tax season
            arrives. No more lost receipts, no more guessing — just clean records that save you money.
          </p>
        </section>

        {/* CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Track expenses automatically with HaulTrackerPro.</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            View Pricing <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      </main>
    </div>
  );
}
