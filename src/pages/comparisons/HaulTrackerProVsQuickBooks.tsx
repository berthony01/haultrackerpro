import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import ComparisonShell, { CompareTable, FAQList, Disclaimer, buildFAQSchema } from './_ComparisonShell';

const ROWS: Array<[string, string, string]> = [
  ['General bookkeeping', 'Broad platform for many business types', 'Not a general bookkeeping replacement'],
  ['Trucking-specific load tracking', 'May require setup or add-ons', 'Built around trucking loads'],
  ['Loaded / deadhead miles', 'Manual setup', 'Tracked per load'],
  ['Effective RPM', 'Manual setup', 'Calculated automatically'],
  ['Net RPM', 'Manual setup', 'Calculated automatically'],
  ['Fuel per load visibility', 'Manual setup', 'Fuel log tied to loads'],
  ['Payment status tracking', 'Invoice workflows', 'Paid / unpaid / short / overdue per load'],
  ['Short pay / difference tracking', 'Manual reconciliation', 'Built-in difference tracking'],
  ['Driver-focused reports', 'General reports', 'Trucking-specific reports'],
  ['Mobile trucking workflow', 'General mobile app', 'Mobile-first driver workflow'],
  ['Contract clarity tools', 'Not focus area', 'Available'],
  ['Recruiter / opportunity tools', 'Not focus area', 'Available'],
  ['CPA / tax preparation support', 'Widely used with accountants', 'Helps organize records for a CPA'],
];

const FAQS = [
  { q: 'Does Haul Tracker Pro replace QuickBooks?', a: 'No. QuickBooks is a broad bookkeeping platform. Haul Tracker Pro is focused on trucking-specific load, fuel, expense, RPM, and profit tracking. Many drivers use a trucking-specific tracker alongside a bookkeeping tool or a CPA.' },
  { q: 'Is QuickBooks good for truck drivers?', a: 'It can be a good fit for general bookkeeping, especially when an accountant is involved. Drivers who want trucking-specific load profit visibility may want a trucking-focused tool too.' },
  { q: 'Why would a truck driver use Haul Tracker Pro instead of a general bookkeeping app?', a: 'Because it is built around trucking-specific fields: loaded vs deadhead miles, fuel per load, effective and net RPM, payment status, and driver-focused reports.' },
  { q: 'Can I export reports from Haul Tracker Pro?', a: 'Yes. CSV export is available, and Pro plans include PDF reports.' },
  { q: 'Can Haul Tracker Pro help organize tax-related records?', a: 'It helps organize trucking income, expenses, fuel, and mileage records. It is not tax advice, and drivers should work with a qualified tax professional.' },
  { q: 'Is Haul Tracker Pro for owner-operators and lease drivers?', a: 'Yes. Owner-operators, lease drivers, and 1099 truck drivers are the primary audience.' },
  { q: 'Can I use Haul Tracker Pro with my accountant?', a: 'Yes. Drivers can export CSV or Pro PDF reports to share with their accountant.' },
];

export default function HaulTrackerProVsQuickBooks() {
  const navigate = useNavigate();
  const path = '/haultrackerpro-vs-quickbooks';

  return (
    <ComparisonShell>
      <SEOHead
        title="Haul Tracker Pro vs QuickBooks — Trucking Profit Tracker vs General Bookkeeping"
        description="Compare Haul Tracker Pro and QuickBooks for owner-operators, lease drivers, and 1099 truck drivers who need trucking-specific load, fuel, expense, RPM, and profit tracking."
        path={path}
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'Haul Tracker Pro vs QuickBooks',
            url: `https://haultrackerpro.com${path}`,
            description: 'Comparison of Haul Tracker Pro and QuickBooks for trucking profit tracking vs general bookkeeping.',
          },
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Compare', path: '/haultrackerpro-vs-quickbooks' },
          ]),
          buildFAQSchema(FAQS),
        ]}
      />

      <section className="text-center space-y-5">
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
          Haul Tracker Pro vs QuickBooks: Trucking Profit Tracking vs General Bookkeeping
        </h1>
        <p className="text-base sm:text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'hsl(220, 10%, 60%)' }}>
          QuickBooks can be useful for general bookkeeping, but truck drivers often need a simpler trucking-specific way to track loads, deadhead miles, fuel, expenses, RPM, payment status, and real profit.
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
          QuickBooks may be a good fit for full bookkeeping, accountant workflows, and broader business accounting. Haul Tracker Pro may be a better fit for truck drivers who want a mobile-first, trucking-specific way to track load profit and understand real numbers before reports or tax time.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>Category comparison</h2>
        <CompareTable headers={['Category', 'QuickBooks', 'Haul Tracker Pro']} rows={ROWS} />
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border p-5" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <h3 className="font-black mb-3" style={{ color: 'hsl(0, 0%, 100%)' }}>When QuickBooks may be better</h3>
          <ul className="space-y-1.5 text-sm" style={{ color: 'hsl(220, 10%, 65%)' }}>
            <li>• You need full bookkeeping across multiple business operations</li>
            <li>• Your accountant already manages everything there</li>
            <li>• You need payroll, invoicing, or broader accounting workflows</li>
            <li>• You are comfortable with setup and categorization</li>
          </ul>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(25, 95%, 53%, 0.3)' }}>
          <h3 className="font-black mb-3" style={{ color: 'hsl(0, 0%, 100%)' }}>When Haul Tracker Pro may be better</h3>
          <ul className="space-y-1.5 text-sm" style={{ color: 'hsl(220, 10%, 65%)' }}>
            <li>• You want trucking-specific load profit tracking</li>
            <li>• You need deadhead miles and real RPM</li>
            <li>• You want profit per load</li>
            <li>• You want fuel, expenses, and payment status in one driver-focused workflow</li>
            <li>• You want simple reports built around trucking</li>
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border p-6" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <h2 className="text-xl font-black mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>Can they work together?</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
          Many drivers use Haul Tracker Pro to track trucking-specific load and profit details, and a separate bookkeeping tool or CPA for tax filing and broader accounting. Haul Tracker Pro does not advertise a direct integration with QuickBooks; CSV and Pro PDF exports can be shared with an accountant.
        </p>
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
            ['Bookkeeping Guide', '/trucker-bookkeeping-guide'],
            ['Expense Tracker', '/owner-operator-expense-tracker'],
            ['Tax Deductions', '/truck-driver-tax-deductions'],
            ['Cost Per Mile', '/trucking-cost-per-mile'],
          ].map(([label, href]) => (
            <Button key={href} variant="outline" size="sm" onClick={() => navigate(href)} className="rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>{label}</Button>
          ))}
        </div>
      </section>
    </ComparisonShell>
  );
}
