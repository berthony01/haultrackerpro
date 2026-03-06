import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Fuel, DollarSign, Calculator, BarChart3, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const fuelFactors = [
  { icon: '⛽', name: 'Diesel Price Fluctuations', desc: 'Regional price swings can change your fuel cost by $500+ per month.' },
  { icon: '🛣️', name: 'Deadhead Miles', desc: 'Empty miles burn fuel with zero revenue — a hidden cost many drivers underestimate.' },
  { icon: '🏔️', name: 'Terrain & Routes', desc: 'Mountain passes and city driving reduce MPG significantly compared to flat highway routes.' },
  { icon: '💨', name: 'Speed & Idling', desc: 'Every MPH over 60 costs fuel. Excessive idling burns 0.8–1 gallon per hour.' },
  { icon: '🔧', name: 'Truck Condition', desc: 'Worn tires, dirty filters, and poor alignment all reduce fuel efficiency.' },
  { icon: '🌡️', name: 'Weather Conditions', desc: 'Cold weather, headwinds, and rain increase fuel consumption noticeably.' },
];

export default function TruckDriverFuelExpenses() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Truck Driver Fuel Expenses | Track & Reduce Diesel Costs"
        description="Understand truck driver fuel expenses, what impacts diesel costs, and how to track fuel spending to improve profitability."
        path="/truck-driver-fuel-expenses"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Truck Driver Fuel Expenses | Track & Reduce Diesel Costs',
          description: 'Understand truck driver fuel expenses and how to track diesel costs.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Fuel Expenses</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Fuel className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Truck Driver Fuel Expenses</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Fuel is the biggest line item for most trucking operations. Learn what drives fuel costs and how to manage them.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Fuel Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Understanding Fuel Expenses</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            For most truck drivers, fuel accounts for 30–40% of total operating costs. At current diesel prices, an owner operator driving 10,000 miles per month can easily spend $5,000–$7,000 on fuel alone. Understanding what affects your fuel costs is the first step toward controlling them and protecting your profit margins.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Impacts Fuel Costs</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fuelFactors.map((e) => (
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
            <h2 className="text-2xl font-black font-heading">Monthly Fuel Expense Example</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Miles Driven</span>
              <span className="font-semibold">10,000</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Truck MPG</span>
              <span className="font-semibold">6.5</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Gallons Used</span>
              <span className="font-semibold">1,538</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Diesel Price / Gallon</span>
              <span className="font-semibold">$3.80</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Total Monthly Fuel Cost</span>
              <span className="font-black text-xl text-primary">$5,846</span>
            </div>
          </div>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro makes logging fuel purchases fast and simple. Track gallons, cost per gallon, and total spend for every fill-up. See your fuel cost per mile calculated automatically, compare spending week over week, and have organized fuel records ready for tax season. No spreadsheets, no lost receipts.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/truck-driver-fuel-expenses" />
      </main>
    </div>
  );
}
