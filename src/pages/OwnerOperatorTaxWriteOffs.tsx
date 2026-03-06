import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const writeOffs = [
  { icon: '⛽', name: 'Fuel & Diesel', desc: 'Every gallon of diesel you purchase for business use is fully deductible.' },
  { icon: '🔧', name: 'Repairs & Maintenance', desc: 'Oil changes, tire replacements, brake work, and all truck maintenance costs.' },
  { icon: '🛡️', name: 'Insurance Premiums', desc: 'Liability, cargo, physical damage, bobtail, and occupational accident insurance.' },
  { icon: '💰', name: 'Truck Payment Interest', desc: 'Interest on your truck loan or lease payments (not the principal on a loan).' },
  { icon: '🍔', name: 'Meals & Per Diem', desc: 'The IRS allows 80% deduction on meals while away from your tax home overnight.' },
  { icon: '📱', name: 'Phone & Internet', desc: 'Cell phone bills, mobile hotspots, and data plans used for business.' },
  { icon: '🅿️', name: 'Parking & Tolls', desc: 'Truck stop parking, rest area fees, highway tolls, and bridge charges.' },
  { icon: '📋', name: 'Permits & Licensing', desc: 'IFTA, IRP, UCR, oversize permits, CDL renewal, and DOT fees.' },
  { icon: '🧰', name: 'Supplies & Equipment', desc: 'Straps, tarps, chains, safety gear, and load-securing equipment.' },
  { icon: '💼', name: 'Professional Services', desc: 'Accountant fees, tax preparation, legal services, and bookkeeping.' },
];

export default function OwnerOperatorTaxWriteOffs() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Owner Operator Tax Write-Offs | Complete Deduction List"
        description="Complete list of owner operator tax write-offs including fuel, maintenance, insurance, meals, and business expenses you can deduct."
        path="/owner-operator-tax-write-offs"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Owner Operator Tax Write-Offs | Complete Deduction List',
          description: 'Complete list of owner operator tax write-offs.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Tax Write-Offs</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Receipt className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Owner Operator Tax Write-Offs</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Know every tax write-off available to owner operators so you never overpay the IRS.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Deductions <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Tax Write-Offs</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {writeOffs.map((e) => (
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
            <h2 className="text-2xl font-black font-heading">Example Tax Savings</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Gross Revenue</span><span className="font-semibold">$180,000</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Deductible Expenses</span><span className="font-semibold">$120,000</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Taxable Income</span><span className="font-semibold">$60,000</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Estimated Tax Savings</span>
              <span className="font-black text-xl text-primary">$30,000+</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Without tracking write-offs, you'd pay taxes on the full $180,000 instead of $60,000. That's tens of thousands of dollars in unnecessary taxes.
          </p>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Write-Offs Most Drivers Miss</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Many owner operators miss smaller deductions that add up: truck washes, scale fees, laundry on the road, safety equipment, and even a portion of your phone bill. The IRS allows you to deduct ordinary and necessary business expenses — but only if you have records. Drivers who don't track consistently leave thousands of dollars on the table every year.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro organizes every expense by category so nothing falls through the cracks at tax time. Log expenses in seconds, see categorized totals, and have clean records ready for your accountant. Stop guessing at deductions and start claiming every dollar you're owed.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/owner-operator-tax-write-offs" />
      </main>
    </div>
  );
}
