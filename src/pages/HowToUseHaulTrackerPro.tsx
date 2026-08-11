import { Link } from 'react-router-dom';
import { Truck, DollarSign, Fuel, BarChart3, ClipboardList, Bell, Award, FileText, Calculator, CheckCircle, ArrowRight, BookOpen, ParkingCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SEOHead from '@/components/SEOHead';
import RelatedGuidesSection from '@/components/RelatedGuidesSection';

const driverTypes = [
  {
    title: 'Owner-Operators',
    icon: Truck,
    description: 'You own your truck and book your own freight. HaulTrackerPro helps you track every load, expense, and fuel stop so you can see your true take-home profit — not just gross revenue.',
  },
  {
    title: 'Lease Operators',
    icon: DollarSign,
    description: 'Leasing adds fixed costs that eat into margins. HaulTrackerPro lets you layer truck payments, insurance, and maintenance into your expense tracking so you always know where you stand.',
  },
  {
    title: '1099 Company Drivers',
    icon: ClipboardList,
    description: 'Running under someone else\'s authority doesn\'t mean you can skip bookkeeping. Track your pay, per diem, fuel, and deductible expenses to stay tax-ready year-round.',
  },
];

const steps = [
  {
    num: '01',
    title: 'Log Your Loads',
    description: 'Enter pickup, drop-off, loaded miles, deadhead miles, rate per mile, detention fees, and actual pay received. Multi-stop loads are fully supported.',
    icon: ClipboardList,
  },
  {
    num: '02',
    title: 'Track Expenses',
    description: 'Add expenses like food, tolls, maintenance, parking, and more. Link expenses to specific loads for per-load profitability analysis.',
    icon: DollarSign,
  },
  {
    num: '03',
    title: 'Track Fuel',
    description: 'Log every fuel stop with gallons, price per gallon, station name, and odometer reading. See fuel costs reflected in your overall business view.',
    icon: Fuel,
  },
  {
    num: '04',
    title: 'See Real Profit',
    description: 'Net Profit = Revenue − Expenses. The Tax Planner then estimates your SE, federal, and state tax using the IRS method — so you see what you actually keep after expenses and taxes.',
    icon: BarChart3,
  },
];

const features = [
  { title: 'Load Logging', icon: ClipboardList, description: 'Log every load with full details — locations, miles, rate, fees, and pay. Support for multi-stop loads and paste parsing.' },
  { title: 'Expense Tracking', icon: DollarSign, description: 'Categorize expenses (fuel, tolls, food, maintenance, etc.), link them to loads, and see totals by category and date range.' },
  { title: 'Fuel Tracking', icon: Fuel, description: 'Dedicated fuel log with gallons, price, station, and odometer tracking. See fuel analytics on your dashboard.' },
  { title: 'Smart Alerts', icon: Bell, description: 'Get notified about high deadhead, missing pay, expense spikes, profit drops, and RPM dips — with dollar-impact amounts so you see exactly how much each issue costs you.' },
  { title: 'Weekly Closeout', icon: CheckCircle, description: 'Finalize each week with a snapshot of earnings, miles, and deadhead percentage. Includes a Week in Review that flags your best/worst loads, deadhead issues, and missing payments.' },
  { title: 'Driver Scorecard', icon: Award, description: 'See your overall performance score (0–100) with tier rankings, 5 metric breakdowns (RPM, deadhead, expenses, profit trend, streak), and personalized coaching recommendations for each area.' },
  { title: 'Reports & Exports', icon: FileText, description: 'Export your data as CSV, PDF summary, or full profit report. Download everything for your accountant or records.' },
  { title: 'Tax Set-Aside Planner', icon: Calculator, description: 'Configure federal, state, and self-employment tax rates. Uses the IRS method for SE tax (92.35% adjustment) and deducts half of SE tax before income tax — more accurate than a flat percentage estimate.' },
  { title: 'Real-Time Parking Finder', icon: ParkingCircle, description: 'Pro feature: see live truck parking availability reported by drivers, with safety ratings and one-tap reporting. Earn points and climb the community leaderboard while helping fellow truckers.' },
  { title: 'Settlement Statements', icon: FileText, description: 'View finalized settlement statements issued to you by a carrier or agency you have an accepted relationship with, and reconcile the lines against your own loads. Recordkeeping only — HaulTrackerPro does not pay, hold, verify, or guarantee any settlement amount.' },
];

const freePlan = [
  'Load logging',
  'Expense tracking',
  'Fuel logging',
  'Basic dashboard',
  'Basic profit visibility',
  'Basic monthly summary',
  'View finalized settlement statements issued to you',
  'Basic settlement reconciliation (confirm or clear a load match)',
];

const proPlan = [
  'AI Voice Expense Logging',
  'AI Receipt Scanning',
  'Scan Rate Con Screenshots (OCR)',
  'Driver Scorecard with coaching advice',
  'Weekly Closeout with Week in Review',
  'Smart Alerts 2.0 with dollar impact',
  'Fuel analytics (cost/mile, % of revenue)',
  'Full tax breakdown (SE, federal, state)',
  'PDF & profit report exports',
  'Unlimited Paste Load Parser',
  '"Pro Saved You Time" dashboard card',
  'Real-time Parking Finder with driver-verified availability',
  'Driver points, streaks & community leaderboard',
];

const checklist = [
  'Create your account',
  'Log your first load',
  'Add your first expense',
  'Add fuel entries',
  'Review your dashboard',
  'Finalize your week',
];

const faqs = [
  { q: 'Is HaulTrackerPro free to start?', a: 'Yes. You can create an account and start logging loads, expenses, and fuel at no cost. Upgrade to Pro any time to unlock advanced analytics, AI tools, and exports.' },
  { q: 'Can I track fuel and expenses?', a: 'Absolutely. HaulTrackerPro has dedicated fuel logging and categorized expense tracking built in. Both are available on the free plan.' },
  { q: 'Can I use it if I\'m a lease driver?', a: 'Yes. Lease operators can track truck payments, insurance, and all other expenses alongside load revenue to understand true profitability.' },
  { q: 'How is profit calculated?', a: 'Net Profit = Gross Revenue − Total Expenses. Gross revenue uses actual pay received when available, and falls back to estimated pay (rate per mile × loaded miles + fees) for unpaid loads. Expenses include everything you\'ve logged: fuel, tolls, maintenance, insurance, repairs, permits, and other costs. Net $/Mile divides your net profit by total miles (loaded + deadhead) to show your true earning rate.' },
  { q: 'How is the tax estimate calculated?', a: 'The Tax Set-Aside Planner uses the IRS method for self-employment tax: your tax base (gross or net income, depending on your setting) is first multiplied by 92.35%, then the SE tax rate (typically 15.3%) is applied. Half of the SE tax is then deducted from your income before calculating federal and state income tax. This is more accurate than applying a flat combined percentage. You can add a buffer percentage for safety. Pro users see a full breakdown of SE, federal, state, and buffer amounts. This is an estimate only — always verify with a tax professional.' },
  { q: 'Do I need accounting experience?', a: 'Not at all. HaulTrackerPro is designed for drivers, not accountants. Just log your loads and expenses — the app handles the math.' },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'How to Use HaulTrackerPro | Load, Expense, and Profit Tracking Guide',
  description: 'Learn how to use HaulTrackerPro to log loads, track expenses, monitor fuel costs, calculate profit, and manage your trucking business like a pro.',
  author: { '@type': 'Organization', name: 'HaulTrackerPro' },
  publisher: { '@type': 'Organization', name: 'HaulTrackerPro', url: 'https://haultrackerpro.com' },
  mainEntityOfPage: 'https://haultrackerpro.com/how-to-use-haultrackerpro',
};

export default function HowToUseHaulTrackerPro() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="How to Use HaulTrackerPro | Load, Expense, and Profit Tracking Guide"
        description="Learn how to use HaulTrackerPro to log loads, track expenses, monitor fuel costs, calculate profit, and manage your trucking business like a pro."
        path="/how-to-use-haultrackerpro"
        jsonLd={jsonLd}
      />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center relative z-10">
          <h1 className="text-3xl sm:text-5xl font-black font-heading mb-4 leading-tight">
            How to Use <span className="text-primary">HaulTrackerPro</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-4 max-w-2xl mx-auto">
            A step-by-step guide to logging loads, tracking expenses, and seeing the real profit on every haul — so you can spot bad loads before they cost you.
          </p>
          <p className="text-sm text-muted-foreground mb-8 max-w-xl mx-auto">
            HaulTrackerPro helps owner-operators, lease drivers, and 1099 company drivers run their truck like a business — not a guessing game. Log loads, see your true take-home profit, and get warned when a lane, broker, or week starts losing you money.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-xl font-bold text-base px-8">
              <Link to="/pricing">Start Tracking Free <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-xl font-bold text-base px-8">
              <Link to="/features">View Features</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-10">Who Is HaulTrackerPro For?</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {driverTypes.map((d) => (
            <Card key={d.title} className="shadow-card border-border">
              <CardContent className="p-6 space-y-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <d.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold font-heading">{d.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{d.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-y border-border bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-12">How It Works</h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.num} className="text-center space-y-3">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <s.icon className="h-7 w-7 text-primary" />
                </div>
                <span className="text-xs font-bold text-primary tracking-wider">STEP {s.num}</span>
                <h3 className="text-base font-bold font-heading">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CORE FEATURES */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-10">Core Features Guide</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {features.map((f) => (
            <Card key={f.title} className="shadow-card border-border">
              <CardContent className="p-5 flex gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-heading mb-1">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex justify-center gap-3 mt-8">
          <Button asChild variant="outline" size="sm" className="rounded-xl font-bold">
            <Link to="/tools/load-profit-calculator">Load Profit Calculator</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-xl font-bold">
            <Link to="/tools/fuel-cost-per-mile">Fuel Cost Per Mile Tool</Link>
          </Button>
        </div>
      </section>

      {/* FREE VS PRO */}
      <section className="border-y border-border bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-10">Free vs Pro</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <Card className="shadow-card border-border">
              <CardContent className="p-6 space-y-4">
                <h3 className="text-lg font-bold font-heading">Free</h3>
                <ul className="space-y-2">
                  {freePlan.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="shadow-card border-primary/40 ring-1 ring-primary/20">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold font-heading">Pro</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">Free to start</span>
                </div>
                <ul className="space-y-2">
                  {proPlan.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
                <Button asChild size="sm" className="w-full rounded-xl font-bold mt-2">
                  <Link to="/pricing">See Pricing</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* GETTING STARTED */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-8">Getting Started Checklist</h2>
        <div className="space-y-3">
          {checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card shadow-card">
              <span className="h-8 w-8 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="text-sm font-semibold">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-muted/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-8">Frequently Asked Questions</h2>
          <Accordion type="single" collapsible className="space-y-2">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border rounded-xl px-4 bg-card shadow-card">
                <AccordionTrigger className="text-sm font-semibold text-left hover:no-underline">{faq.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div className="text-center mt-6">
            <Button asChild variant="link" className="text-sm font-bold">
              <Link to="/faq">View Full FAQ <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* CONTRACT PROTECTION */}
      <section className="border-t border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-3">How Contract Protection Works</h2>
          <p className="text-sm text-muted-foreground text-center mb-10 max-w-2xl mx-auto">
            HaulTrackerPro helps drivers review recruiter-sent contracts before approving, signing, or being marked hired.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              { num: '01', title: 'Recruiter uploads the contract', desc: 'The recruiter adds the contract document to the opportunity workflow so the driver can review it.' },
              { num: '02', title: 'AI parses the document', desc: 'HaulTrackerPro extracts text and key details to make the contract easier to review at a glance.' },
              { num: '03', title: 'AI creates a plain-English risk summary', desc: 'Drivers see possible red flags and key points in plain language. This is informational only — not legal advice.' },
              { num: '03b', title: 'Optional: Plain-English Clause Rewrite (Driver Pro)', desc: 'Driver Pro users can paste a confusing clause into the Plain-English Clause Rewrite tool to get a clearer explanation, concern points, and questions to ask the recruiter. Informational only — not legal advice.' },
              { num: '04', title: 'Driver reviews and decides', desc: 'The driver can approve the contract, reject it, or request changes before moving forward.' },
              { num: '05', title: 'Driver records approval / signature', desc: 'When the driver approves, HaulTrackerPro stores a platform record of consent tied to that contract version. It is not a DocuSign-equivalent or qualified electronic signature.' },
              { num: '06', title: 'Hired status is protected', desc: 'Recruiters cannot mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record.' },
            ].map((s) => (
              <div key={s.num} className="p-5 rounded-2xl border border-border bg-card shadow-card">
                <span className="text-xs font-bold text-primary tracking-wider">STEP {s.num}</span>
                <h3 className="text-base font-bold font-heading mt-1 mb-1.5">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-8 max-w-2xl mx-auto">
            AI summaries are informational only. Always read the full contract before approving or signing.
          </p>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="border-t border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <h2 className="text-2xl sm:text-4xl font-black font-heading mb-3">Stop Guessing. Start Tracking.</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Use HaulTrackerPro to track loads, expenses, fuel, and real profit in one place.
          </p>
          <Button asChild size="lg" className="rounded-xl font-bold text-base px-10">
            <Link to="/pricing">Start Tracking Free <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      {/* Related Guides */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-16">
        <RelatedGuidesSection currentPath="/how-to-use-haultrackerpro" />
      </section>
    </div>
  );
}
