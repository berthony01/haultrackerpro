import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, DollarSign, BarChart3, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const expenses = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel costs for loaded miles, deadhead miles, and idling — often the largest single expense.' },
  { icon: '🅿️', name: 'Truck Parking', desc: 'Paid parking at truck stops, rest areas, and shipper/receiver lots.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges across every route.' },
  { icon: '🔧', name: 'Truck Maintenance', desc: 'Oil changes, brake repairs, engine work, and preventive upkeep.' },
  { icon: '🛞', name: 'Tires', desc: 'Tire replacements, recaps, and blowout repairs on the road.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, gloves, flashlights, and load-securing gear.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Interior cleaning products, laundry on the road, and general upkeep.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone bills, mobile hotspots, and data plans for dispatch, load boards, and ELD.' },
  { icon: '🍔', name: 'Meals on the Road', desc: 'Food and per diem expenses while away from your tax home overnight.' },
  { icon: '🚿', name: 'Truck Washes', desc: 'Exterior truck washes and trailer washouts between loads.' },
  { icon: '⚖️', name: 'Scale Fees', desc: 'Weigh station fees and CAT scale charges to verify load weight.' },
];

export default function TruckingExpensesList() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Expenses List | Complete Owner Operator Expense Guide"
        description="A complete list of trucking expenses owner operators should track including fuel, tolls, maintenance, parking, supplies, and communication costs."
        path="/trucking-expenses-list"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Expenses List | Complete Owner Operator Expense Guide',
          description: 'A complete list of trucking expenses owner operators should track including fuel, tolls, maintenance, parking, supplies, and communication costs.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Trucking Expenses List</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ClipboardList className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Complete Trucking Expenses List</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand every expense truck drivers and owner operators face while operating a trucking business.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Tracking Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Major Expenses */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Major Trucking Expenses</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            These are the most common expenses truck drivers and owner operators pay week after week. Missing any of them means an incomplete picture of your real operating costs.
          </p>
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

        <ProblemSolutionSection />

        {/* Fixed vs Variable */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Fixed vs Variable Expenses</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Trucking expenses fall into two categories. Understanding the difference helps you budget accurately and plan for slow months.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card shadow-card p-5 space-y-3">
              <p className="font-bold text-sm">Fixed Expenses</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Costs that stay the same regardless of how many miles you drive. These include truck payments, insurance premiums, and permits. You pay them whether or not you're hauling freight.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Insurance</li>
                <li>Truck payments</li>
                <li>Permits &amp; licensing</li>
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-card shadow-card p-5 space-y-3">
              <p className="font-bold text-sm">Variable Expenses</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Costs that change based on how much you drive and operate. The more miles you run, the more you spend on fuel, maintenance, and tolls.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Fuel</li>
                <li>Maintenance &amp; repairs</li>
                <li>Tolls</li>
              </ul>
            </div>
          </div>
        </section>

        <MidPageCTA />

        {/* Why Tracking Matters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Tracking Trucking Expenses Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Every dollar you spend on the road is a potential tax deduction — but only if you have proof. Tracking expenses consistently lowers your taxable income, which means you keep more of what you earn. Beyond taxes, knowing your exact costs lets you calculate your real profit per load, identify where money is leaking, and make smarter decisions about which freight to accept.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks loads, expenses, and profit automatically. Log expenses in seconds from your phone, categorize them instantly, and have clean records ready for tax season. No spreadsheets, no shoeboxes — just organized data that shows exactly where your money goes.
          </p>
        </section>

        <ProductProofSection />

        <FinalCTASection />

        <RelatedGuidesSection currentPath="/trucking-expenses-list" />
      </main>
    </div>
  );
}
