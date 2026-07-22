import {
  ArrowRight,
  TrendingUp,
  Shield,
  Truck,
  CheckCircle2,
  Check,
  Users,
  Briefcase,
  Menu,
  X,
  Sparkles,
  ClipboardList,
  FileCheck2,
  UserCheck,
  Fuel,
  Receipt,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import dashboardMockup from '@/assets/dashboard-mockup.png';
import SEOHead from '@/components/SEOHead';
import { trackStarterKitCTAClicked } from '@/lib/analytics';
import { ASSISTANT_AGENCY_PLANS } from '@/lib/agencyPlans';

const faqs = [
  { q: 'Is it really free?', a: 'Yes. The Free plan gives drivers unlimited load logging, expense tracking, multi-stop loads, basic smart alerts, and CSV exports — no credit card. Pro ($19.99/mo or $179.88/yr) adds AI automation, advanced insights, and the Driver Scorecard.' },
  { q: 'How do recruiters get verified?', a: 'Recruiters apply for verified access on the Recruiters page. Once approved, they can post unlimited standard opportunities, manage applicants, and track referrals. Paid recruiter plans add premium visibility, analytics, and contract workflow tools.' },
  { q: 'Can I use HaulTracker Pro to help other drivers as a back-office professional?', a: 'Yes. Driver Assistants can help one or more drivers, and Agencies can manage multiple approved driver clients. Access requires explicit driver approval, drivers can revoke at any time, and every action is audit-logged. Payments between drivers and assistants or agencies are arranged outside HaulTracker Pro for now — opportunity only, no promise of clients or income.' },
  { q: 'Do assistants or agencies get access automatically?', a: 'No. Submitting an agency request never grants access. A driver must approve a specific delegation and choose exactly which permissions are granted (loads, expenses, fuel, reports, limited settings). Drivers can revoke instantly from the Driver Control Center.' },
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

type WorkspaceKey = 'driver' | 'recruiter' | 'backoffice';

const AGENCY_STARTER_PRICE = ASSISTANT_AGENCY_PLANS.agency_starter.monthlyPrice;

export default function Landing() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [workspace, setWorkspace] = useState<WorkspaceKey>('driver');

  const goToDriver = () => navigate('/auth?intent=driver');

  const scrollToSolutions = useCallback(() => {
    const el = document.getElementById('solutions');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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

  const desktopNav = [
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Resources', href: '/resources' },
  ];

  const mobileNav = [
    { label: 'Solutions', kind: 'scroll' as const },
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Resources', href: '/resources' },
    { label: 'For Recruiters', href: '/recruiters' },
    { label: 'Assistants & Agencies', href: '/assistants-agencies' },
    { label: 'Sign In', href: '/auth' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: NAVY_BG }}>
      <SEOHead
        title="HaulTrackerPro — The Business Platform Behind Every Truck"
        description="HaulTracker Pro helps truck drivers track real profit, recruiters post verified opportunities, and back-office professionals manage approved driver accounts with permission-based access and full audit logs."
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
              'Truck driver profit tracker, verified recruiter opportunity platform, and back-office workspace for driver assistants and agencies.',
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
        data-testid="landing-header"
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

          <div
            className="hidden lg:flex items-center gap-1"
            data-testid="landing-header-desktop-nav"
          >
            {desktopNav.map((item) => (
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
              variant="ghost"
              onClick={scrollToSolutions}
              className="text-sm px-3"
              style={{ color: TEXT_MUTED }}
            >
              Solutions
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate('/auth')}
              className="text-sm px-3"
              style={{ color: TEXT_MUTED }}
            >
              Sign In
            </Button>
            <Button
              onClick={goToDriver}
              className="text-sm font-bold rounded-xl px-5 ml-1"
              style={{ background: AMBER, color: 'white' }}
            >
              Start Free
            </Button>
          </div>

          <div className="flex lg:hidden items-center gap-2">
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
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              style={{ color: TEXT_MUTED }}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div
            className="lg:hidden border-t"
            style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}
            data-testid="landing-header-mobile-menu"
          >
            <div className="flex flex-col px-4 py-3 space-y-1">
              {mobileNav.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (item.kind === 'scroll') {
                      scrollToSolutions();
                    } else {
                      navigate(item.href);
                    }
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
        {/* HERO */}
        <section className="relative overflow-hidden" data-testid="landing-hero">
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
              <Sparkles className="h-3.5 w-3.5" /> One platform for drivers, recruiters &amp; back-office pros
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] text-white max-w-4xl mx-auto">
              The business platform behind every truck.
            </h1>
            <p
              className="mt-6 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto"
              style={{ color: TEXT_MUTED }}
            >
              Drivers track real profit on every load. Recruiters post verified opportunities and
              manage applicants. Back-office professionals — driver assistants and agencies —
              support approved driver accounts through permission-based access and audit records.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={goToDriver}
                size="lg"
                className="text-base sm:text-lg font-bold rounded-xl h-14 px-8 gap-2 w-full sm:w-auto"
                style={{
                  background: AMBER,
                  color: 'white',
                  boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.55)',
                }}
              >
                <Truck className="h-5 w-5" /> Start Free as a Driver
              </Button>
              <Button
                onClick={scrollToSolutions}
                size="lg"
                variant="outline"
                className="text-base sm:text-lg font-bold rounded-xl h-14 px-8 gap-2 w-full sm:w-auto hover:bg-transparent"
                style={{
                  borderColor: AMBER,
                  color: AMBER_BRIGHT,
                  background: 'transparent',
                  borderWidth: 2,
                }}
              >
                Explore Solutions <ArrowRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Compact audience-path chips */}
            <div
              className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto"
              data-testid="hero-audience-paths"
            >
              {[
                {
                  key: 'driver',
                  icon: Truck,
                  label: 'Drivers',
                  outcome: 'Know real profit on every load.',
                  href: '/auth?intent=driver',
                },
                {
                  key: 'recruiter',
                  icon: Users,
                  label: 'Recruiters & Carriers',
                  outcome: 'Post verified opportunities and manage applicants.',
                  href: '/recruiters',
                },
                {
                  key: 'backoffice',
                  icon: Briefcase,
                  label: 'Back-Office Businesses',
                  outcome: 'Support approved driver clients with audited access.',
                  href: '/assistants-agencies',
                },
              ].map((p) => (
                <button
                  key={p.key}
                  data-testid={`hero-path-${p.key}`}
                  onClick={() => navigate(p.href)}
                  className="text-left rounded-xl border p-4 hover:border-[hsl(25,95%,53%)] transition-colors"
                  style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                      <p.icon className="h-4 w-4" style={{ color: AMBER }} />
                    </div>
                    <span className="text-sm font-bold text-white">{p.label}</span>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: TEXT_MUTED }}>{p.outcome}</p>
                </button>
              ))}
            </div>

            <p className="mt-6 text-xs sm:text-sm" style={{ color: TEXT_DIM }}>
              Drivers start free — no credit card. Verified recruiters post standard opportunities free.
              Driver Assistant access is free after a driver approves it.
            </p>
          </div>
        </section>

        {/* PRODUCT PROOF — Workspaces */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="workspaces-section"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="text-center mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                One platform. Three connected workspaces.
              </h2>
              <p className="mt-3 text-sm sm:text-base max-w-2xl mx-auto" style={{ color: TEXT_MUTED }}>
                Each role gets a purpose-built workspace, all sharing the same trusted data.
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Workspace previews"
              className="flex flex-wrap justify-center gap-2 mb-6"
            >
              {[
                { key: 'driver' as WorkspaceKey, label: 'Driver Workspace' },
                { key: 'recruiter' as WorkspaceKey, label: 'Recruiter Workspace' },
                { key: 'backoffice' as WorkspaceKey, label: 'Back-Office Workspace' },
              ].map((t) => {
                const selected = workspace === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    id={`workspace-tab-${t.key}`}
                    aria-selected={selected}
                    aria-controls={`workspace-panel-${t.key}`}
                    onClick={() => setWorkspace(t.key)}
                    className="rounded-xl px-4 py-2 text-sm font-bold border transition-colors"
                    style={{
                      background: selected ? AMBER : 'transparent',
                      color: selected ? 'white' : TEXT_MUTED,
                      borderColor: selected ? AMBER : NAVY_BORDER,
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {workspace === 'driver' && (
              <div
                role="tabpanel"
                id="workspace-panel-driver"
                aria-labelledby="workspace-tab-driver"
                className="rounded-2xl border overflow-hidden"
                style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
              >
                <img
                  src={dashboardMockup}
                  alt="Driver workspace showing load tracking, real RPM, expenses, and net profit"
                  className="w-full"
                  width={1536}
                  height={1024}
                  loading="lazy"
                  decoding="async"
                />
                <div className="p-5 sm:p-6">
                  <p className="text-sm sm:text-base" style={{ color: TEXT_MUTED }}>
                    Track every load, log fuel and expenses in seconds, and see your real RPM and
                    net profit — not just gross pay.
                  </p>
                </div>
              </div>
            )}

            {workspace === 'recruiter' && (
              <div
                role="tabpanel"
                id="workspace-panel-recruiter"
                aria-labelledby="workspace-tab-recruiter"
                className="rounded-2xl border p-5 sm:p-8"
                style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
              >
                <div className="grid sm:grid-cols-3 gap-4">
                  {[
                    { icon: FileCheck2, title: 'Verified opportunities', body: 'Publish standard postings after verified recruiter approval.' },
                    { icon: ClipboardList, title: 'Applicant management', body: 'Track applicant status and history on paid plans.' },
                    { icon: BarChart3, title: 'Referrals & reports', body: 'Referral tracking and pipeline reports on paid plans.' },
                  ].map((c) => (
                    <div
                      key={c.title}
                      className="rounded-xl border p-4"
                      style={{ background: 'hsl(220, 20%, 9%)', borderColor: NAVY_BORDER }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <c.icon className="h-4 w-4" style={{ color: AMBER }} />
                        <span className="text-sm font-bold text-white">{c.title}</span>
                      </div>
                      <p className="text-xs" style={{ color: TEXT_MUTED }}>{c.body}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-sm" style={{ color: TEXT_MUTED }}>
                  Recruiter access requires verified approval. Contract workflow and advanced
                  analytics are available on paid recruiter plans.
                </p>
              </div>
            )}

            {workspace === 'backoffice' && (
              <div
                role="tabpanel"
                id="workspace-panel-backoffice"
                aria-labelledby="workspace-tab-backoffice"
                className="rounded-2xl border p-5 sm:p-8"
                style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
              >
                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { icon: UserCheck, title: 'Approved driver clients', body: 'Access is granted only after explicit driver approval.' },
                    { icon: Shield, title: 'Permission state', body: 'Loads, expenses, fuel, and reports each toggle individually.' },
                    { icon: ClipboardList, title: 'Work queue', body: 'Shared queue with waiting-on-driver responses.' },
                    { icon: Receipt, title: 'Audit record', body: 'Every action is timestamped and audit-logged.' },
                  ].map((c) => (
                    <div
                      key={c.title}
                      className="rounded-xl border p-4"
                      style={{ background: 'hsl(220, 20%, 9%)', borderColor: NAVY_BORDER }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <c.icon className="h-4 w-4" style={{ color: AMBER }} />
                        <span className="text-sm font-bold text-white">{c.title}</span>
                      </div>
                      <p className="text-xs" style={{ color: TEXT_MUTED }}>{c.body}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs" style={{ color: TEXT_DIM }}>
                  HaulTracker Pro does not process service payments between drivers and assistants
                  or agencies.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* SOLUTIONS */}
        <section
          id="solutions"
          className="border-t scroll-mt-20"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="solutions-section"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Every trucking business role gets a purpose-built workspace.
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  key: 'driver',
                  icon: Truck,
                  audience: 'Drivers',
                  tagline: 'Know what every load really earns.',
                  who: 'For company drivers, owner-operators, and small fleets.',
                  problem: 'Pay statements and fuel receipts scattered across notebooks and apps.',
                  outcomes: [
                    'Real RPM and net profit on every load',
                    'Fuel, expenses, and tax-ready records in one place',
                    'Weekly closeouts and smart alerts when pay slips',
                  ],
                  ctaLabel: 'Start Free as a Driver',
                  onClick: () => navigate('/auth?intent=driver'),
                },
                {
                  key: 'recruiter',
                  icon: Users,
                  audience: 'Recruiters & Carriers',
                  tagline: 'Publish verified opportunities and manage applicants.',
                  who: 'For verified recruiters and carrier hiring teams.',
                  problem: 'Ghost applicants, unverifiable pay claims, and lost referrals.',
                  outcomes: [
                    'Verified recruiter access — only approved recruiters post',
                    'Standard opportunity posting with applicant flow',
                    'Referral tracking and reports on paid plans',
                  ],
                  ctaLabel: 'Explore Recruiter Access',
                  onClick: () => navigate('/recruiters'),
                },
                {
                  key: 'backoffice',
                  icon: Briefcase,
                  audience: 'Back-Office Businesses',
                  tagline: 'Help approved drivers manage authorized operations.',
                  who: 'For driver assistants and back-office agencies.',
                  problem: 'Managing paperwork for multiple drivers without a system of record.',
                  outcomes: [
                    'Driver-approved delegation with granular permissions',
                    'Shared work queue and waiting-on-driver responses',
                    'Full audit log on every action taken',
                  ],
                  ctaLabel: 'Explore Back-Office Plans',
                  onClick: () => navigate('/assistants-agencies'),
                },
              ].map((c) => (
                <div
                  key={c.key}
                  data-testid={`solution-card-${c.key}`}
                  className="rounded-2xl border p-6 flex flex-col"
                  style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                      <c.icon className="h-5 w-5" style={{ color: AMBER }} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>
                      {c.audience}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-white leading-tight">{c.tagline}</h3>
                  <p className="mt-2 text-xs" style={{ color: TEXT_DIM }}>{c.who}</p>
                  <p className="mt-3 text-sm" style={{ color: TEXT_MUTED }}>{c.problem}</p>
                  <ul className="mt-4 space-y-2 flex-1">
                    {c.outcomes.map((o) => (
                      <li key={o} className="flex items-start gap-2 text-sm text-white/90">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: GREEN }} />
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={c.onClick}
                    className="mt-6 rounded-xl font-bold gap-2 self-start"
                    style={{ background: AMBER, color: 'white' }}
                  >
                    {c.ctaLabel} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="how-it-works-section"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                How HaulTracker Pro works for you.
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  key: 'driver',
                  audience: 'Drivers',
                  icon: Truck,
                  steps: [
                    'Start free.',
                    'Track loads, fuel, and expenses.',
                    'Review real profit and reports.',
                  ],
                },
                {
                  key: 'recruiter',
                  audience: 'Recruiters',
                  icon: Users,
                  steps: [
                    'Apply for verified recruiter access.',
                    'Publish standard opportunities.',
                    'Manage applicants and referrals.',
                  ],
                },
                {
                  key: 'backoffice',
                  audience: 'Back-Office',
                  icon: Briefcase,
                  steps: [
                    'Choose the assistant or agency path.',
                    'Receive explicit driver-approved permissions.',
                    'Manage only authorized work with audit visibility.',
                  ],
                },
              ].map((col) => (
                <div
                  key={col.key}
                  data-testid={`how-it-works-${col.key}`}
                  className="rounded-2xl border p-6"
                  style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                      <col.icon className="h-5 w-5" style={{ color: AMBER }} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>
                      {col.audience}
                    </span>
                  </div>
                  <ol className="space-y-3">
                    {col.steps.map((s, i) => (
                      <li key={s} className="flex items-start gap-3">
                        <span
                          className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-black"
                          style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: AMBER_BRIGHT }}
                        >
                          {i + 1}
                        </span>
                        <span className="text-sm text-white/90">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CREDIBILITY */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="credibility-section"
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-5"
              style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: AMBER_BRIGHT }}
            >
              <Fuel className="h-3.5 w-3.5" /> Built by an operator
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Built from firsthand trucking experience.
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed" style={{ color: TEXT_MUTED }}>
              HaulTracker Pro was designed around the real difficulty drivers face tracking pay,
              expenses, paperwork, and profitability on the road. Every workflow — from a single
              load entry to a full back-office delegation — comes from the day-to-day reality of
              running a trucking business, not a template.
            </p>
          </div>
        </section>

        {/* PRICING PREVIEW */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="pricing-preview-section"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Simple pricing for every role.
              </h2>
              <p className="mt-3 text-sm sm:text-base max-w-2xl mx-auto" style={{ color: TEXT_MUTED }}>
                Start free where it makes sense. Upgrade only when you need more.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  key: 'driver',
                  audience: 'Drivers',
                  icon: Truck,
                  lines: ['Free plan available', 'Pro from $19.99/month'],
                  ctaLabel: 'See driver pricing',
                  href: '/pricing?audience=driver',
                },
                {
                  key: 'recruiter',
                  audience: 'Recruiters & Carriers',
                  icon: Users,
                  lines: ['Free verified workspace', 'Paid plans from $19/month'],
                  ctaLabel: 'See recruiter pricing',
                  href: '/pricing?audience=recruiter',
                },
                {
                  key: 'agency',
                  audience: 'Back-Office Businesses',
                  icon: Briefcase,
                  lines: [
                    'Driver Assistant access is free',
                    `Agency plans from $${AGENCY_STARTER_PRICE}/month`,
                  ],
                  ctaLabel: 'See back-office pricing',
                  href: '/pricing?audience=agency',
                },
              ].map((c) => (
                <div
                  key={c.key}
                  data-testid={`pricing-preview-${c.key}`}
                  className="rounded-2xl border p-6 flex flex-col"
                  style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                      <c.icon className="h-5 w-5" style={{ color: AMBER }} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>
                      {c.audience}
                    </span>
                  </div>
                  <ul className="space-y-2 flex-1">
                    {c.lines.map((l) => (
                      <li key={l} className="flex items-start gap-2 text-sm text-white/90">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: GREEN }} />
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={() => navigate(c.href)}
                    className="mt-6 rounded-xl font-bold gap-2 self-start"
                    style={{ background: 'transparent', color: AMBER_BRIGHT, border: `1.5px solid ${AMBER}` }}
                  >
                    {c.ctaLabel} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-xs" style={{ color: TEXT_DIM }}>
              HaulTracker Pro does not process payments between drivers and assistants or agencies.
            </p>
          </div>
        </section>

        {/* FAQ + FINAL CTA */}
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

            <div className="mt-14 text-center" data-testid="final-cta-section">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Choose the workspace that fits your role.
              </h2>
              <p className="mt-3 text-sm" style={{ color: TEXT_MUTED }}>
                Drivers start free. Recruiters need verified access. Back-office access begins only
                with driver approval.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={() => navigate('/auth?intent=driver')}
                  size="lg"
                  className="text-base font-bold rounded-xl h-13 px-7 gap-2"
                  style={{
                    background: AMBER,
                    color: 'white',
                    boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.55)',
                  }}
                >
                  <Truck className="h-5 w-5" /> Start Free as a Driver
                </Button>
                <Button
                  onClick={() => navigate('/recruiters')}
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
                  <Users className="h-5 w-5" /> Explore Recruiter Access
                </Button>
                <Button
                  onClick={() => navigate('/assistants-agencies')}
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
                  <Briefcase className="h-5 w-5" /> Explore Back-Office Plans
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
