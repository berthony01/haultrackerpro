import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, ArrowRight, Sparkles, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProblemSolutionSection() {
  return (
    <>
      <section>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-black font-heading">Why Many Truck Drivers Struggle With Tracking Finances</h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Most truck drivers try to manage their finances with notebooks, spreadsheets, or shoeboxes full of receipts. 
          Receipts get lost at truck stops. Entries fall behind after long days on the road. Profit calculations become 
          inaccurate because expenses are incomplete. And when tax season arrives, drivers are left guessing at deductions 
          instead of claiming them with confidence. The result is overpaid taxes, missed write-offs, and no clear picture 
          of how the business is actually performing.
        </p>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Solves This</h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          HaulTrackerPro replaces notebooks and spreadsheets with a simple system built for truck drivers. 
          Track every load you haul, log expenses in seconds from your phone, see your real profit after costs, 
          and have organized records ready for tax preparation. No more lost receipts, no more guessing — just 
          clean data that shows exactly where your money goes.
        </p>
      </section>
    </>
  );
}

export function MidPageCTA() {
  const navigate = useNavigate();

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
      <h2 className="text-xl font-black font-heading">Track Your Trucking Finances Automatically</h2>
      <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
        HaulTrackerPro helps truck drivers track loads, expenses, and profit in one simple dashboard.
      </p>
      <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
        Start Free <ArrowRight className="h-4 w-4" />
      </Button>
    </section>
  );
}

export function ProductProofSection() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-black font-heading">See Your Trucking Finances In One Dashboard</h2>
      </div>
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        <img
          src="/placeholder.svg"
          alt="HaulTrackerPro dashboard showing loads, expenses, and profit overview"
          className="w-full h-48 sm:h-64 object-cover bg-muted"
          loading="lazy"
        />
        <div className="p-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            HaulTrackerPro gives truck drivers a clear view of loads, expenses, and profit so they always 
            know how their business is performing. Everything is organized in one place — no spreadsheets, 
            no paper, no guessing.
          </p>
        </div>
      </div>
    </section>
  );
}

export function FinalCTASection() {
  const navigate = useNavigate();

  return (
    <section className="text-center py-8 space-y-4">
      <h2 className="text-xl font-black font-heading">Start Tracking Your Trucking Finances Today</h2>
      <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
        Start Free <Sparkles className="h-4 w-4" />
      </Button>
    </section>
  );
}
