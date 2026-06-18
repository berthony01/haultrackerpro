import {
  ArrowRight,
  TrendingUp,
  Shield,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Users,
  Briefcase,
  Menu,
  X,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import dashboardMockup from '@/assets/dashboard-mockup.png';
import SEOHead from '@/components/SEOHead';
import { trackStarterKitCTAClicked } from '@/lib/analytics';

const faqs = [
  { q: 'Is it really free?', a: 'Yes. The Free plan gives drivers unlimited load logging, expense tracking, multi-stop loads, basic smart alerts, and CSV exports — no credit card. Pro ($19.99/mo or $179.88/yr) adds AI automation, advanced insights, and the Driver Scorecard.' },
  { q: 'How do recruiters get verified?', a: 'Recruiters apply for verified access on the Recruiters page. Once approved, they can post unlimited standard opportunities, manage applicants, and track referrals. Paid recruiter plans add premium visibility, analytics, and contract workflow tools.' },
  { q: 'Is my data secure?', a: 'All data is encrypted in transit and stored securely. We never sell or share your data.' },
  { q: 'How is this different from a spreadsheet?', a: 'Instant profit calculations, weekly closeouts, pay variance alerts, and exports built specifically for trucking — no formulas to maintain.' },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_SURFACE = 'hsl(220, 20%, 11%)';
const NAVY_BORDER = 'hsl(220, 16%, 18%)';
const AMBER = 'hsl(25, 95%, 53%)';
const AMBER_BRIGHT = 'hsl(25, 95%, 60%)';
const TEXT_MUTED = 'hsl(220, 10%, 65%)';
const TEXT_DIM = 'hsl(220, 10%, 50%)';
const GREEN = 'hsl(152, 60%, 45%)';

export default function Landing() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const goToDriver = () => navigate('/auth?intent=driver');
  const goToRecruiter = () => navigate('/recruiters');

  useEffect(() => {
    if (!window.location.hash) return;
    const id = window.location.hash.slice(1);
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }
      if (attempts++ < 20) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: NAVY_BG }}>
      <SEOHead
        title="HaulTrackerPro — Honest Trucking Economics for Drivers & Recruiters"
        description="The trucking platform where owner-operators track real profit per load and verified recruiters post real opportunities. Track loads, fuel, expenses, and RPM. Post jobs, manage applicants, track referrals. Start free."
        path="/"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'HaulTrackerPro',
            applicationCategory: 'FinanceApplication',
            applicationSubCategory: 'Trucking Software',
            operatingSystem: 'Web',
            description:
              'Truck driver profit tracker and verified recruiter opportunity platform.',
            url: 'https://haultrackerpro.com',
            offers: [
              { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Driver Free' },
              { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', name: 'Driver Pro Monthly' },
            ],
          },
          faqJsonLd,
        ]}
      />

      {/* NAV */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{ background: NAVY_BG, borderColor: 'hsl(220, 16%, 16%)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2"
            aria-label="HaulTrackerPro home"
          >
            <Truck className="h-6 w-6" style={{ color: AMBER }} />
            <span className="text-lg font-black tracking-tight text-white">HaulTrackerPro</span>
          </button>
          <div className="hidden md:flex items-center gap-1">
            {[
              { label: 'Features', href: '/features' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'Resources', href: '/resources' },
              { label: 'For Recruiters', href: '/recruiters' },
              { label: 'Sign In', href: '/auth' },
            ].map((item) => (
              <Button
                key={item.href}
                variant="ghost"
                onClick={() => navigate(item.href)}
                className="text-sm px-3"
                style={{ color: TEXT_MUTED }}
              >
                {item.label}
              </Button>
            ))}
            <Button
              onClick={goToDriver}
              className="text-sm font-bold rounded-xl px-5 ml-1"
              style={{ background: AMBER, color: 'white' }}
            >
              Start Free
            </Button>
          </div>
          <div className="flex md:hidden items-center gap-2">
            <Button
              onClick={goToDriver}
              className="text-xs font-bold rounded-xl px-3"
              style={{ background: AMBER, color: 'white' }}
            >
              Start Free
            </Button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg"
              aria-label="Toggle menu"
              style={{ color: TEXT_MUTED }}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div
            className="md:hidden border-t"
            style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}
          >
            <div className="flex flex-col px-4 py-3 space-y-1">
              {[
                { label: 'Features', href: '/features' },
                { label: 'Pricing', href: '/pricing' },
                { label: 'Resources', href: '/resources' },
                { label: 'For Recruiters', href: '/recruiters' },
                { label: 'FAQ', href: '/faq' },
                { label: 'Sign In', href: '/auth' },
              ].map((item) => (
                <button
                  key={item.href}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate(item.href);
                  }}
                  className="w-full text-left px-3 py-3 rounded-lg text-sm font-medium hover:bg-white/5"
                  style={{ color: TEXT_MUTED }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      <main>
        {/* ═══════════════════════════════════════════ */}
        {/* 1 · UNIFIED HERO — both audiences above the fold */}
        {/* ═══════════════════════════════════════════ */}
        <section className="relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(25, 95%, 53%, 0.10) 0%, transparent 70%)',
            }}
          />
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12 sm:pb-16 text-center">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6"
              style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: AMBER_BRIGHT }}
            >
              <Sparkles className="h-3.5 w-3.5" /> Built for Trucking — Drivers & Recruiters
            </div>
            <h1
              className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] text-white max-w-4xl mx-auto"
            >
              The honest trucking platform.{' '}
              <span style={{ color: AMBER }}>Drivers track real profit. Recruiters post real jobs.</span>
            </h1>
            <p
              className="mt-6 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto"
              style={{ color: TEXT_MUTED }}
            >
              HaulTrackerPro is one place where owner-operators see their true RPM and net profit per
              load, and verified recruiters reach drivers who actually know their numbers. No
              spreadsheets. No ghost applicants. No guessing.
            </p>

            {/* Dual primary CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={goToDriver}
                size="lg"
                className="text-base font-bold rounded-xl h-13 px-7 gap-2"
                style={{
                  background: AMBER,
                  color: 'white',
                  boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.55)',
                }}
              >
                <Truck className="h-5 w-5" /> Start tracking as a driver
              </Button>
              <Button
                onClick={goToRecruiter}
                size="lg"
                variant="outline"
                className="text-base font-bold rounded-xl h-13 px-7 gap-2 hover:bg-transparent"
                style={{
                  borderColor: AMBER,
                  color: AMBER_BRIGHT,
                  background: 'transparent',
                  borderWidth: 2,
                }}
              >
                <Users className="h-5 w-5" /> Post an opportunity as a recruiter
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium" style={{ color: TEXT_DIM }}>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" style={{ color: GREEN }} /> Free driver plan, no credit card</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" style={{ color: GREEN }} /> Verified recruiter access</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" style={{ color: GREEN }} /> Built only for trucking</span>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 2 · SPLIT PROBLEM → SOLUTION */}
        {/* ═══════════════════════════════════════════ */}
        <section className="border-t" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="text-center mb-10 sm:mb-14">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                One platform. Two sides of the trucking business — solved.
              </h2>
              <p className="mt-3 text-sm sm:text-base max-w-2xl mx-auto" style={{ color: TEXT_MUTED }}>
                Drivers and recruiters have been working blind in opposite directions. HaulTrackerPro brings them onto the same data.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {/* DRIVERS */}
              <div
                className="rounded-2xl border p-6 sm:p-8 flex flex-col"
                style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <div className="p-2 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                    <Truck className="h-5 w-5" style={{ color: AMBER }} />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>For Drivers</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white leading-tight">
                  Stop driving blind. Know your real profit per load.
                </h3>

                <div className="mt-6 space-y-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'hsl(0, 70%, 65%)' }}>
                    <AlertTriangle className="h-3.5 w-3.5" /> The problem
                  </p>
                  {[
                    'Pay statements that don\'t match what you actually earned',
                    'Receipts lost between fuel stops and tax season',
                    'No clue which lanes and brokers really pay',
                  ].map((t) => (
                    <p key={t} className="text-sm" style={{ color: TEXT_MUTED }}>— {t}</p>
                  ))}
                </div>

                <div className="mt-5 space-y-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: GREEN }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> What you get
                  </p>
                  {[
                    'Real RPM and net profit on every load',
                    'Fuel, expenses, and tax-ready records in one app',
                    'Smart alerts when a lane, broker, or pay starts slipping',
                  ].map((t) => (
                    <p key={t} className="text-sm text-white/90">— {t}</p>
                  ))}
                </div>

                <Button
                  onClick={goToDriver}
                  className="mt-7 rounded-xl font-bold gap-2 self-start"
                  style={{ background: AMBER, color: 'white' }}
                >
                  Start tracking free <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              {/* RECRUITERS */}
              <div
                className="rounded-2xl border p-6 sm:p-8 flex flex-col"
                style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <div className="p-2 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                    <Briefcase className="h-5 w-5" style={{ color: AMBER }} />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>For Recruiters</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white leading-tight">
                  Reach drivers who actually know their numbers.
                </h3>

                <div className="mt-6 space-y-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'hsl(0, 70%, 65%)' }}>
                    <AlertTriangle className="h-3.5 w-3.5" /> The problem
                  </p>
                  {[
                    'Ghost applicants and wasted ad spend',
                    'No way to prove your pay claims to skeptical drivers',
                    'Referrals slip through cracks with no tracking',
                  ].map((t) => (
                    <p key={t} className="text-sm" style={{ color: TEXT_MUTED }}>— {t}</p>
                  ))}
                </div>

                <div className="mt-5 space-y-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: GREEN }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> What you get
                  </p>
                  {[
                    'Verified recruiter access — only real recruiters post',
                    'Unlimited standard opportunities and applicant management',
                    'Driver referral tracking and recruiter analytics',
                  ].map((t) => (
                    <p key={t} className="text-sm text-white/90">— {t}</p>
                  ))}
                </div>

                <Button
                  onClick={goToRecruiter}
                  variant="outline"
                  className="mt-7 rounded-xl font-bold gap-2 self-start hover:bg-transparent"
                  style={{ borderColor: AMBER, color: AMBER_BRIGHT, borderWidth: 2, background: 'transparent' }}
                >
                  Get verified access <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 3 · PRODUCT VISUAL */}
        {/* ═══════════════════════════════════════════ */}
        <section className="border-t" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                One dashboard. One source of truth.
              </h2>
              <p className="mt-3 text-sm sm:text-base max-w-2xl mx-auto" style={{ color: TEXT_MUTED }}>
                Drivers see their real profit, fuel, and expenses. Recruiters see verified applicants and referral performance. Same data. Honest numbers.
              </p>
            </div>
            <div className="relative">
              <div
                className="rounded-2xl overflow-hidden border"
                style={{
                  borderColor: NAVY_BORDER,
                  boxShadow: '0 32px 64px -16px hsl(0, 0%, 0%, 0.55), 0 0 0 1px hsl(220, 16%, 16%)',
                }}
              >
                <img
                  src={dashboardMockup}
                  alt="HaulTrackerPro dashboard showing load tracking, real RPM, and net profit"
                  className="w-full"
                  width={1536}
                  height={1024}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div
                className="absolute -bottom-6 right-0 w-40 h-40 rounded-full blur-3xl pointer-events-none"
                style={{ background: 'hsl(25, 95%, 53%, 0.18)' }}
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 4 · TRUST + PRICING STRIP */}
        {/* ═══════════════════════════════════════════ */}
        <section className="border-t" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="flex items-center justify-center gap-2 mb-8">
              <Shield className="h-4 w-4" style={{ color: GREEN }} />
              <span className="text-sm" style={{ color: TEXT_MUTED }}>
                Encrypted in transit, stored securely. Your data is never sold or shared.
              </span>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              {[
                {
                  tag: 'DRIVERS',
                  name: 'Free',
                  price: '$0',
                  unit: 'forever',
                  bullets: ['Unlimited loads & expenses', 'Multi-stop loads, real RPM', 'CSV exports'],
                  cta: 'Start free',
                  onClick: goToDriver,
                  primary: false,
                },
                {
                  tag: 'DRIVERS',
                  name: 'Pro',
                  price: '$19.99',
                  unit: '/month',
                  bullets: ['AI automation & insights', 'Driver Scorecard, smart alerts', 'PDF reports + Pro analytics'],
                  cta: 'See Pro',
                  onClick: () => navigate('/pricing'),
                  primary: true,
                },
                {
                  tag: 'RECRUITERS',
                  name: 'Verified',
                  price: 'Apply',
                  unit: 'for access',
                  bullets: ['Unlimited standard opportunities', 'Applicant management', 'Referral tracking & analytics'],
                  cta: 'Apply now',
                  onClick: goToRecruiter,
                  primary: false,
                },
              ].map((tier) => (
                <div
                  key={tier.tag + tier.name}
                  className="rounded-2xl border p-6 flex flex-col"
                  style={{
                    background: tier.primary ? 'hsl(25, 95%, 53%, 0.06)' : NAVY_SURFACE,
                    borderColor: tier.primary ? AMBER : NAVY_BORDER,
                  }}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>
                    {tier.tag}
                  </span>
                  <h3 className="text-xl font-black text-white mt-1">{tier.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-black text-white">{tier.price}</span>
                    <span className="text-xs" style={{ color: TEXT_DIM }}>{tier.unit}</span>
                  </div>
                  <ul className="mt-5 space-y-2 flex-1">
                    {tier.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-sm" style={{ color: TEXT_MUTED }}>
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: GREEN }} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={tier.onClick}
                    className="mt-6 rounded-xl font-bold w-full"
                    style={
                      tier.primary
                        ? { background: AMBER, color: 'white' }
                        : { background: 'transparent', color: AMBER_BRIGHT, border: `1.5px solid ${AMBER}` }
                    }
                  >
                    {tier.cta}
                  </Button>
                </div>
              ))}
            </div>

            <div className="text-center mt-6">
              <button
                onClick={() => navigate('/pricing')}
                className="text-sm font-semibold underline-offset-4 hover:underline"
                style={{ color: AMBER_BRIGHT }}
              >
                See full pricing & feature comparison →
              </button>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 5 · FAQ + FINAL CTA */}
        {/* ═══════════════════════════════════════════ */}
        <section className="border-t" style={{ borderColor: 'hsl(220, 16%, 14%)' }}>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-black text-white text-center">
              Quick answers
            </h2>
            <div className="mt-8 space-y-2">
              {faqs.map((f, i) => {
                const open = openFaq === i;
                return (
                  <div
                    key={f.q}
                    className="rounded-xl border"
                    style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                  >
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="w-full text-left px-5 py-4 flex items-center justify-between gap-4"
                    >
                      <span className="text-sm sm:text-base font-bold text-white">{f.q}</span>
                      <span className="text-xl shrink-0" style={{ color: AMBER }}>{open ? '−' : '+'}</span>
                    </button>
                    {open && (
                      <p className="px-5 pb-5 text-sm leading-relaxed" style={{ color: TEXT_MUTED }}>
                        {f.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-center mt-4">
              <button
                onClick={() => navigate('/faq')}
                className="text-sm font-semibold underline-offset-4 hover:underline"
                style={{ color: AMBER_BRIGHT }}
              >
                See full FAQ →
              </button>
            </div>

            <div className="mt-14 text-center">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Pick your side. Start in under a minute.
              </h2>
              <p className="mt-3 text-sm" style={{ color: TEXT_MUTED }}>
                Free for drivers. Verified access for recruiters.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={goToDriver}
                  size="lg"
                  className="text-base font-bold rounded-xl h-13 px-7 gap-2"
                  style={{
                    background: AMBER,
                    color: 'white',
                    boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.55)',
                  }}
                >
                  <Truck className="h-5 w-5" /> Start tracking as a driver
                </Button>
                <Button
                  onClick={goToRecruiter}
                  size="lg"
                  variant="outline"
                  className="text-base font-bold rounded-xl h-13 px-7 gap-2 hover:bg-transparent"
                  style={{
                    borderColor: AMBER,
                    color: AMBER_BRIGHT,
                    background: 'transparent',
                    borderWidth: 2,
                  }}
                >
                  <Users className="h-5 w-5" /> Post an opportunity as a recruiter
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
                <button onClick={() => navigate('/features')} className="font-semibold hover:underline" style={{ color: TEXT_MUTED }}>
                  Explore all features
                </button>
                <button onClick={() => navigate('/resources')} className="font-semibold hover:underline" style={{ color: TEXT_MUTED }}>
                  Trucking resources
                </button>
                <button onClick={() => navigate('/about')} className="font-semibold hover:underline" style={{ color: TEXT_MUTED }}>
                  About HaulTrackerPro
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer
        className="border-t py-8"
        style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              {
                title: 'Product',
                links: [
                  { label: 'Features', href: '/features' },
                  { label: 'Pricing', href: '/pricing' },
                  { label: 'FAQ', href: '/faq' },
                ],
              },
              {
                title: 'Drivers',
                links: [
                  { label: 'Start Free', href: '/auth' },
                  { label: 'Profit Calculator', href: '/trucking-profit-calculator' },
                  { label: 'Cost Per Mile', href: '/trucking-cost-per-mile' },
                  { label: 'Tax Deductions', href: '/truck-driver-tax-deductions' },
                  { label: 'Starter Kit', href: '/starter-kit', track: true },
                ],
              },
              {
                title: 'Recruiters',
                links: [
                  { label: 'For Recruiters', href: '/recruiters' },
                  { label: 'Recruiter Features', href: '/recruiter/features' },
                  { label: 'Recruiter FAQ', href: '/recruiter/faq' },
                ],
              },
              {
                title: 'Company',
                links: [
                  { label: 'About', href: '/about' },
                  { label: 'Resources', href: '/resources' },
                  { label: 'Terms', href: '/terms' },
                  { label: 'Privacy', href: '/privacy' },
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <p
                  className="text-xs font-bold uppercase tracking-wider mb-3"
                  style={{ color: TEXT_DIM }}
                >
                  {col.title}
                </p>
                <div className="space-y-1.5">
                  {col.links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => {
                        if ((link as any).track) trackStarterKitCTAClicked('footer');
                      }}
                      className="block text-xs font-medium hover:underline"
                      style={{ color: 'hsl(220, 10%, 50%)' }}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div
            className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t"
            style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          >
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" style={{ color: TEXT_DIM }} />
              <span className="text-xs" style={{ color: TEXT_DIM }}>
                © {new Date().getFullYear()} HaulTrackerPro. All rights reserved.
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: TEXT_DIM }}>
              <TrendingUp className="h-3 w-3" /> Tracking tools only — always verify financial and tax information.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
