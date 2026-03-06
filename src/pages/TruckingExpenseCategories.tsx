import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderOpen, DollarSign, Calculator, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const categories = [
  { icon: '⛽', name: 'Fuel', desc: 'Diesel purchases, DEF fluid, and fuel surcharges.' },
  { icon: '🔧', name: 'Maintenance & Repairs', desc: 'Oil changes, brake work, engine repairs, and preventive services.' },
  { icon: '🛞', name: 'Tires', desc: 'New tires, recaps, rotations, and blowout repairs.' },
  { icon: '🛡️', name: 'Insurance', desc: 'Liability, cargo, physical damage, bobtail, and occupational accident.' },
  { icon: '🅿️', name: 'Parking & Tolls', desc: 'Truck stop parking, rest areas, highway tolls, and bridge fees.' },
  { icon: '🍔', name: 'Meals & Per Diem', desc: 'Food expenses while away from your tax home overnight.' },
  { icon: '🧰', name: 'Supplies & Equipment', desc: 'Straps, tarps, chains, gloves, flashlights, and safety gear.' },
  { icon: '📱', name: 'Communication & Technology', desc: 'Cell phone, data plans, ELD subscriptions, and GPS services.' },
  { icon: '💰', name: 'Truck Payment & Lease', desc: 'Monthly truck payment, lease fees, and interest charges.' },
  { icon: '📋', name: 'Permits & Licensing', desc: 'IFTA, IRP, oversize permits, UCR, and DOT fees.' },
  { icon: '🧹', name: 'Cleaning & Laundry', desc: 'Truck washes, trailer washouts, and laundry on the road.' },
  { icon: '🏥', name: 'Health & Safety', desc: 'DOT physicals, drug tests, safety equipment, and health expenses.' },
];

export default function TruckingExpenseCategories() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Expense Categories | Organize Your Business Costs"
        description="Complete list of trucking expense categories for owner operators. Organize fuel, maintenance, insurance, and operating costs for tax preparation."
        path="/trucking-expense-categories"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Expense Categories | Organize Your Business Costs',
          description: 'Complete list of trucking expense categories for owner operators.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Expense Categories</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <FolderOpen className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucking Expense Categories</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Organize your trucking business expenses into clear categories for better tracking and tax preparation.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Organize Expenses <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Categorizing Expenses Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Lumping all expenses into one bucket makes it impossible to understand your business. When expenses are organized by category, you can see exactly where your money goes, identify areas to cut costs, and have clean records ready for tax filing. The IRS expects categorized deductions — not a single "expenses" line item.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Complete Expense Category List</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.map((e) => (
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
            <h2 className="text-2xl font-black font-heading">Example Categorized Monthly Breakdown</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fuel</span><span className="font-semibold">$5,800</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Maintenance & Repairs</span><span className="font-semibold">$1,200</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Insurance</span><span className="font-semibold">$1,800</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Truck Payment</span><span className="font-semibold">$2,000</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Parking & Tolls</span><span className="font-semibold">$500</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Other (supplies, comm, permits)</span><span className="font-semibold">$700</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Total Monthly Expenses</span>
              <span className="font-black text-xl text-primary">$12,000</span>
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
            HaulTrackerPro automatically organizes every expense into the right category. Log fuel, maintenance, parking, tolls, and more — each expense is tagged and sorted instantly. See categorized breakdowns by week or month, and have clean, organized records ready for your accountant or tax filing.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/trucking-expense-categories" />
      </main>
    </div>
  );
}
