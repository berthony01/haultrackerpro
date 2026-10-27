import {
  ArrowRight,
  TrendingUp,
  Shield,
  Truck,
  Users,
  Briefcase,
  Menu,
  X,
  Sparkles,
  ClipboardList,
  Receipt,
  BarChart3,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import HomeConversationHero, {
  HOME_CONVERSATION_NEXT_PATH,
} from '@/components/home/HomeConversationHero';
import HomeTargetedJobContext from '@/components/home/HomeTargetedJobContext';
import { buildTargetedOpeningNote, readHomeDeepLink } from '@/lib/home/homeDeepLink';
import type { PublicTeaserRow } from '@/lib/home/publicTeaserPresentation';
import { saveIntakeSnapshot, type IntakeAnswers } from '@/lib/home/conversationIntake';
import SEOHead from '@/components/SEOHead';
import { trackStarterKitCTAClicked } from '@/lib/analytics';

const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_SURFACE = 'hsl(220, 20%, 11%)';
const NAVY_BORDER = 'hsl(220, 16%, 18%)';
const AMBER = 'hsl(25, 95%, 53%)';
const AMBER_BRIGHT = 'hsl(25, 95%, 60%)';
const TEXT_MUTED = 'hsl(220, 10%, 65%)';
const TEXT_DIM = 'hsl(220, 10%, 50%)';
const OFFWHITE = 'hsl(42, 33%, 96%)';
const OFFWHITE_ALT = 'hsl(42, 25%, 92%)';
const INK = 'hsl(220, 25%, 14%)';
const INK_MUTED = 'hsl(220, 12%, 38%)';
const TEAL = 'hsl(185, 65%, 38%)';

export default function Landing() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /**
   * HP-3C — bounded deep-link context. `jobId` is a canonical UUID or null;
   * campaign values stay in memory only and are never persisted, sent to the
   * server, or added to the auth handoff in this phase.
   */
  const [deepLink] = useState(() =>
    readHomeDeepLink(typeof window === 'undefined' ? '' : window.location.search),
  );
  const [targetedJob, setTargetedJob] = useState<PublicTeaserRow | null>(null);
  const openingNote = targetedJob
    ? buildTargetedOpeningNote(targetedJob.title, targetedJob.company_name)
    : undefined;

  const goToDriver = () => navigate('/auth?intent=driver');

  const focusConversation = useCallback(() => {
    const el = document.getElementById('home-conversation-input');
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    (el as HTMLTextAreaElement).focus();
  }, []);

  const scrollToAudiences = useCallback(() => {
    const el = document.getElementById('audiences');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  /**
   * Identity is requested only AFTER the driver has seen the summary of what
   * HaulTracker understood. The answers ride along in one bounded snapshot and
   * land on the existing Driver Opportunity Preferences review surface.
   */
  const continueToOpportunities = useCallback(
    (answers: IntakeAnswers) => {
      saveIntakeSnapshot(answers);
      navigate(`/auth?intent=driver&next=${encodeURIComponent(HOME_CONVERSATION_NEXT_PATH)}`);
    },
    [navigate],
  );

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
    { label: 'For Recruiters', href: '/recruiters' },
    { label: 'Assistants & Agencies', href: '/assistants-agencies' },
    { label: 'Resources', href: '/resources' },
  ];

  const mobileNav: Array<{ label: string; kind: 'scroll' | 'link'; href?: string }> = [
    { label: 'Features', kind: 'link', href: '/features' },
    { label: 'Pricing', kind: 'link', href: '/pricing' },
    { label: 'Resources', kind: 'link', href: '/resources' },
    { label: 'For Recruiters', kind: 'link', href: '/recruiters' },
    { label: 'Assistants & Agencies', kind: 'link', href: '/assistants-agencies' },
    { label: 'Log In', kind: 'link', href: '/auth' },
  ];

  const audiences = [
    {
      key: 'drivers',
      icon: Truck,
      eyebrow: 'Drivers & Owner-Operators',
      heading: 'Find your next opportunity. Keep your numbers in view.',
      capabilities: [
        'Describe the work you want in a free guided conversation, then review your answers before saving.',
        'Organize loads, expenses, fuel, and profit in one place.',
        'See real RPM and weekly closeouts instead of guessing from gross pay.',
      ],
      workflow: ['Describe your preferences', 'Review your answers', 'Explore opportunities'],
      actions: [
        { testid: 'hero-path-find-work', label: 'Find Work', onClick: focusConversation, primary: true },
        { testid: 'hero-path-my-trucking', label: 'Track My Trucking', onClick: goToDriver, primary: false },
      ],
      sectionTestId: 'my-trucking-section',
      ctaTestId: 'my-trucking-cta',
    },
    {
      key: 'recruiters',
      icon: Users,
      eyebrow: 'Carriers & Recruiters',
      heading: 'Put your opportunities in front of drivers.',
      capabilities: [
        'Post trucking opportunities from your recruiter workspace.',
        'Manage driver inquiries in one organized queue.',
        'Continue the conversation with interested drivers.',
      ],
      workflow: ['Post an opportunity', 'Manage inquiries', 'Continue the conversation'],
      actions: [
        { testid: 'hero-path-hire-drivers', label: 'Recruiting Tools', onClick: () => navigate('/recruiters'), primary: true },
      ],
      sectionTestId: undefined,
      ctaTestId: undefined,
    },
    {
      key: 'assistants',
      icon: Briefcase,
      eyebrow: 'Assistants & Agencies',
      heading: 'Help drivers keep their business organized.',
      capabilities: [
        'Work with authorized client records after the driver approves access.',
        'Support records and paperwork within the permissions each driver grants.',
        'Keep every client relationship clearly separated.',
      ],
      workflow: ['Driver approves access', 'Support their records', 'Work within granted permissions'],
      actions: [
        { testid: 'hero-path-assistants-agencies', label: 'Assistant & Agency Tools', onClick: () => navigate('/assistants-agencies'), primary: true },
      ],
      sectionTestId: undefined,
      ctaTestId: undefined,
    },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: NAVY_BG }}>
      <SEOHead
        title="HaulTrackerPro | Trucking Work, Recruiting & Business Tools"
        description="Find trucking opportunities, track loads and expenses, manage recruiter workflows, and support driver clients through approved assistant and agency access."
        path="/"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'HaulTrackerPro',
            applicationCategory: 'BusinessApplication',
            applicationSubCategory: 'Trucking Software',
            operatingSystem: 'Web',
            description:
              'Find trucking opportunities, track loads and expenses, manage recruiter workflows, and support driver clients through approved assistant and agency access.',
            url: 'https://haultrackerpro.com',
            offers: [
              { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Driver Free' },
              { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', name: 'Driver Pro Monthly' },
            ],
          },
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
            className="flex min-h-[44px] items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                className="min-h-[44px] text-sm px-2"
                style={{ color: TEXT_MUTED }}
              >
                {item.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              onClick={() => navigate('/auth')}
              className="min-h-[44px] text-sm px-2"
              style={{ color: TEXT_MUTED }}
            >
              Log In
            </Button>
            <Button
              data-testid="landing-header-start-talking"
              onClick={focusConversation}
              className="min-h-[44px] text-sm font-bold rounded-lg px-4 ml-1"
              style={{ background: AMBER, color: 'white' }}
            >
              Find Work
            </Button>
          </div>

          <div className="flex lg:hidden items-center gap-2">
            <Button
              data-testid="landing-header-start-talking-mobile"
              onClick={focusConversation}
              className="min-h-[44px] text-xs font-bold rounded-lg px-3"
              style={{ background: AMBER, color: 'white' }}
            >
              Find Work
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="h-11 w-11 p-2 rounded-lg"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              style={{ color: TEXT_MUTED }}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>
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
                <Button
                  variant="ghost"
                  key={item.label}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (item.kind === 'scroll') {
                      focusConversation();
                    } else {
                      if (item.href) navigate(item.href);
                    }
                  }}
                  className="w-full min-h-[44px] justify-start text-left px-3 py-3 rounded-lg text-sm font-medium"
                  style={{ color: TEXT_MUTED }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </nav>

      <main>
        {/* 1 — Asymmetric hero: editorial headline left, workspace visual right */}
        <section className="relative overflow-hidden" data-testid="landing-hero">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 70% 55% at 20% -5%, hsl(25, 95%, 53%, 0.18) 0%, transparent 65%), radial-gradient(ellipse 45% 40% at 90% 30%, hsl(185, 65%, 38%, 0.10) 0%, transparent 70%)',
            }}
          />
          <div
            className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, hsl(25, 95%, 53%, 0.5), transparent)' }}
          />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-12 sm:pb-16 grid gap-10 lg:grid-cols-[55%_45%] lg:items-center">
            <div className="text-left">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
                style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: AMBER_BRIGHT }}
              >
                <Sparkles className="h-3.5 w-3.5" /> For the people behind every haul
              </div>
              <h1 className="text-4xl leading-[1.05] sm:text-6xl font-black tracking-tight text-white">
                Find work. Run your business. Support the people who move it.
              </h1>
              <p
                className="mt-4 text-base sm:text-lg leading-relaxed max-w-xl"
                style={{ color: TEXT_MUTED }}
              >
                HaulTracker Pro connects drivers, recruiters, and approved support teams in one
                place: find trucking opportunities, keep your numbers organized, and manage the
                work around every load.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={focusConversation}
                  className="min-h-[44px] h-auto whitespace-normal rounded-lg font-bold gap-2 px-6"
                  style={{ background: AMBER, color: 'white' }}
                >
                  Find Work <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={scrollToAudiences}
                  className="min-h-[44px] h-auto whitespace-normal rounded-lg border border-sidebar-border"
                >
                  Explore the platform
                </Button>
              </div>
              <p className="mt-5 text-xs sm:text-sm" style={{ color: TEXT_DIM }}>
                The business platform behind every truck. Drivers start free, no credit card.
              </p>
            </div>

            <div
              className="rounded-xl border p-5 sm:p-7 text-left"
              style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
              aria-label="One platform. Three connected workspaces."
            >
              <p
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: TEAL }}
              >
                One platform. Three connected workspaces.
              </p>
              <div className="mt-5 space-y-3">
                {[
                  { icon: Truck, label: 'Drivers', note: 'Find work and track the business', inset: 'ml-0', accent: AMBER_BRIGHT },
                  { icon: Users, label: 'Carriers & Recruiters', note: 'Post opportunities, manage inquiries', inset: 'ml-4 sm:ml-8', accent: TEAL },
                  { icon: Briefcase, label: 'Assistants & Agencies', note: 'Support drivers with granted access', inset: 'ml-8 sm:ml-16', accent: AMBER_BRIGHT },
                ].map((row) => (
                  <div
                    key={row.label}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${row.inset}`}
                    style={{ background: 'hsl(220, 20%, 9%)', borderColor: NAVY_BORDER }}
                  >
                    <span
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'hsl(220, 16%, 16%)', color: row.accent }}
                    >
                      <row.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-white">{row.label}</span>
                      <span className="block text-xs" style={{ color: TEXT_MUTED }}>{row.note}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 2 — Equal audience showcase: three substantial alternating rows */}
        <section
          id="audiences"
          data-testid="hero-audience-paths"
          style={{ background: OFFWHITE }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight" style={{ color: INK }}>
              Built around the work you do.
            </h2>
            <div className="mt-8 space-y-6">
              {audiences.map((a, i) => (
                <article
                  key={a.key}
                  data-testid={a.sectionTestId}
                  className="grid gap-6 md:grid-cols-2 md:items-center rounded-xl border px-5 py-7 sm:px-8 sm:py-9"
                  style={{
                    background: i % 2 === 0 ? 'hsl(0, 0%, 100%)' : OFFWHITE_ALT,
                    borderColor: 'hsl(42, 15%, 85%)',
                  }}
                >
                  <div className={i % 2 === 1 ? 'md:order-2' : ''}>
                    <p
                      className="text-xs font-bold uppercase tracking-widest"
                      style={{ color: TEAL }}
                    >
                      {a.eyebrow}
                    </p>
                    <h2 className="mt-2 text-xl sm:text-2xl font-black" style={{ color: INK }}>
                      {a.heading}
                    </h2>
                    <ul className="mt-4 space-y-2">
                      {a.capabilities.map((c) => (
                        <li key={c} className="flex gap-2 text-sm leading-relaxed" style={{ color: INK_MUTED }}>
                          <span aria-hidden="true" style={{ color: AMBER }}>•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-6 flex flex-col sm:flex-row gap-3">
                      {a.actions.map((action) => {
                        const button = (
                          <Button
                            data-testid={action.testid}
                            onClick={action.onClick}
                            variant={action.primary ? 'default' : 'secondary'}
                            className="min-h-[44px] h-auto whitespace-normal rounded-lg font-bold gap-2"
                            style={action.primary ? { background: AMBER, color: 'white' } : undefined}
                          >
                            {action.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        );
                        return action.testid === 'hero-path-my-trucking' ? (
                          <span key={action.testid} data-testid="my-trucking-cta" className="inline-flex">
                            {button}
                          </span>
                        ) : (
                          <span key={action.testid} className="inline-flex">{button}</span>
                        );
                      })}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border px-5 py-6 ${i % 2 === 1 ? 'md:order-1' : ''}`}
                    style={{ background: OFFWHITE, borderColor: 'hsl(42, 15%, 85%)' }}
                  >
                    <p
                      className="text-xs font-bold uppercase tracking-widest"
                      style={{ color: INK_MUTED }}
                    >
                      Example workflow
                    </p>
                    <ol className="mt-4 space-y-3">
                      {a.workflow.map((step, si) => (
                        <li key={step} className="flex items-center gap-3">
                          <span
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black"
                            style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: AMBER }}
                          >
                            {si + 1}
                          </span>
                          <span className="text-sm font-semibold" style={{ color: INK }}>{step}</span>
                          {si < a.workflow.length - 1 && (
                            <ArrowRight className="h-3.5 w-3.5" style={{ color: TEAL }} aria-hidden="true" />
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 3 — Driver guided conversation, below the equal audience showcase */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="how-it-works-section"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 grid gap-8 lg:grid-cols-[40%_60%]">
            <div className="text-left">
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                Find trucking work
              </h2>
              <p className="mt-3 text-sm sm:text-base leading-relaxed" style={{ color: TEXT_MUTED }}>
                Use the free guided Find Work conversation to describe your preferences, then
                review them before saving.
              </p>
              <h3 className="mt-8 text-lg font-bold text-white">How finding work works.</h3>
              <ol className="mt-4 space-y-3">
                {[
                  { key: 'talk', text: 'Describe the trucking work you want.' },
                  { key: 'ask', text: 'Answer a few guided follow-up questions.' },
                  { key: 'continue', text: 'Review your preferences before saving.' },
                  { key: 'recruiter', text: 'Explore opportunities and contact recruiters.' },
                ].map((s, i) => (
                  <li
                    key={s.key}
                    data-testid={`how-it-works-step-${s.key}`}
                    className="flex items-center gap-3 border-l pl-3 text-left"
                    style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                  >
                    <span
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black"
                      style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: AMBER_BRIGHT }}
                    >
                      {i + 1}
                    </span>
                    <p className="py-2 text-sm text-white/90">{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              {deepLink.jobRequested && (
                <HomeTargetedJobContext
                  jobId={deepLink.jobId}
                  amber={AMBER}
                  surface={NAVY_SURFACE}
                  border={NAVY_BORDER}
                  textMuted={TEXT_MUTED}
                  onResolved={setTargetedJob}
                />
              )}
              <p
                data-testid="free-find-work-guide-label"
                className="mb-2 text-xs font-bold uppercase tracking-[0.16em]"
                style={{ color: AMBER_BRIGHT }}
              >
                Free Find Work Guide
              </p>
              <HomeConversationHero
                onContinue={continueToOpportunities}
                amber={AMBER}
                surface={NAVY_SURFACE}
                border={NAVY_BORDER}
                textMuted={TEXT_MUTED}
                textDim={TEXT_DIM}
                openingNote={openingNote}
              />
            </div>
          </div>
        </section>

        {/* 4 — Connective band */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 10%)' }}
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12 text-center">
            <h2 className="text-xl sm:text-2xl font-black text-white">
              Connected when you need it. Permissioned where it matters.
            </h2>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
              {[
                'Drivers review their preferences before anything is saved.',
                'Recruiters manage their own opportunities and inquiries.',
                'Assistants act only with access each driver has granted.',
              ].map((line) => (
                <p
                  key={line}
                  className="rounded-lg border px-4 py-4 text-sm leading-relaxed"
                  style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER, color: TEXT_MUTED }}
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* 5 — Compact supporting ecosystem */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="secondary-tools-section"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
            <h2 className="text-xl font-bold text-secondary-foreground mb-4">More tools for your work</h2>
            <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: TEXT_DIM }}>
              Also inside HaulTracker Pro
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
              {[
                { key: 'assistants', icon: Briefcase, label: 'Assistants & Agencies', href: '/assistants-agencies' },
                { key: 'parking', icon: Truck, label: 'Truck Parking', href: '/features#parking' },
                { key: 'calculators', icon: BarChart3, label: 'Calculators & Tools', href: '/trucking-profit-calculator' },
                { key: 'reports', icon: Receipt, label: 'Reports & Taxes', href: '/features' },
                { key: 'resources', icon: ClipboardList, label: 'Resources', href: '/resources' },
              ].map((s) => (
                <button
                  key={s.key}
                  data-testid={`secondary-tool-${s.key}`}
                  onClick={() => navigate(s.href)}
                  className="flex items-center gap-2 rounded-lg border px-3 py-3 min-h-[44px] text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
                  style={{ background: 'transparent', borderColor: NAVY_BORDER }}
                >
                  <s.icon className="h-4 w-4 shrink-0" style={{ color: TEXT_DIM }} />
                  <span className="text-xs font-semibold" style={{ color: TEXT_MUTED }}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 6 — Concise privacy / trust statement */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="trust-section"
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 text-center">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
              style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: AMBER_BRIGHT }}
            >
              <Lock className="h-3.5 w-3.5" /> Your information, your call
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white">
              You choose what to share.
            </h2>
            <p className="mt-3 text-sm sm:text-base leading-relaxed" style={{ color: TEXT_MUTED }}>
              Review your Find Work answers before saving your preferences. Driver assistant and agency access requires driver approval and is limited to granted permissions.
            </p>
            <p className="mt-3 text-xs" style={{ color: TEXT_DIM }}>
              Service payments between drivers and assistants or agencies are arranged outside
              HaulTracker Pro. HaulTracker Pro does not process service payments.
            </p>
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
                  { label: 'Help Center', href: '/docs' },
                  { label: 'Legal Center', href: '/legal' },
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
                        if ((link as { track?: boolean }).track) trackStarterKitCTAClicked('footer');
                      }}
                      className="flex min-h-[44px] items-center rounded text-xs font-medium text-sidebar-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
