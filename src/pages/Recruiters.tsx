import { ArrowRight, Truck, Users, ShieldCheck, ClipboardList, Search, Handshake, BarChart3, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';

export default function Recruiters() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const goRecruiterAccess = () => {
    if (user) navigate('/dashboard?page=recruiter-access');
    else navigate('/auth?intent=recruiter');
  };

  const why = [
    { icon: Search, title: 'Reach financially serious drivers', desc: 'HaulTrackerPro drivers track real profit, RPM, and deductions — they evaluate opportunities by the numbers.' },
    { icon: ClipboardList, title: 'Post structured opportunities', desc: 'Required fields for pay, lanes, equipment, and deductions create clear, comparable listings.' },
    { icon: Handshake, title: 'Manage driver requests', desc: 'A built-in applications dashboard lets you review interest and respond from one place.' },
    { icon: ShieldCheck, title: 'Build trust through transparency', desc: 'Approved-only access and reviewed listings protect both drivers and recruiters.' },
  ];

  const steps = [
    'Apply for recruiter access',
    'Submit company / recruiter details',
    'Get approved by HaulTrackerPro',
    'Choose Starter, Growth, or Fleet plan',
    'Post structured opportunities',
    'Manage driver requests',
  ];

  const plans = [
    { name: 'Starter', price: '$19', limit: '1 active opportunity' },
    { name: 'Growth', price: '$49', limit: '5 active opportunities', highlight: true },
    { name: 'Fleet', price: '$149', limit: '25 active opportunities' },
  ];

  const driverSees = [
    'Estimated gross & net pay',
    'Effective RPM',
    'Deadhead disclosure',
    'Deductions breakdown',
    'Profit Intelligence context',
    'Deterministic match score',
  ];

  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="Recruiter Access | HaulTrackerPro"
        description="Approved recruiters and carriers can post structured trucking opportunities, manage driver requests, and connect with drivers using HaulTrackerPro's profit-first ecosystem."
        path="/recruiters"
      />

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </button>
          <div className="flex items-center gap-1 sm:gap-3">
            <Button variant="ghost" onClick={() => navigate('/features')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Features</Button>
            <Button variant="ghost" onClick={() => navigate('/pricing')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Pricing</Button>
            <Button variant="ghost" onClick={() => navigate('/auth')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Sign In</Button>
            <Button onClick={() => navigate('/auth')} className="text-xs sm:text-sm font-bold rounded-xl px-3 sm:px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Tracking Free
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%)'
        }} />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-10 text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6" style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: 'hsl(25, 95%, 60%)' }}>
            <Users className="h-3.5 w-3.5" /> For Recruiters &amp; Carriers
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Recruit Drivers Through a{' '}
            <span style={{ color: 'hsl(25, 95%, 53%)' }}>Profit-First Trucking Platform</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg max-w-2xl mx-auto" style={{ color: 'hsl(220, 10%, 60%)' }}>
            HaulTrackerPro helps approved recruiters and carriers post structured trucking opportunities, manage driver requests, and connect with drivers who care about real numbers.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button onClick={goRecruiterAccess} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)', boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)' }}>
              Apply for Recruiter Access <ArrowRight className="h-5 w-5" />
            </Button>
            <Button onClick={() => navigate('/pricing#for-recruiters')} variant="outline" size="lg" className="text-base font-semibold rounded-xl h-13 px-8" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              View Recruiter Plans
            </Button>
          </div>
          <p className="text-[11px] mt-6 max-w-xl mx-auto" style={{ color: 'hsl(220, 10%, 40%)' }}>
            Approval required before posting. Pay and match details shown to drivers are estimates based on recruiter-provided data — no job or income is guaranteed.
          </p>
        </div>
      </section>

      {/* Why */}
      <section className="py-14 sm:py-20" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Why Recruiters Use HaulTrackerPro
          </h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {why.map((w) => (
              <div key={w.title} className="p-5 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <div className="h-10 w-10 rounded-lg flex items-center justify-center mb-3" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                  <w.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <h3 className="text-base font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>{w.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-14 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10" style={{ color: 'hsl(0, 0%, 100%)' }}>
            How It Works
          </h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3 p-4 rounded-xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <span className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: 'hsl(25, 95%, 60%)' }}>{i + 1}</span>
                <span className="text-sm font-medium" style={{ color: 'hsl(220, 10%, 75%)' }}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Plans preview */}
      <section className="py-14 sm:py-20" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Recruiter Plans
          </h2>
          <p className="text-center text-sm mb-10" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Pick a plan that matches the volume of opportunities you post.
          </p>
          <div className="grid sm:grid-cols-3 gap-5">
            {plans.map((p) => (
              <div key={p.name} className="p-6 rounded-2xl border relative" style={{
                background: 'hsl(220, 20%, 10%)',
                borderColor: p.highlight ? 'hsl(25, 95%, 53%)' : 'hsl(220, 16%, 16%)',
                boxShadow: p.highlight ? '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)' : undefined,
              }}>
                {p.highlight && (
                  <div className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[10px] font-bold" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-base font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>{p.name}</h3>
                <p className="text-xs mb-4" style={{ color: 'hsl(220, 10%, 55%)' }}>{p.limit}</p>
                <div>
                  <span className="text-3xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>{p.price}</span>
                  <span className="text-xs ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>/month</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <Button onClick={() => navigate('/pricing#for-recruiters')} variant="outline" className="rounded-xl font-bold gap-2" style={{ borderColor: 'hsl(25, 95%, 53%)', color: 'hsl(25, 95%, 60%)', background: 'transparent' }}>
              See Full Pricing <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* What drivers see */}
      <section className="py-14 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <BarChart3 className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center" style={{ color: 'hsl(0, 0%, 100%)' }}>
              What Drivers See
            </h2>
          </div>
          <p className="text-center text-sm mb-8 max-w-xl mx-auto" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Each opportunity is rendered with the same profit-first context drivers use to evaluate any load.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 max-w-xl mx-auto">
            {driverSees.map((d) => (
              <div key={d} className="flex items-center gap-2 p-3 rounded-lg border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'hsl(152, 60%, 42%)' }} />
                <span className="text-sm" style={{ color: 'hsl(220, 10%, 75%)' }}>{d}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-center mt-6 max-w-xl mx-auto" style={{ color: 'hsl(220, 10%, 40%)' }}>
            Pay and match details are estimates based on recruiter-provided data. No job or income is guaranteed.
          </p>
        </div>
      </section>

      {/* Trust & approval */}
      <section className="py-14 sm:py-20" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="p-6 sm:p-8 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
              <h2 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>Trust &amp; Approval</h2>
            </div>
            <ul className="space-y-2.5 text-sm" style={{ color: 'hsl(220, 10%, 70%)' }}>
              {[
                'Recruiter approval is required before any opportunity goes live',
                'Opportunities are reviewed before they reach drivers',
                'Misleading or non-compliant posts may be removed',
                'Drivers remain protected — their data is never sold',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(152, 60%, 42%)' }} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-4xl font-black tracking-tight mb-5" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Ready to recruit through a profit-first platform?
          </h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button onClick={goRecruiterAccess} size="lg" className="text-base font-bold rounded-xl h-13 px-8 gap-2" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Apply for Recruiter Access <ArrowRight className="h-5 w-5" />
            </Button>
            <Button onClick={() => navigate('/pricing#for-recruiters')} variant="outline" size="lg" className="text-base font-semibold rounded-xl h-13 px-8" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              View Recruiter Plans
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          <div className="flex items-center gap-5">
            {[
              { label: 'Features', href: '/features' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'For Recruiters', href: '/recruiters' },
              { label: 'Terms', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
              { label: 'FAQ', href: '/faq' },
            ].map((l) => (
              <a key={l.href} href={l.href} className="text-xs font-medium hover:underline" style={{ color: 'hsl(220, 10%, 50%)' }}>{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
