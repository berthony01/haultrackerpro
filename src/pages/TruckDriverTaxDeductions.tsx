import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt, DollarSign, TrendingDown, Calculator, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

const deductions = [
  { icon: '🅿️', name: 'Truck Parking', desc: 'Paid parking at truck stops, rest areas, and shippers/receivers.' },
  { icon: '🚿', name: 'Showers', desc: 'Shower fees at truck stops while on the road.' },
  { icon: '🍔', name: 'Food While on the Road', desc: 'Meals and per diem while away from your tax home overnight.' },
  { icon: '📶', name: 'Internet in the Truck', desc: 'Mobile hotspot or WiFi service used for load boards and dispatch.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Truck wash, interior cleaning products, and laundry on the road.' },
  { icon: '🔧', name: 'Equipment and Tools', desc: 'Straps, chains, tarps, gloves, flashlights, and other trucking gear.' },
  { icon: '🏨', name: 'Hotel Stays', desc: 'Lodging expenses when sleeping outside the truck overnight.' },
  { icon: '📱', name: 'Phone for Dispatch & Loads', desc: 'Cell phone bill portion used for business calls, load apps, and ELD.' },
];

export default function TruckDriverTaxDeductions() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Truck Driver Tax Deductions (Complete Guide for Owner Operators)"
        description="Learn the most common tax deductions for truck drivers including parking, food, supplies, and equipment. Reduce your taxable income legally."
        path="/truck-driver-tax-deductions"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Truck Driver Tax Deductions (Complete Guide for Owner Operators)',
          description: 'Learn the most common tax deductions for truck drivers including parking, food, supplies, and equipment.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Tax Deductions Guide</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Section 1 */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Truck Driver Tax Deductions Explained</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            As a 1099 independent contractor, owner operators and truck drivers are responsible for paying
            self-employment taxes — including both the employer and employee portions of Social Security and
            Medicare. That means you're already paying more than a W-2 employee. The good news? You can
            legally reduce your taxable income by tracking and deducting legitimate business expenses. Every
            dollar you deduct is a dollar you don't pay taxes on. Without proper tracking, most drivers
            overpay by thousands every year.
          </p>
        </section>

        {/* Section 2 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Tax Write-Offs for Truck Drivers</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {deductions.map((d) => (
              <div key={d.name} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-card">
                <span className="text-2xl leading-none mt-0.5">{d.icon}</span>
                <div>
                  <p className="font-semibold text-sm">{d.name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{d.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3 */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Tracking Expenses Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Most truck drivers leave money on the table because they don't track their expenses consistently.
            Without records, you can't claim deductions — and without deductions, you're paying taxes on your
            full gross income. The IRS requires documentation to back up every deduction. A shoebox of
            receipts won't cut it at audit time. Drivers who track expenses throughout the year consistently
            save thousands compared to those who guess at tax time.
          </p>
        </section>

        {/* Section 4 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Example Tax Scenario</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Gross Income</span>
              <span className="font-bold text-lg">$100,000</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Tracked Expenses</span>
              <span className="font-bold text-lg text-destructive">− $25,000</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-sm font-semibold">Taxable Income</span>
              <span className="font-black text-xl text-primary">$75,000</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              At an estimated 30% combined tax rate, that's roughly <strong className="text-foreground">$7,500 saved</strong> just by tracking your expenses.
            </p>
          </div>
        </section>

        {/* Section 5 — CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Track every expense automatically with HaulTrackerPro.</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            View Pricing <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      </main>
    </div>
  );
}
