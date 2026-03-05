import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, DollarSign, AlertTriangle, Calculator, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const commonExpenses = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs for loaded miles, deadhead miles, and idling — typically the largest expense.' },
  { icon: '🛡️', name: 'Insurance', desc: 'Liability, cargo, physical damage, and bobtail insurance premiums.' },
  { icon: '🔧', name: 'Maintenance', desc: 'Oil changes, brake repairs, engine work, and preventive upkeep.' },
  { icon: '🛞', name: 'Tires', desc: 'Tire replacements, recaps, and emergency blowout repairs on the road.' },
  { icon: '🅿️', name: 'Parking', desc: 'Paid parking at truck stops, rest areas, and shipper/receiver lots.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges across every route.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, gloves, flashlights, and load-securing gear.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Interior cleaning products, laundry on the road, and general upkeep.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone bills, mobile hotspots, and data plans for dispatch, load boards, and ELD.' },
  { icon: '🍔', name: 'Meals on the Road', desc: 'Food and per diem expenses while away from your tax home overnight.' },
];

const hiddenExpenses = [
  { icon: '🚿', name: 'Truck Washes', desc: 'Exterior truck washes and trailer washouts between loads.' },
  { icon: '⚖️', name: 'Scale Fees', desc: 'Weigh station fees and CAT scale charges to verify load weight.' },
  { icon: '🔦', name: 'Small Equipment', desc: 'Replacement flashlights, gloves, safety vests, and other small gear purchases.' },
  { icon: '🅿️', name: 'Overflow Parking', desc: 'Extra parking costs when fuel points or free spots are unavailable.' },
];

export default function OwnerOperatorExpensesList() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Owner Operator Expenses List | Complete Guide for Truck Drivers"
        description="Learn the most common owner operator trucking expenses including fuel, maintenance, parking, tolls, truck supplies, and operating costs."
        path="/owner-operator-expenses-list"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Owner Operator Expenses List | Complete Guide for Truck Drivers',
          description: 'Learn the most common owner operator trucking expenses including fuel, maintenance, parking, tolls, truck supplies, and operating costs.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Owner Operator Expenses List</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ClipboardList className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Owner Operator Expenses List</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            See the full list of expenses owner operators should track to understand their real profit.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Tracking Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Common Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Owner Operator Expenses</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {commonExpenses.map((e) => (
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

        {/* Hidden Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Hidden Expenses Many Drivers Forget</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Beyond the obvious costs, these smaller expenses add up fast and are easy to overlook when tracking finances manually.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {hiddenExpenses.map((e) => (
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

        <MidPageCTA />

        {/* Example Breakdown */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Example Monthly Expense Breakdown</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Fuel</span>
              <span className="font-bold">$6,000</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Maintenance</span>
              <span className="font-bold">$1,200</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Parking + Tolls</span>
              <span className="font-bold">$600</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Supplies</span>
              <span className="font-bold">$200</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-sm font-semibold">Total Monthly Expenses</span>
              <span className="font-black text-xl text-primary">$8,000</span>
            </div>
          </div>
        </section>

        {/* Why It Matters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Expense Tracking Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Without tracking every expense, owner operators often think they're earning more than they really are. Revenue looks great on paper — but fuel, maintenance, parking, and supplies eat into every dollar. Missing even a few categories means your profit numbers are wrong, your tax deductions are incomplete, and your financial decisions are based on guesswork instead of real data.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks loads and expenses automatically so you always see your real profit — not just your gross revenue. Log expenses in seconds, see categorized breakdowns, and have clean records ready for tax season. No spreadsheets, no shoeboxes, no guessing.
          </p>
        </section>

        <ProductProofSection />

        <FinalCTASection />

        <RelatedGuidesSection currentPath="/owner-operator-expenses-list" />
      </main>
    </div>
  );
}
