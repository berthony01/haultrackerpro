import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

export default function TruckDriverPerDiem() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Truck Driver Per Diem | How the Per Diem Deduction Works"
        description="Learn how truck driver per diem works, how much you can deduct, and how to calculate your per diem deduction as a driver or owner operator."
        path="/truck-driver-per-diem"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Truck Driver Per Diem | How the Per Diem Deduction Works',
          description: 'Learn how truck driver per diem works, how much you can deduct, and how to calculate your per diem deduction as a driver or owner operator.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Per Diem Guide</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Receipt className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Truck Driver Per Diem Explained</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand how the per diem deduction works for truck drivers and how it reduces taxable income.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Your Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* What Is Per Diem */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Is Truck Driver Per Diem</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Per diem is a tax deduction that allows truck drivers to deduct daily meal expenses while
            working away from their tax home. Instead of tracking every individual meal receipt, drivers
            can use a standard daily rate set by the IRS to calculate their deduction. This applies to
            any day you're away from home overnight for work — which for most over-the-road drivers is
            the majority of the year.
          </p>
        </section>

        {/* Current Rate */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Current Per Diem Rate</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Truck drivers can deduct a daily amount for meals while on the road according to IRS
            guidelines. The per diem rate is updated periodically by the IRS and applies to each full
            day or partial day you spend away from your tax home. For most of the continental United
            States, the standard meal rate is used. Drivers should check the current IRS guidelines
            each year to confirm the exact rate, as it can change based on cost-of-living adjustments.
          </p>
        </section>

        {/* Example Calculation */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Example Per Diem Calculation</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Days on the road</span>
              <span className="font-semibold">250</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Per diem rate (example)</span>
              <span className="font-semibold">$69 / day</span>
            </div>
            <div className="border-t border-border my-2" />
            <div className="flex justify-between text-base">
              <span className="font-semibold">Estimated Deduction</span>
              <span className="font-black text-primary text-lg">$17,250</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            This deduction reduces your taxable income — meaning you pay taxes on less of your gross
            earnings. The actual tax savings depend on your total income and tax bracket.
          </p>
        </section>

        {/* Why Drivers Miss It */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Many Drivers Miss This Deduction</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Many truck drivers miss the per diem deduction simply because they don't track their days
            away from home. Without a consistent record of when you left and when you returned, it's
            nearly impossible to accurately calculate your deduction at tax time. Some drivers don't
            even know the per diem deduction exists, and others underestimate how much it can save them.
            A driver spending 250 days on the road could be leaving thousands of dollars on the table
            every year.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro helps drivers track loads, expenses, and days on the road so deductions are
            easier during tax season. Every load you log creates a record of when and where you were
            driving, making it simple to count your days away from home. Combined with automatic expense
            tracking, you'll have everything organized and ready to report — no guessing, no missing
            deductions.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Track Your Trucking Expenses and Deductions</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/truck-driver-per-diem" />
      </main>
    </div>
  );
}
