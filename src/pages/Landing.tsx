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
  MessageSquare,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import dashboardMockup from '@/assets/dashboard-mockup.png';
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
        {/* Audience entry, followed by the driver-only guided conversation */}
        <section className="relative overflow-hidden" data-testid="landing-hero">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 80% 55% at 50% -5%, hsl(25, 95%, 53%, 0.20) 0%, transparent 65%), radial-gradient(ellipse 60% 40% at 15% 20%, hsl(25, 95%, 53%, 0.07) 0%, transparent 70%)',
            }}
          />
          <div
            className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, hsl(25, 95%, 53%, 0.5), transparent)' }}
          />
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-12 pb-10 sm:pb-14 text-center">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-3"
              style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: AMBER_BRIGHT }}
            >
              <Sparkles className="h-3.5 w-3.5" /> For the people behind every haul
            </div>
            <h1 className="text-[1.9rem] leading-[1.08] sm:text-5xl font-black tracking-tight text-white max-w-3xl mx-auto">
              Trucking work and business, <span className="text-primary">connected.</span>
            </h1>
            <p
              className="mt-3 text-sm sm:text-lg leading-relaxed max-w-xl mx-auto"
              style={{ color: TEXT_MUTED }}
            >
              Find trucking opportunities, track your numbers, manage recruiting, or support approved driver clients. Choose where you want to start.
            </p>

            <div
              className="mt-7 grid grid-cols-1 md:grid-cols-3 gap-4 text-left"
              data-testid="hero-audience-paths"
            >
              <article className="flex flex-col rounded-lg border border-sidebar-border bg-secondary p-5 text-secondary-foreground">
                <Truck className="h-6 w-6 text-primary" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-bold">Drivers &amp; Owner-Operators</h2>
                <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground">
                  Find work that fits your preferences, or organize loads, expenses, fuel, and profit.
                </p>
                <div className="mt-auto pt-5 flex flex-col gap-2">
                  <Button data-testid="hero-path-find-work" onClick={focusConversation} className="min-h-[44px] h-auto whitespace-normal font-bold">
                    Find Work <ArrowRight aria-hidden="true" />
                  </Button>
                  <Button data-testid="hero-path-my-trucking" variant="secondary" onClick={goToDriver} className="min-h-[44px] h-auto whitespace-normal border border-sidebar-border">
                    Track My Trucking
                  </Button>
                </div>
              </article>
              <article className="flex flex-col rounded-lg border border-sidebar-border bg-secondary p-5 text-secondary-foreground">
                <Users className="h-6 w-6 text-primary" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-bold">Carriers &amp; Recruiters</h2>
                <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground">
                  Post opportunities and manage driver inquiries in your recruiter workspace.
                </p>
                <div className="mt-auto pt-5">
                  <Button data-testid="hero-path-hire-drivers" onClick={() => navigate('/recruiters')} className="w-full min-h-[44px] h-auto whitespace-normal font-bold">
                    Explore Recruiter Tools <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </article>
              <article className="flex flex-col rounded-lg border border-sidebar-border bg-secondary p-5 text-secondary-foreground">
                <Briefcase className="h-6 w-6 text-primary" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-bold">Assistants &amp; Agencies</h2>
                <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground">
                  Organize approved driver clients' records with the permissions they grant.
                </p>
                <div className="mt-auto pt-5">
                  <Button data-testid="hero-path-assistants-agencies" onClick={() => navigate('/assistants-agencies')} className="w-full min-h-[44px] h-auto whitespace-normal font-bold">
                    Explore Support Tools <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </article>
            </div>

            <div className="mt-10 text-left max-w-3xl mx-auto">
              <h2 className="text-xl sm:text-2xl font-bold text-secondary-foreground">
                Drivers: start with the work you want.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground">
                Use the free guided Find Work conversation to describe your preferences, then review them before saving.
              </p>
            </div>

            <div className="mt-5">
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


            <p className="mt-5 text-xs sm:text-sm" style={{ color: TEXT_DIM }}>
              The business platform behind every truck. Drivers start free — no credit card.
            </p>
          </div>
        </section>

        {/* 3 — ONE concise "How finding work works" */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="how-it-works-section"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
            <h2 className="text-xl sm:text-2xl font-black text-white text-center">
              How finding work works.
            </h2>
            <ol className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { key: 'talk', text: 'Talk — say what work you want, in your own words.' },
                { key: 'ask', text: 'HaulTracker asks what’s missing to understand your profile.' },
                { key: 'continue', text: 'Continue to real opportunities with your answers prefilled.' },
                { key: 'recruiter', text: 'Talk to a recruiter when you’re ready — no application forms to start.' },
              ].map((s, i) => (
                <li
                  key={s.key}
                  data-testid={`how-it-works-step-${s.key}`}
                  className="rounded-2xl border p-4 text-left"
                  style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}
                >
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black"
                    style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: AMBER_BRIGHT }}
                  >
                    {i + 1}
                  </span>
                  <p className="mt-2 text-sm text-white/90">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4 — ONE concise My Trucking proof */}
        <section
          className="border-t"
          style={{ borderColor: 'hsl(220, 16%, 14%)' }}
          data-testid="my-trucking-section"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14 grid gap-6 md:grid-cols-2 md:items-center">
            <div className="rounded-2xl border overflow-hidden" style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}>
              <img
                src={dashboardMockup}
                alt="Driver workspace showing load tracking, real RPM, expenses, and net profit"
                className="w-full"
                width={1536}
                height={1024}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="text-left">
              <h2 className="text-xl sm:text-2xl font-black text-white">
                My Trucking — know what every load really earns.
              </h2>
              <p className="mt-3 text-sm sm:text-base leading-relaxed" style={{ color: TEXT_MUTED }}>
                Log loads, fuel, and expenses in seconds. See real RPM, weekly closeouts, and net
                profit instead of gross pay. Drivers start free.
              </p>
              <Button
                data-testid="my-trucking-cta"
                onClick={goToDriver}
                className="mt-5 rounded-xl font-bold gap-2"
                style={{ background: AMBER, color: 'white' }}
              >
                Open My Trucking <ArrowRight className="h-4 w-4" />
              </Button>
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
            <h2 className="text-xl font-bold text-secondary-foreground">Connected work, practical tools.</h2>
            <div className="mt-4 mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sidebar-foreground">
              <div>
                <Button variant="link" onClick={focusConversation} className="min-h-[44px] h-auto px-0 whitespace-normal justify-start font-bold">Find work <ArrowRight aria-hidden="true" /></Button>
                <p className="text-sm">Drivers describe their preferences; recruiters manage opportunities and inquiries.</p>
              </div>
              <div>
                <Button variant="link" onClick={goToDriver} className="min-h-[44px] h-auto px-0 whitespace-normal justify-start font-bold">Run your trucking business <ArrowRight aria-hidden="true" /></Button>
                <p className="text-sm">Keep loads, expenses, fuel, and profit in your driver workspace.</p>
              </div>
              <div>
                <Button variant="link" onClick={() => navigate('/assistants-agencies')} className="min-h-[44px] h-auto px-0 whitespace-normal justify-start font-bold">Support drivers <ArrowRight aria-hidden="true" /></Button>
                <p className="text-sm">Assistants and agencies work within driver-approved permissions.</p>
              </div>
            </div>
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
                  className="flex items-center gap-2 rounded-xl border px-3 py-3 min-h-[44px] text-left hover:border-[hsl(25,95%,53%)] transition-colors"
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
