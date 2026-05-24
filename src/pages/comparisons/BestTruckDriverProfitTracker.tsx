import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import ComparisonShell, { FAQList, Disclaimer, buildFAQSchema } from './_ComparisonShell';

const FEATURES = [
  'Load revenue tracking',
  'Loaded miles',
  'Deadhead miles',
  'Total miles',
  'Fuel tracking',
  'Expense tracking',
  'Effective RPM',
  'Net RPM',
  'Net profit',
  'Payment status',
  'Short pay / difference tracking',
  'Reports and exports',
  'Mobile-friendly workflow',
  'Contract clarity support',
  'Tax organization support',
];

const CHECKLIST = [
  'Can it track deadhead miles?',
  'Can it calculate real RPM?',
  'Can it separate gross revenue from net profit?',
  'Can it track fuel and expenses?',
  'Can it help identify short pay or unpaid loads?',
  'Can it export reports?',
  'Is it simple on mobile?',
  'Is it built for trucking or generic bookkeeping?',
];

const FAQS = [
  { q: 'What is the best profit tracker for truck drivers?', a: 'It depends on what the driver needs. For most owner-operators and 1099 drivers, the best fit tracks loads, deadhead miles, fuel, expenses, RPM, net profit, payment status, and exportable reports in one place.' },
  { q: 'What should owner-operators track every week?', a: 'Load revenue, loaded and deadhead miles, fuel, expenses, effective and net RPM, net profit, and payment status for each load.' },
  { q: 'Why is RPM important in trucking?', a: 'RPM (rate per mile) shows what you actually earn per mile. Effective and net RPM account for deadhead and expenses, which gross rate alone hides.' },
  { q: 'Should I track deadhead miles?', a: 'Yes. Deadhead miles affect real RPM and net profit. Ignoring them can make weak loads look stronger than they are.' },
  { q: 'Is a spreadsheet enough for trucking profit tracking?', a: 'For a few loads per month with a clean system, a spreadsheet can work. As volume and complexity grow, a trucking-specific tool can be easier to maintain.' },
  { q: 'Does Haul Tracker Pro replace a CPA?', a: 'No. It helps organize records that a driver can share with a qualified tax professional.' },
  { q: 'Can 1099 truck drivers use Haul Tracker Pro?', a: 'Yes. 1099 drivers, lease drivers, and owner-operators are the primary audience.' },
  { q: 'Does Haul Tracker Pro offer a free plan?', a: 'Yes. A free plan is available. See the Pricing page for the current feature limits.' },
];

export default function BestTruckDriverProfitTracker() {
  const navigate = useNavigate();
  const path = '/best-truck-driver-profit-tracker';

  return (
    <ComparisonShell>
      <SEOHead
        title="Best Truck Driver Profit Tracker — What Owner-Operators Should Look For"
        description="Learn what to look for in a truck driver profit tracker, including load tracking, fuel, expenses, deadhead miles, RPM, net profit, payment status, and reports."
        path={path}
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: 'Best Truck Driver Profit Tracker — What Owner-Operators Should Look For',
            description: 'Buyer guide for choosing a trucking profit tracker.',
            author: { '@type': 'Organization', name: 'HaulTrackerPro' },
            publisher: { '@type': 'Organization', name: 'HaulTrackerPro' },
          },
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Best Truck Driver Profit Tracker', path: '/best-truck-driver-profit-tracker' },
          ]),
          buildFAQSchema(FAQS),
        ]}
      />

      <section className="text-center space-y-5">
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
          Best Truck Driver Profit Tracker: What Owner-Operators Should Look For
        </h1>
        <p className="text-base sm:text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'hsl(220, 10%, 60%)' }}>
          A good trucking profit tracker should help you see more than gross pay. It should help you understand fuel costs, deadhead miles, expenses, RPM, payment status, and what you actually keep after each load.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button onClick={() => navigate('/auth')} className="rounded-xl gap-2 font-bold" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>Start Tracking Free <ArrowRight className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => navigate('/features')} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>View Features</Button>
          <Button variant="outline" onClick={() => navigate('/resources')} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>Explore Resources</Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>What makes a good truck driver profit tracker?</h2>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 rounded-xl border p-5" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          {FEATURES.map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm py-1" style={{ color: 'hsl(220, 10%, 70%)' }}>
              <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'hsl(152, 60%, 42%)' }} />{f}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border p-6 space-y-2" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <h2 className="text-xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Why gross pay is not enough</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
          A load can look good by gross rate but still be weak after deadhead, fuel, unpaid time, fees, and other expenses. A good profit tracker helps separate gross revenue from real net profit so you can make decisions on accurate numbers — without making any guaranteed savings or earnings promises.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Spreadsheet vs general bookkeeping app vs trucking-specific tracker</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { t: 'Spreadsheet', d: 'Flexible, but manual and formula-dependent. Works for simple, low-volume tracking.' },
            { t: 'General bookkeeping app', d: 'Useful for accounting, but may not be built around trucking load decisions.' },
            { t: 'Trucking-specific tracker', d: 'Better fit when the driver wants load-by-load profit, RPM, deadhead, and trucking reports.' },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border p-5" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
              <h3 className="font-black mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>{c.t}</h3>
              <p className="text-sm" style={{ color: 'hsl(220, 10%, 65%)' }}>{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border p-6 space-y-2" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.3)' }}>
        <h2 className="text-xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Where Haul Tracker Pro fits</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
          Haul Tracker Pro is built for drivers who want a trucking-specific way to track loads, miles, fuel, expenses, payment status, RPM, net profit, reports, and contract-related clarity in one mobile-first workflow.
        </p>
        <div className="pt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate('/auth')} className="rounded-xl font-bold" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>Start Tracking Free</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/haultrackerpro-vs-spreadsheets')} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>vs Spreadsheets</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/haultrackerpro-vs-quickbooks')} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>vs QuickBooks</Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Buyer checklist</h2>
        <div className="rounded-xl border p-5 space-y-2" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          {CHECKLIST.map((q) => (
            <div key={q} className="flex items-start gap-2 text-sm" style={{ color: 'hsl(220, 10%, 70%)' }}>
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'hsl(152, 60%, 42%)' }} />{q}
            </div>
          ))}
        </div>
      </section>

      <Disclaimer />

      <section className="space-y-4">
        <h2 className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Frequently asked questions</h2>
        <FAQList items={FAQS} />
      </section>

      <section className="space-y-3 text-center">
        <p className="text-sm" style={{ color: 'hsl(220, 10%, 55%)' }}>Related resources</p>
        <div className="flex flex-wrap justify-center gap-2">
          {[
            ['Features', '/features'],
            ['Pricing', '/pricing'],
            ['About', '/about'],
            ['Resources', '/resources'],
            ['Profit Calculator', '/trucking-profit-calculator'],
            ['Cost Per Mile', '/trucking-cost-per-mile'],
            ['Real RPM', '/resources/real-rpm-trucking'],
            ['1099 Expenses', '/resources/1099-truck-driver-expenses'],
          ].map(([label, href]) => (
            <Button key={href} variant="outline" size="sm" onClick={() => navigate(href)} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>{label}</Button>
          ))}
        </div>
      </section>
    </ComparisonShell>
  );
}
