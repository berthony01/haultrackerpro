import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const mileageExpenses = [
  { icon: '⛽', name: 'Fuel Per Mile', desc: 'Diesel consumed per mile driven — typically $0.50–$0.70 depending on MPG and prices.' },
  { icon: '🛞', name: 'Tire Wear Per Mile', desc: 'Tire degradation per mile driven — approximately $0.03–$0.06 per mile.' },
  { icon: '🔧', name: 'Maintenance Per Mile', desc: 'Cumulative wear and preventive service costs — $0.10–$0.20 per mile.' },
  { icon: '💰', name: 'Depreciation Per Mile', desc: 'Truck value loss per mile — important for long-term financial planning.' },
  { icon: '🛡️', name: 'Insurance Per Mile', desc: 'Fixed insurance cost spread across miles driven — lower miles = higher cost per mile.' },
  { icon: '🛣️', name: 'Tolls Per Mile', desc: 'Route-dependent toll costs averaged across total miles.' },
];

export default function TruckingMileageExpenseGuide() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Mileage Expense Guide | Cost Per Mile Breakdown"
        description="Complete trucking mileage expense guide covering fuel, maintenance, tires, insurance, and depreciation costs per mile for owner operators."
        path="/trucking-mileage-expense-guide"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Mileage Expense Guide | Cost Per Mile Breakdown',
          description: 'Complete trucking mileage expense guide for owner operators.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Mileage Expense Guide</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <MapPin className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucking Mileage Expense Guide</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand every expense tied to the miles you drive and how they impact your bottom line.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Mileage Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Are Mileage-Based Expenses</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Mileage-based expenses are costs that increase with every mile you drive. Unlike fixed costs like insurance premiums or truck payments, these variable costs directly correlate with how much you drive. Understanding them is essential for evaluating load profitability and setting minimum rate requirements.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Mileage Expenses Breakdown</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {mileageExpenses.map((e) => (
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
            <h2 className="text-2xl font-black font-heading">Example Mileage Cost Calculation</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fuel</span><span className="font-semibold">$0.58/mile</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Maintenance</span><span className="font-semibold">$0.15/mile</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tires</span><span className="font-semibold">$0.04/mile</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Depreciation</span><span className="font-semibold">$0.12/mile</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Insurance</span><span className="font-semibold">$0.08/mile</span></div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Total Variable Cost Per Mile</span>
              <span className="font-black text-xl text-primary">$0.97</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Any load paying less than $0.97/mile loses money before fixed costs are even considered.
          </p>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">The Deadhead Mile Problem</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Deadhead miles are the silent profit killer. Every mile you drive empty costs the same in fuel, maintenance, and wear — but generates zero revenue. If you drive 200 deadhead miles to pick up a load, those miles increase your effective cost per loaded mile significantly. Tracking deadhead percentage is essential for understanding true profitability.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro tracks both loaded and deadhead miles for every load, giving you accurate mileage-based cost data. See your real cost per mile, monitor deadhead percentage, and evaluate loads with confidence. All your mileage data feeds into clear weekly and monthly reports.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/trucking-mileage-expense-guide" />
      </main>
    </div>
  );
}
