import { ArrowRight, Truck, Shield, TrendingUp, Users, Briefcase, FileSignature, ParkingCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="About Haul Tracker Pro — Trucking Profit Tracker Built for Owner-Operators"
        description="Learn why Haul Tracker Pro was built for owner-operators, lease drivers, and 1099 truck drivers who need clearer load profit, fuel, expense, RPM, report, and contract tracking."
        path="/about"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Haul Tracker Pro',
            url: 'https://haultrackerpro.com',
            description:
              'Trucking profit tracking platform for owner-operators, lease drivers, and 1099 truck drivers.',
            sameAs: [],
          },
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Haul Tracker Pro',
            url: 'https://haultrackerpro.com',
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://haultrackerpro.com/' },
              { '@type': 'ListItem', position: 2, name: 'About', item: 'https://haultrackerpro.com/about' },
            ],
          },
        ]}
      />

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" onClick={() => navigate('/resources')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Resources</Button>
            <Button variant="ghost" onClick={() => navigate('/pricing')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Pricing</Button>
            <Button onClick={() => navigate('/auth')} className="text-xs sm:text-sm font-bold rounded-xl px-3 sm:px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Tracking Free
            </Button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-20 space-y-16">
        {/* Hero */}
        <section className="text-center space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: 'hsl(25, 95%, 60%)' }}>
            <TrendingUp className="h-3.5 w-3.5" /> About Haul Tracker Pro
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Built so truck drivers can see their{' '}
            <span style={{ color: 'hsl(25, 95%, 53%)' }}>real profit</span>, not just their gross pay.
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'hsl(220, 10%, 60%)' }}>
            Haul Tracker Pro is a mobile-first trucking profit tracking platform built for owner-operators, lease drivers, and 1099 truck drivers who need to track loads, fuel, expenses, deadhead miles, RPM, net profit, reports, and contract-related details in one place.
          </p>
        </section>

        {/* Why it exists */}
        <section className="space-y-4">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>Why Haul Tracker Pro exists</h2>
          <p className="leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
            Truck drivers often see gross pay, but not true profit. Haul Tracker Pro was built to help drivers understand what they actually keep after fuel, deadhead, expenses, deductions, short pays, and unpaid loads.
          </p>
          <p className="leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
            Haul Tracker Pro was built from real trucking pain points: loads that look good on paper, fuel costs that eat into profit, deadhead miles that get ignored, and paperwork that becomes hard to organize at tax time. The goal is simple — give drivers a clear, honest view of their business so they can make better decisions before, during, and after each load.
          </p>
        </section>

        {/* Who it helps */}
        <section className="space-y-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>Who it helps</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: Truck, title: 'Owner-operators', desc: 'Track loads, fuel, expenses, and net profit across your authority.' },
              { icon: Users, title: 'Lease drivers', desc: 'Understand what you keep after settlements, fuel, and deductions.' },
              { icon: FileSignature, title: '1099 truck drivers', desc: 'Organize income, expenses, and contract details for cleaner records.' },
              { icon: Briefcase, title: 'Trucking recruiters & carriers', desc: 'Post verified opportunities, manage applicants, and track referrals.' },
            ].map((a) => (
              <div key={a.title} className="flex gap-4 p-5 rounded-xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                  <a.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>{a.title}</h3>
                  <p className="text-sm" style={{ color: 'hsl(220, 10%, 60%)' }}>{a.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What it tracks */}
        <section className="space-y-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>What Haul Tracker Pro helps you track</h2>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              'Load revenue',
              'Loaded miles',
              'Deadhead miles',
              'Total miles',
              'Fuel',
              'Expenses',
              'Net profit',
              'Effective RPM',
              'Net RPM',
              'Payment status',
              'Pay differences (short pays, unpaid)',
              'CSV exports',
              'Pro PDF reports',
              'Contract clarity tools',
              'Recruiter opportunity tools',
              'Parking community tools',
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm py-1.5" style={{ color: 'hsl(220, 10%, 70%)' }}>
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'hsl(152, 60%, 42%)' }} />
                {f}
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section className="space-y-4 rounded-2xl border p-6 sm:p-8" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <h2 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>Trust &amp; disclaimers</h2>
          </div>
          <ul className="space-y-2 text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
            <li>• Haul Tracker Pro is not tax advice.</li>
            <li>• Haul Tracker Pro is not legal advice.</li>
            <li>• Haul Tracker Pro is not financial advice.</li>
            <li>• Drivers should confirm tax, legal, and financial questions with qualified professionals.</li>
            <li>• The platform is designed for organization, visibility, and decision support — not to guarantee earnings, savings, deductions, or legal outcomes.</li>
          </ul>
        </section>

        {/* CTAs */}
        <section className="space-y-4 text-center">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>Get started</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => navigate('/auth')} className="text-sm font-bold rounded-xl gap-2" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Tracking Free <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => navigate('/pricing')} className="text-sm font-semibold rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              View Pricing
            </Button>
            <Button variant="outline" onClick={() => navigate('/resources')} className="text-sm font-semibold rounded-xl" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              Explore Resources
            </Button>
            <Button variant="outline" onClick={() => navigate('/recruiters')} className="text-sm font-semibold rounded-xl gap-2" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              <Briefcase className="h-4 w-4" /> For Recruiters
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          <div className="flex items-center gap-5">
            {[
              { label: 'Resources', href: '/resources' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'Terms', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
            ].map((link) => (
              <a key={link.href} href={link.href} className="text-xs font-medium hover:underline" style={{ color: 'hsl(220, 10%, 50%)' }}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
