import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Wrench, DollarSign, Calculator, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';
import { ProblemSolutionSection, MidPageCTA, ProductProofSection, FinalCTASection } from '@/components/SEOConversionSections';

const maintenanceItems = [
  { icon: '🛞', name: 'Tires', desc: 'Replacements, recaps, rotations, and blowout repairs — $0.03–$0.06 per mile.' },
  { icon: '🔧', name: 'Engine & Drivetrain', desc: 'Oil changes, filters, belts, turbo repairs — $0.02–$0.05 per mile.' },
  { icon: '🛑', name: 'Brakes', desc: 'Brake pads, drums, adjustments, and air system maintenance — $0.01–$0.03 per mile.' },
  { icon: '💡', name: 'Electrical & Lighting', desc: 'Headlights, tail lights, wiring, alternators, and battery replacements.' },
  { icon: '❄️', name: 'HVAC & APU', desc: 'AC repairs, heater maintenance, and APU servicing for idle-free climate control.' },
  { icon: '🚿', name: 'Truck Washes', desc: 'Exterior washes and trailer washouts between loads.' },
];

export default function TruckingMaintenanceCostPerMile() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Maintenance Cost Per Mile | Repair Costs Guide"
        description="Learn how to calculate trucking maintenance cost per mile including tires, brakes, engine work, and preventive upkeep."
        path="/trucking-maintenance-cost-per-mile"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Trucking Maintenance Cost Per Mile | Repair Costs Guide',
          description: 'Learn how to calculate trucking maintenance cost per mile.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Maintenance Cost Per Mile</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Wrench className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucking Maintenance Cost Per Mile</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Understand what maintenance really costs per mile and how to budget for it.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Track Maintenance Costs <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What Is Maintenance Cost Per Mile</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Maintenance cost per mile is the total amount you spend on truck repairs, parts, and preventive upkeep divided by miles driven. For most owner operators, maintenance runs between $0.10 and $0.20 per mile — the second largest variable cost after fuel. Tracking this number helps you budget for repairs, plan preventive maintenance, and know when your truck is costing more than it should.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Wrench className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Common Maintenance Expenses</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {maintenanceItems.map((e) => (
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
            <h2 className="text-2xl font-black font-heading">Example Maintenance Cost Breakdown</h2>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Maintenance Spend</span>
              <span className="font-semibold">$1,500</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Miles Driven</span>
              <span className="font-semibold">10,000</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold">Maintenance Cost Per Mile</span>
              <span className="font-black text-xl text-primary">$0.15</span>
            </div>
          </div>
        </section>

        <MidPageCTA />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Why This Metric Matters</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Maintenance costs can spike unexpectedly. A blown turbo, a set of tires, or a major engine repair can wipe out weeks of profit. Drivers who track maintenance cost per mile can see trends early — if your cost is creeping up, it may be time to invest in preventive work or evaluate whether the truck is worth keeping. Without this data, you're guessing at one of your biggest expenses.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Helps</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            HaulTrackerPro categorizes every maintenance expense you log so you can see exactly what repairs cost over time. Track oil changes, tire replacements, brake work, and more — then see your maintenance cost per mile calculated automatically. Make informed decisions about when to repair, when to replace, and how to budget.
          </p>
        </section>

        <ProductProofSection />
        <FinalCTASection />
        <RelatedGuidesSection currentPath="/trucking-maintenance-cost-per-mile" />
      </main>
    </div>
  );
}
