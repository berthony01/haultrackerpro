import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, BarChart3, ClipboardList, AlertTriangle, CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

const trackItems = [
  { icon: '📦', name: 'Loads & Revenue', desc: 'Every load picked up, delivered, and invoiced — with rate per mile and total pay.' },
  { icon: '⛽', name: 'Fuel Costs', desc: 'Diesel fill-ups across routes, including gallons and price per gallon.' },
  { icon: '🅿️', name: 'Parking', desc: 'Paid parking at truck stops, rest areas, and shipper/receiver lots.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges on every route.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, gloves, flashlights, and load-securing gear.' },
  { icon: '🔧', name: 'Maintenance', desc: 'Oil changes, tire replacements, brake repairs, and preventive upkeep.' },
  { icon: '🍔', name: 'Food & Daily Expenses', desc: 'Meals and per diem while away from your tax home overnight.' },
];

export default function TruckerBookkeepingGuide() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucker Bookkeeping Guide | Simple Accounting for Drivers"
        description="Learn the basics of trucking bookkeeping including tracking loads, expenses, and profit for owner operators."
        path="/trucker-bookkeeping-guide"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucker Bookkeeping Guide | Simple Accounting for Drivers',
          description: 'Learn the basics of trucking bookkeeping including tracking loads, expenses, and profit for owner operators.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Trucker Bookkeeping Guide</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex justify-center">
            <BookOpen className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucker Bookkeeping Guide</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Learn how to manage trucking finances the simple way.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Tracking Finances <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Why Bookkeeping Matters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Bookkeeping Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Proper bookkeeping is the foundation of a profitable trucking business. Without it, drivers
            have no clear picture of how much they're actually earning — or how much they're losing to
            expenses. Good records help you understand your real profit margins, prepare accurate tax
            filings, and make smarter decisions about which loads to take. When tax season arrives,
            organized books mean fewer surprises and more deductions you can confidently claim.
          </p>
        </section>

        {/* What Drivers Should Track */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Drivers Should Track</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {trackItems.map((item) => (
              <div key={item.name} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-card">
                <span className="text-2xl leading-none mt-0.5">{item.icon}</span>
                <div>
                  <p className="font-semibold text-sm">{item.name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The Problem */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">The Problem with Manual Bookkeeping</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Many owner operators still rely on spreadsheets, notebooks, or shoeboxes full of receipts to
            track their finances. These methods are time-consuming, error-prone, and easy to fall behind on.
            A missed entry or lost receipt can mean hundreds of dollars in unclaimed deductions. Manual
            tracking also makes it nearly impossible to see weekly or monthly trends, leaving drivers
            guessing about their real profitability until it's too late.
          </p>
        </section>

        {/* The Solution */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">The Simple Solution</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro organizes all your trucking financial data automatically. Every load, expense,
            and mile is tracked in one place — no spreadsheets, no paper receipts, no guessing. You'll
            always know your real profit, see weekly summaries at a glance, and have clean records ready
            when it's time to file taxes. It's bookkeeping made simple for drivers who'd rather be on
            the road than behind a desk.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Simplify Your Trucking Bookkeeping</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/trucker-bookkeeping-guide" />
      </main>
    </div>
  );
}
