import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt, DollarSign, AlertTriangle, CheckCircle, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

const deductions = [
  { icon: '🅿️', name: 'Truck Parking', desc: 'Paid parking at truck stops, rest areas, and shipper/receiver lots.' },
  { icon: '🛣️', name: 'Tolls', desc: 'Highway tolls, bridge fees, and turnpike charges across your routes.' },
  { icon: '🚿', name: 'Showers', desc: 'Shower fees at truck stops while away from your tax home.' },
  { icon: '🍔', name: 'Food on the Road', desc: 'Meals and per diem expenses while away from your tax home overnight.' },
  { icon: '🧹', name: 'Cleaning Supplies', desc: 'Truck wash, interior cleaning products, and laundry on the road.' },
  { icon: '🔧', name: 'Truck Maintenance', desc: 'Oil changes, tire replacements, brake repairs, and preventive upkeep.' },
  { icon: '📱', name: 'Communication Costs', desc: 'Cell phone bills, mobile hotspots, and data plans used for dispatch, load boards, and ELD.' },
  { icon: '🧰', name: 'Truck Supplies', desc: 'Straps, tarps, chains, bungees, gloves, flashlights, and other trucking gear.' },
];

export default function TruckDriverTaxDeductions() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Truck Driver Tax Deductions | Maximize Your Write-Offs"
        description="Learn the most common truck driver tax deductions including parking, tolls, truck supplies, food, and communication expenses."
        path="/truck-driver-tax-deductions"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Truck Driver Tax Deductions | Maximize Your Write-Offs',
          description: 'Learn the most common truck driver tax deductions including parking, tolls, truck supplies, food, and communication expenses.',
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
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Receipt className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Truck Driver Tax Deductions Explained</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand the deductions truck drivers can legally claim to reduce taxes.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Your Deductions <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Common Deductions */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Truck Driver Tax Deductions</h2>
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

        {/* Why Drivers Overpay */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why Many Drivers Overpay Taxes</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Most truck drivers overpay their taxes simply because they don't track expenses consistently.
            Without organized records, deductions get missed — and every missed deduction means more money
            going to the IRS instead of staying in your pocket. Poor bookkeeping, lost receipts, and
            end-of-year guessing are the biggest reasons owner operators pay thousands more than they should.
            The IRS requires documentation for every write-off, and without it, you can't claim what you've spent.
          </p>
        </section>

        {/* How HaulTrackerPro Helps */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks your loads and expenses automatically so you always have clean, organized
            records when tax season arrives. Every expense you log is categorized and ready to report —
            no spreadsheets, no shoeboxes, no guessing. When it's time to file, you'll know exactly what
            you spent and what you can deduct, helping you keep more of what you earn.
          </p>
        </section>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-xl font-black font-heading">Track Your Trucking Deductions Automatically</h2>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>

        <RelatedGuidesSection currentPath="/truck-driver-tax-deductions" />
      </main>
    </div>
  );
}
