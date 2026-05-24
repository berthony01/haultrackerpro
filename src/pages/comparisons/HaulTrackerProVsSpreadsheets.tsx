import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import ComparisonShell, { CompareTable, FAQList, Disclaimer, buildFAQSchema } from './_ComparisonShell';

const ROWS: Array<[string, string, string]> = [
  ['Load tracking', 'Manual rows & formulas', 'Built-in load workflow'],
  ['Loaded miles', 'Manual entry', 'Tracked per load'],
  ['Deadhead miles', 'Often skipped', 'Tracked per load'],
  ['Fuel expenses', 'Manual entry', 'Fuel log tied to loads'],
  ['Other expenses', 'Manual categorization', '19 trucking categories'],
  ['Effective RPM', 'Manual formula', 'Calculated automatically'],
  ['Net RPM', 'Manual formula', 'Calculated automatically'],
  ['Net profit', 'Manual formula', 'Per-load and per-week'],
  ['Payment status', 'Manual columns', 'Paid / unpaid / short / overdue'],
  ['Short pay / difference tracking', 'Manual columns', 'Built-in difference tracking'],
  ['CSV export', 'Native', 'Available'],
  ['Pro PDF reports', 'Not available', 'Available on Pro'],
  ['Mobile-first workflow', 'Limited', 'Designed for mobile'],
  ['Trucking-specific reports', 'Build your own', 'Built-in'],
  ['Contract clarity tools', 'Not available', 'Available'],
  ['Recruiter / opportunity tools', 'Not available', 'Available'],
];

const FAQS = [
  { q: 'Is Haul Tracker Pro better than a trucking spreadsheet?', a: 'It depends on the driver. Spreadsheets can work for simple manual tracking. Haul Tracker Pro may be a better fit for drivers who want a trucking-specific mobile workflow for loads, fuel, expenses, RPM, payment status, and reports.' },
  { q: 'Can I still export my data?', a: 'Yes. Haul Tracker Pro supports CSV export, and Pro plans include PDF reports.' },
  { q: 'Can I track fuel and expenses?', a: 'Yes. Fuel logs and expenses can be tied to loads and categorized using trucking-specific categories.' },
  { q: 'Can I track deadhead miles?', a: 'Yes. Loaded and deadhead miles are tracked per load and used to calculate effective and net RPM.' },
  { q: 'Does Haul Tracker Pro replace a CPA?', a: 'No. Haul Tracker Pro is not a CPA, accountant, or tax advisor. It helps organize records that a driver can share with a qualified professional.' },
  { q: 'Is there a free plan?', a: 'Yes. A free plan is available. See the Pricing page for the current free and Pro feature limits.' },
  { q: 'Who is this best for?', a: 'Owner-operators, lease drivers, and 1099 truck drivers who want a trucking-specific way to see real profit per load and per week.' },
];

export default function HaulTrackerProVsSpreadsheets() {
  const navigate = useNavigate();
  const path = '/haultrackerpro-vs-spreadsheets';

  return (
    <ComparisonShell>
      <SEOHead
        title="Haul Tracker Pro vs Spreadsheets — Truck Driver Profit Tracking Comparison"
        description="Compare Haul Tracker Pro and spreadsheets for tracking trucking loads, fuel, expenses, deadhead miles, RPM, net profit, payment status, and reports."
        path={path}
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'Haul Tracker Pro vs Spreadsheets',
            url: `https://haultrackerpro.com${path}`,
            description: 'Comparison of Haul Tracker Pro and spreadsheets for trucking profit tracking.',
          },
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Compare', path: '/haultrackerpro-vs-spreadsheets' },
          ]),
          buildFAQSchema(FAQS),
        ]}
      />

      <section className="text-center space-y-5">
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
          Haul Tracker Pro vs Spreadsheets: Which Is Better for Tracking Real Trucking Profit?
        </h1>
        <p className="text-base sm:text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'hsl(220, 10%, 60%)' }}>
          Spreadsheets can work when you are starting out, but trucking profit tracking gets harder when you need to track fuel, deadhead miles, RPM, payment status, deductions, reports, and load-by-load profit in one place.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button onClick={() => navigate('/auth')} className="rounded-xl gap-2 font-bold" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>Start Tracking Free <ArrowRight className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => navigate('/pricing')} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>View Pricing</Button>
          <Button variant="outline" onClick={() => navigate('/resources')} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>Explore Resources</Button>
        </div>
      </section>

      <section className="rounded-2xl border p-6" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <h2 className="text-xl font-black mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>Quick verdict</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
          Spreadsheets may be enough if a driver only tracks a few simple numbers manually. Haul Tracker Pro is designed for drivers who want a trucking-specific system for loads, fuel, expenses, mileage, RPM, payment tracking, and reports.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Feature comparison</h2>
        <CompareTable headers={['Feature', 'Spreadsheets', 'Haul Tracker Pro']} rows={ROWS} />
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border p-5" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <h3 className="font-black mb-3" style={{ color: 'hsl(0, 0%, 100%)' }}>When spreadsheets may be enough</h3>
          <ul className="space-y-1.5 text-sm" style={{ color: 'hsl(220, 10%, 65%)' }}>
            <li>• You only track a few loads per month</li>
            <li>• You already have a clean system</li>
            <li>• You do not need a mobile-friendly workflow</li>
            <li>• You are comfortable maintaining formulas</li>
            <li>• You do not need trucking-specific reports</li>
          </ul>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.3)' }}>
          <h3 className="font-black mb-3" style={{ color: 'hsl(0, 0%, 100%)' }}>When Haul Tracker Pro may be a better fit</h3>
          <ul className="space-y-1.5 text-sm" style={{ color: 'hsl(220, 10%, 65%)' }}>
            <li>• You want to track load profit faster</li>
            <li>• You want deadhead miles included</li>
            <li>• You want fuel and expenses tied to trucking profit</li>
            <li>• You want payment status visibility</li>
            <li>• You want CSV exports or Pro PDF reports</li>
            <li>• You want a mobile-first trucking workflow</li>
          </ul>
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
            ['Expense Tracker', '/owner-operator-expense-tracker'],
            ['Tax Deductions', '/truck-driver-tax-deductions'],
          ].map(([label, href]) => (
            <Button key={href} variant="outline" size="sm" onClick={() => navigate(href)} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>{label}</Button>
          ))}
        </div>
      </section>
    </ComparisonShell>
  );
}
