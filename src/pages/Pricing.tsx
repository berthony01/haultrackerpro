import { useState, useMemo } from 'react';
import {
  ArrowRight,
  Check,
  Minus,
  Truck,
  Users,
  Shield,
  TrendingUp,
  Target,
  BarChart3,
  Zap,
  Briefcase,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  trackBeginCheckout,
  trackStarterKitCTAClicked,
} from '@/lib/analytics';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import {
  ASSISTANT_AGENCY_PLANS,
  ALL_AGENCY_PLAN_KEYS,
  OUTSIDE_PAYMENTS_DISCLAIMER,
  AGENCY_SETTLEMENT_RECORDKEEPING_DISCLAIMER,
} from '@/lib/agencyPlans';

// ---------------------------------------------------------------------------
// Audience routing
// ---------------------------------------------------------------------------

type Audience = 'driver' | 'recruiter' | 'agency';

const AUDIENCES: Audience[] = ['driver', 'recruiter', 'agency'];

const AUDIENCE_LABEL: Record<Audience, string> = {
  driver: 'Drivers',
  recruiter: 'Recruiters & Carriers',
  agency: 'Back-Office Businesses',
};

const AUDIENCE_DESCRIPTION: Record<Audience, string> = {
  driver: 'Track loads, expenses, profit, taxes, and business performance.',
  recruiter:
    'Post opportunities and manage applicants, contracts, referrals, and hiring performance.',
  agency: 'Assist drivers individually or run a multi-client agency.',
};

function isAudience(value: unknown): value is Audience {
  return value === 'driver' || value === 'recruiter' || value === 'agency';
}

/**
 * Resolve audience from URL with explicit, non-fall-through precedence:
 *
 *  1. If the `?audience=` query parameter is PRESENT (even if invalid), the
 *     query controls resolution:
 *       - a valid value ('driver' | 'recruiter' | 'agency') selects that
 *         audience;
 *       - any invalid value defaults to 'driver' and MUST NOT fall through
 *         to a legacy hash. Present-but-invalid query beats any hash.
 *  2. Only when the `audience` query parameter is COMPLETELY ABSENT may
 *     the legacy hash select an audience:
 *       - '#driver-plans'         → 'driver'
 *       - '#for-recruiters'       → 'recruiter'
 *       - '#assistants-agencies'  → 'agency'
 *  3. Missing query and missing/invalid hash defaults to 'driver'.
 */
function resolveAudience(search: string, hash: string): Audience {
  const params = new URLSearchParams(search);
  if (params.has('audience')) {
    const q = params.get('audience');
    return isAudience(q) ? q : 'driver';
  }
  const h = hash.replace(/^#/, '');
  if (h === 'driver-plans') return 'driver';
  if (h === 'for-recruiters') return 'recruiter';
  if (h === 'assistants-agencies') return 'agency';
  return 'driver';
}

// ---------------------------------------------------------------------------
// Driver plan data
// ---------------------------------------------------------------------------

const freeFeatures = [
  'Unlimited load logging',
  'Unlimited expense tracking',
  'Net profit per load calculation',
  'Estimated vs actual pay comparison',
  'Multi-stop load support',
  'Basic smart alerts',
  '2 Performance Charts (Net Profit & Revenue vs Expenses)',
  'Basic Tax Set-Aside estimate (single total)',
  'CSV exports',
  'Paste Load Parser (5 per week)',
  'Custom week start day',
  'View finalized settlement statements issued to you',
  'Basic settlement reconciliation (confirm or clear a load match)',
];

const proFeatures = [
  'Score loads before you take them (RPM, margin, deadhead, broker)',
  'See your best & worst lanes and broker reliability automatically',
  'Get warned when a lane weakens, a broker pays slow, or margin slips',
  'Start-of-week recap: lane to repeat, lane to avoid, broker to watch',
  'Log expenses by voice — hands-free',
  'Snap a receipt — OCR fills in the expense details',
  'Snap a rate con, AI fills in the load',
  'AI weekly business report on what made and lost money',
  'AI lane advice based on your own load history',
  'AI tax tips to keep more of what you earn',
  'Unlimited Paste Load Parser',
  'RPM, deadhead %, and expense breakdown charts',
  'Driver performance scorecard',
  'Weekly closeout snapshots',
  'Full tax breakdown with quarterly schedule',
  'Advanced alerts with dollar impact (profit drops, RPM dips)',
  'PDF profit reports for taxes, bookkeepers, or disputes',
  'Real-time Parking Finder with driver-verified availability',
  'Driver points, streaks & community leaderboard',
  'Parking log export (CSV + PDF) for paperwork',
  'Driver-to-driver referral submissions (recruiters pay any bonuses externally)',
  'Advanced settlement reconciliation (refresh or reject suggested load matches)',
  'Create manual records for settlements you received outside HaulTrackerPro',
];

const PRO_KEY_BENEFIT_COUNT = 8;
const proKeyBenefits = proFeatures.slice(0, PRO_KEY_BENEFIT_COUNT);
const proAdditionalBenefits = proFeatures.slice(PRO_KEY_BENEFIT_COUNT);

const comparisonRows: { feature: string; free: string; pro: string }[] = [
  { feature: 'Load & expense logging', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Net profit per load', free: '✓', pro: '✓' },
  { feature: 'Est. vs actual pay', free: '✓', pro: '✓' },
  { feature: 'Multi-stop loads', free: '✓', pro: '✓' },
  { feature: 'Smart alerts', free: 'Basic', pro: 'All (advanced included)' },
  { feature: 'Performance charts', free: '2 charts', pro: 'All 5 charts' },
  { feature: 'Tax planning', free: 'Total estimate only', pro: 'Full breakdown + quarterly' },
  { feature: 'Paste Load Parser', free: '5 per week', pro: 'Unlimited' },
  { feature: 'Voice expense logging', free: '—', pro: '✓' },
  { feature: 'Receipt scanning (OCR)', free: '—', pro: '✓' },
  { feature: 'Rate con scanning (AI)', free: '—', pro: '✓' },
  { feature: 'AI weekly business report', free: '—', pro: '✓' },
  { feature: 'AI lane advice', free: '—', pro: '✓' },
  { feature: 'AI tax tips', free: '—', pro: '✓' },
  { feature: 'Driver scorecard', free: '—', pro: '✓' },
  { feature: 'Weekly closeout', free: '—', pro: '✓' },
  { feature: 'Score a load before you take it', free: '—', pro: '✓' },
  { feature: 'Best/worst lanes & broker reliability', free: '—', pro: '✓' },
  { feature: 'Money-slip alerts (lane, broker, margin)', free: '—', pro: '✓' },
  { feature: 'Start-of-week recap (repeat / avoid / watch)', free: '—', pro: '✓' },
  { feature: 'Real-time Parking Finder', free: '—', pro: '✓' },
  { feature: 'Driver points & leaderboard', free: '—', pro: '✓' },
  { feature: 'Parking log export (CSV + PDF)', free: '—', pro: '✓' },
  { feature: 'Driver-to-driver referral submissions', free: 'View referral history only', pro: 'Included' },
  { feature: 'CSV exports', free: '✓', pro: '✓' },
  { feature: 'PDF reports', free: '—', pro: '✓' },
  { feature: 'View contracts sent by recruiters', free: '✓', pro: '✓' },
  { feature: 'Basic AI contract risk flags', free: '✓', pro: '✓' },
  { feature: 'Approve, reject, or request changes', free: '✓', pro: '✓' },
  { feature: 'Record approval / in-app signature', free: '✓', pro: '✓' },
  { feature: 'Plain-English Clause Rewrite', free: '—', pro: '✓ Included' },
  { feature: 'Contract history, downloads, version comparison, AI follow-ups', free: '—', pro: 'Coming soon — not included today' },
  { feature: 'View finalized settlement statements issued to you', free: '✓', pro: '✓' },
  { feature: 'Basic settlement reconciliation (confirm / clear load match)', free: '✓', pro: '✓' },
  { feature: 'Advanced reconciliation (refresh / reject suggested matches)', free: '—', pro: '✓' },
  { feature: 'Manual outside-settlement records', free: '—', pro: '✓' },
  { feature: 'Settlement payment processing by HaulTrackerPro', free: 'Not offered — recordkeeping only', pro: 'Not offered — recordkeeping only' },
];


const whyProPoints = [
  { icon: Shield, title: 'Protect Your Money Before It Slips', desc: 'Score a load before you take it. Get warned when a lane weakens, a broker pays slow, or your margin starts drifting — based on your own history.' },
  { icon: Target, title: 'Know Where You Make & Lose Money', desc: 'See your best lanes, weakest lanes, broker reliability, and margin leaks — surfaced automatically from the loads you already log.' },
  { icon: Zap, title: 'Stop Doing The Data Entry', desc: 'Speak an expense, snap a receipt, or upload a rate con — AI fills in the rest so you can stay focused on driving.' },
  { icon: TrendingUp, title: 'Close Your Week Like A Business', desc: 'Weekly closeout, AI summary, dollar-impact alerts, and a start-of-week recap of last week — so this week starts with a plan.' },
];

// ---------------------------------------------------------------------------
// Recruiter plan data
// ---------------------------------------------------------------------------

const recruiterStandardBullets = [
  '1 active opportunity at a time',
  'Unlimited drafts',
  'Standard marketplace placement',
  'Basic applicant and contact-request flow',
  'Opportunity management: edit, pause, and close listings',
  'Verified Recruiter badge shown only after separate badge approval',
  'Carrier settlement issuance is not included — it requires a paid recruiter plan',
];

const recruiterPaidPlans: Array<{
  name: string;
  price: string;
  limit: string;
  highlight?: boolean;
  previewOnly?: boolean;
  availableBullets: string[];
  comingSoonBullets?: string[];
}> = [
  {
    name: 'Starter',
    price: '$19',
    limit: 'Up to 5 active opportunities',
    availableBullets: [
      'Everything in Recruiter Standard',
      'Up to 5 active opportunities at a time',
      'Unlimited drafts',
      
      'Applicant status history',
      'Basic referral tracking view',
      'Carrier↔driver relationship invitations and carrier settlement issuance (recordkeeping only)',
    ],
  },
  {
    name: 'Growth',
    price: '$49',
    limit: 'Up to 15 active opportunities',
    highlight: true,
    availableBullets: [
      'Everything in Starter',
      'Up to 15 active opportunities at a time',
      'Unlimited drafts',
      'Priority-placement eligibility',
      'Featured-listing eligibility',
      'Recruiter reports (PDF + CSV)',
      'Recruiter contract-management dashboard / contract upload-management interface',
      'AI-assisted contract risk review',
      'Full referral progress tracking',
      'Pipeline analytics',
      'Opportunity performance insights',
    ],
  },
  {
    name: 'Fleet',
    price: '$149',
    limit: 'Up to 25 active opportunities — preview only',
    previewOnly: true,
    availableBullets: [
      'Everything in Growth',
      'Up to 25 active opportunities at a time for existing Fleet access',
      'Unlimited drafts',
      'New standalone Fleet subscriptions are not available yet',
      'Top-placement eligibility',
      'Priority support',
    ],
    comingSoonBullets: [
      'Team seats',
      'Bulk opportunity tools',
      'Custom recruiter profile',
      'Company-level hiring dashboard',
    ],
  },
];



// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Pricing() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(false);

  const audience = useMemo(
    () => resolveAudience(location.search, location.hash),
    [location.search, location.hash],
  );

  const handleUpgrade = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setLoading(true);
    try {
      const planKey = annual ? 'pro_yearly' : 'pro_monthly';
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { planKey },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        const value = annual ? 179.88 : 19.99;
        trackBeginCheckout(planKey, value);
        window.location.href = data.url;
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  const selectAudience = (next: Audience) => {
    navigate(`/pricing?audience=${next}`);
  };

  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="Pricing — Trucker Profit Tracker, Recruiter Tools & Back-Office Agency Software | HaulTrackerPro"
        description="HaulTrackerPro pricing built around how you work — driver profit tracking (Free and Pro at $19.99/mo), recruiter opportunity and contract tools with free standard posting, and back-office assistant plus agency workspace plans."
        path="/pricing"
        jsonLd={buildBreadcrumbSchema([
          { name: 'Home', path: '/' },
          { name: 'Pricing', path: '/pricing' },
        ])}
      />
      <MarketingHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%)',
          }}
        />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-8 text-center relative">
          <p
            className="text-xs sm:text-sm font-bold uppercase tracking-wider mb-3"
            style={{ color: 'hsl(25, 95%, 60%)' }}
          >
            One platform. Three ways to use it.
          </p>
          <h1
            className="text-3xl sm:text-5xl font-black tracking-tight"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Pricing built around{' '}
            <span style={{ color: 'hsl(25, 95%, 53%)' }}>how you work.</span>
          </h1>
          <p
            className="mt-4 text-base sm:text-lg max-w-2xl mx-auto"
            style={{ color: 'hsl(220, 10%, 60%)' }}
          >
            Whether you're a driver tracking your own trucking business, a
            recruiter or carrier posting opportunities and managing hiring, or a
            back-office assistant or agency supporting drivers — pick the view
            that matches you.
          </p>
        </div>
      </section>

      {/* Audience selector */}
      <div className="flex justify-center px-4 pb-10">
        <div
          role="tablist"
          aria-label="Choose pricing audience"
          className="inline-flex flex-col sm:flex-row items-stretch gap-2 p-2 rounded-2xl border w-full max-w-3xl"
          style={{ background: 'hsl(220, 20%, 12%)', borderColor: 'hsl(220, 16%, 20%)' }}
        >
          {AUDIENCES.map((a) => {
            const active = a === audience;
            const Icon = a === 'driver' ? Truck : a === 'recruiter' ? Users : Briefcase;
            return (
              <button
                key={a}
                role="tab"
                type="button"
                aria-selected={active}
                aria-label={AUDIENCE_LABEL[a]}
                onClick={() => selectAudience(a)}
                className="flex-1 rounded-xl px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                style={{
                  background: active ? 'hsl(25, 95%, 53%)' : 'transparent',
                  color: active ? 'hsl(0, 0%, 100%)' : 'hsl(220, 10%, 75%)',
                }}
              >
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Icon className="h-4 w-4" />
                  {AUDIENCE_LABEL[a]}
                </div>
                <div
                  className="text-xs mt-1 leading-snug"
                  style={{
                    color: active ? 'hsl(0, 0%, 100%, 0.85)' : 'hsl(220, 10%, 55%)',
                  }}
                >
                  {AUDIENCE_DESCRIPTION[a]}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {audience === 'driver' && (
        <DriverView
          annual={annual}
          setAnnual={setAnnual}
          loading={loading}
          onUpgrade={handleUpgrade}
          onAuth={() => navigate('/auth')}
          onStarterKit={() => {
            trackStarterKitCTAClicked('pricing');
            navigate('/starter-kit');
          }}
        />
      )}

      {audience === 'recruiter' && (
        <RecruiterView
          onWorkspace={() =>
            navigate(user ? '/dashboard?page=recruiter-access' : '/auth?intent=recruiter')
          }
          workspaceLabel={user ? 'Open Recruiter Workspace' : 'Add Recruiter Workspace'}
        />
      )}

      {audience === 'agency' && <AgencyView navigate={navigate} />}

      {/* Shared Resource Hub CTA */}
      <section className="py-8" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-sm" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Not sure which tools you need?{' '}
            <button
              onClick={() => navigate('/resources')}
              className="font-semibold hover:underline"
              style={{ color: 'hsl(25, 95%, 60%)' }}
            >
              Explore trucking resources →
            </button>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="border-t py-8"
        style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" style={{ color: 'hsl(220, 10%, 40%)' }} />
            <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>
              © {new Date().getFullYear()} HaulTrackerPro. All rights reserved.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {[
              { label: 'Features', href: '/features' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'Resources', href: '/resources' },
              { label: 'About', href: '/about' },
              { label: 'Terms', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
              { label: 'FAQ', href: '/faq' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs font-medium hover:underline"
                style={{ color: 'hsl(220, 10%, 50%)' }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver view
// ---------------------------------------------------------------------------

function DriverView({
  annual,
  setAnnual,
  loading,
  onUpgrade,
  onAuth,
  onStarterKit,
}: {
  annual: boolean;
  setAnnual: (v: boolean) => void;
  loading: boolean;
  onUpgrade: () => void;
  onAuth: () => void;
  onStarterKit: () => void;
}) {
  return (
    <div data-testid="pricing-driver-view">
      {/* Billing Toggle — driver only */}
      <div className="flex justify-center mb-8">
        <div
          className="inline-flex items-center gap-3 p-1 rounded-xl"
          style={{ background: 'hsl(220, 20%, 12%)' }}
          data-testid="driver-billing-toggle"
        >
          <button
            type="button"
            onClick={() => setAnnual(false)}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              background: !annual ? 'hsl(25, 95%, 53%)' : 'transparent',
              color: !annual ? 'hsl(0, 0%, 100%)' : 'hsl(220, 10%, 55%)',
            }}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              background: annual ? 'hsl(25, 95%, 53%)' : 'transparent',
              color: annual ? 'hsl(0, 0%, 100%)' : 'hsl(220, 10%, 55%)',
            }}
          >
            Annual <span className="ml-1 text-xs opacity-80">Save $60/yr</span>
          </button>
        </div>
      </div>

      {/* Driver plans */}
      <section id="driver-plans" className="max-w-4xl mx-auto px-4 sm:px-6 pb-16 scroll-mt-24">
        <div className="grid sm:grid-cols-2 gap-6">
          {/* Free */}
          <div
            className="p-6 sm:p-8 rounded-2xl border flex flex-col"
            style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}
          >
            <h3 className="text-lg font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Free
            </h3>
            <p className="text-sm mb-6" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Everything you need to start tracking
            </p>
            <div className="mb-6">
              <span className="text-4xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                $0
              </span>
              <span className="text-sm ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>
                /month
              </span>
            </div>
            <Button
              onClick={onAuth}
              variant="outline"
              className="w-full rounded-xl font-bold mb-6"
              style={{
                borderColor: 'hsl(220, 16%, 22%)',
                color: 'hsl(220, 10%, 70%)',
                background: 'transparent',
              }}
            >
              Start Tracking Free
            </Button>
            <ul className="space-y-3">
              {freeFeatures.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2.5 text-sm"
                  style={{ color: 'hsl(220, 10%, 70%)' }}
                >
                  <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(152, 60%, 42%)' }} />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro */}
          <div
            className="p-6 sm:p-8 rounded-2xl border relative flex flex-col"
            style={{
              background: 'hsl(220, 20%, 10%)',
              borderColor: 'hsl(25, 95%, 53%)',
              boxShadow:
                '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)',
            }}
          >
            <div
              className="absolute -top-3 right-6 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}
            >
              MOST POPULAR
            </div>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Pro
            </h3>
            <p className="text-sm mb-6" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Advanced insights for serious drivers
            </p>
            <div className="mb-6">
              <span className="text-4xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                ${annual ? '14.99' : '19.99'}
              </span>
              <span className="text-sm ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>
                /month
              </span>
              {annual && (
                <span className="block text-xs mt-1" style={{ color: 'hsl(25, 95%, 60%)' }}>
                  $179.88/year — save $60
                </span>
              )}
            </div>
            <Button
              onClick={onUpgrade}
              disabled={loading}
              className="w-full rounded-xl font-bold mb-6 gap-2"
              style={{
                background: 'hsl(25, 95%, 53%)',
                color: 'hsl(0, 0%, 100%)',
                boxShadow: '0 4px 20px -4px hsl(25, 95%, 53%, 0.5)',
              }}
            >
              {loading ? 'Loading...' : 'Upgrade to Pro'} {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
            <p className="text-xs mb-4 font-semibold" style={{ color: 'hsl(25, 95%, 60%)' }}>
              Everything in Free, plus:
            </p>
            <ul className="space-y-3">
              {proKeyBenefits.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2.5 text-sm"
                  style={{ color: 'hsl(220, 10%, 70%)' }}
                >
                  <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(25, 95%, 53%)' }} />
                  {f}
                </li>
              ))}
            </ul>
            <details
              className="mt-4 group rounded-lg border"
              style={{ borderColor: 'hsl(220, 16%, 18%)', background: 'hsl(220, 20%, 8%)' }}
              data-testid="driver-pro-details"
            >
              <summary
                className="cursor-pointer select-none px-3 py-2 text-xs font-bold uppercase tracking-wider"
                style={{ color: 'hsl(25, 95%, 60%)' }}
              >
                View all Pro features
              </summary>
              <ul className="space-y-2.5 px-3 py-3">
                {proAdditionalBenefits.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2.5 text-sm"
                    style={{ color: 'hsl(220, 10%, 70%)' }}
                  >
                    <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(25, 95%, 53%)' }} />
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </section>

      {/* Why Go Pro — driver only */}
      <section className="py-16 sm:py-24" style={{ background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2
            className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-12"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Why Go <span style={{ color: 'hsl(25, 95%, 53%)' }}>Pro?</span>
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {whyProPoints.map((p, i) => (
              <div
                key={i}
                className="flex gap-4 p-5 rounded-xl border"
                style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}
              >
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}
                >
                  <p.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>
                    {p.title}
                  </h3>
                  <p className="text-sm" style={{ color: 'hsl(220, 10%, 55%)' }}>
                    {p.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison disclosure — driver only */}
      <section className="py-12 sm:py-16" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <details
            className="rounded-2xl border overflow-hidden"
            style={{ borderColor: 'hsl(220, 16%, 16%)', background: 'hsl(220, 20%, 10%)' }}
            data-testid="driver-comparison-details"
          >
            <summary
              className="cursor-pointer select-none px-5 py-4 text-sm font-bold flex items-center gap-2"
              style={{ color: 'hsl(0, 0%, 100%)' }}
            >
              <BarChart3 className="h-4 w-4" style={{ color: 'hsl(25, 95%, 53%)' }} />
              View full Driver Free vs Pro comparison
            </summary>
            <div className="px-2 sm:px-5 pb-5">
              <p
                className="text-xs mb-4 max-w-2xl mx-auto text-center"
                style={{ color: 'hsl(220, 10%, 50%)' }}
              >
                Contract Protection (view, AI risk flags, decisions, and signature record) is
                available on every driver plan. Driver Pro adds the Plain-English Clause Rewrite
                tool. Additional tools like contract history, downloadable records, version
                comparison, and AI follow-ups are planned future Pro additions.
              </p>
              <div
                data-testid="driver-comparison-scroll"
                className="overflow-x-auto -mx-2 sm:mx-0"
              >
                <div
                  className="rounded-xl border overflow-hidden min-w-[640px]"
                  style={{ borderColor: 'hsl(220, 16%, 16%)' }}
                >
                <div
                  className="grid grid-cols-3 text-sm font-bold"
                  style={{ background: 'hsl(220, 20%, 12%)' }}
                >
                  <div className="p-4" style={{ color: 'hsl(220, 10%, 55%)' }}>
                    Feature
                  </div>
                  <div className="p-4 text-center" style={{ color: 'hsl(220, 10%, 70%)' }}>
                    Free
                  </div>
                  <div className="p-4 text-center" style={{ color: 'hsl(25, 95%, 53%)' }}>
                    Pro
                  </div>
                </div>
                {comparisonRows.map((row, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-3 text-sm border-t"
                    style={{ borderColor: 'hsl(220, 16%, 14%)' }}
                  >
                    <div className="p-4" style={{ color: 'hsl(220, 10%, 70%)' }}>
                      {row.feature}
                    </div>
                    <div
                      className="p-4 text-center"
                      style={{
                        color: row.free === '—' ? 'hsl(220, 10%, 30%)' : 'hsl(220, 10%, 60%)',
                      }}
                    >
                      {row.free === '✓' ? (
                        <Check className="h-4 w-4 mx-auto" style={{ color: 'hsl(152, 60%, 42%)' }} />
                      ) : row.free === '—' ? (
                        <Minus className="h-4 w-4 mx-auto" />
                      ) : (
                        row.free
                      )}
                    </div>
                    <div
                      className="p-4 text-center font-medium"
                      style={{
                        color: 'hsl(25, 95%, 60%)',
                        background: 'hsl(25, 95%, 53%, 0.04)',
                      }}
                    >
                      {row.pro === '✓' ? (
                        <Check className="h-4 w-4 mx-auto" style={{ color: 'hsl(25, 95%, 53%)' }} />
                      ) : (
                        row.pro
                      )}
                    </div>
                  </div>
                ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* Free Trucker Starter Kit CTA — driver only */}
      <section className="py-8" style={{ background: 'hsl(220, 20%, 8%)' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <button
            onClick={onStarterKit}
            className="w-full text-center text-sm py-3 px-4 rounded-lg border hover:bg-white/5 transition"
            style={{ borderColor: 'hsl(220, 16%, 16%)', color: 'hsl(220, 10%, 70%)' }}
          >
            Not ready to sign up?{' '}
            <span style={{ color: 'hsl(25, 95%, 60%)' }} className="font-semibold">
              Grab the Free Trucker Starter Kit →
            </span>
          </button>
        </div>
      </section>

      {/* Driver final CTA */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 50%, hsl(25, 95%, 53%, 0.06) 0%, transparent 70%)',
          }}
        />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center relative">
          <h2
            className="text-3xl sm:text-4xl font-black tracking-tight mb-5"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Ready to run your trucking business with clearer numbers?
          </h2>
          <p
            className="text-base mb-8 max-w-md mx-auto"
            style={{ color: 'hsl(220, 10%, 55%)' }}
          >
            Start free with unlimited load and expense tracking. Upgrade to Pro any time to
            unlock AI automation and advanced insights.
          </p>
          <Button
            onClick={onAuth}
            size="lg"
            className="text-base font-bold rounded-xl h-13 px-10 gap-2"
            style={{
              background: 'hsl(25, 95%, 53%)',
              color: 'hsl(0, 0%, 100%)',
              boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.5)',
            }}
          >
            Start Tracking Free <ArrowRight className="h-5 w-5" />
          </Button>
          <div className="pt-6 flex flex-wrap justify-center gap-2">
            <a
              href="/haultrackerpro-vs-spreadsheets"
              className="text-xs font-medium underline"
              style={{ color: 'hsl(220, 10%, 60%)' }}
            >
              Compare vs Spreadsheets
            </a>
            <span style={{ color: 'hsl(220, 10%, 30%)' }}>·</span>
            <a
              href="/haultrackerpro-vs-quickbooks"
              className="text-xs font-medium underline"
              style={{ color: 'hsl(220, 10%, 60%)' }}
            >
              Compare vs QuickBooks
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recruiter view
// ---------------------------------------------------------------------------

function RecruiterView({
  onWorkspace,
  workspaceLabel,
}: {
  onWorkspace: () => void;
  workspaceLabel: string;
}) {
  return (
    <section
      id="for-recruiters"
      data-testid="pricing-recruiter-view"
      className="py-8 sm:py-12 scroll-mt-24"
      style={{ background: 'hsl(220, 20%, 6%)' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
            style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: 'hsl(25, 95%, 60%)' }}
          >
            For Recruiters &amp; Carriers
          </div>
          <h2
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Recruiter &amp; Carrier Plans
          </h2>
          <p
            className="mt-3 text-sm sm:text-base max-w-2xl mx-auto"
            style={{ color: 'hsl(220, 10%, 60%)' }}
          >
            Complete, active recruiter workspaces post standard opportunities for free — one
            active opportunity at a time — once required recruiter profile fields are filled in
            and posting terms are accepted. Paid plans raise the active-opportunity limit and add
            premium visibility, recruiter reports, contract-management with AI-assisted risk
            review, and pipeline analytics on top. The Verified Recruiter badge shown on driver
            listings is a separate trust-display review.

          </p>
        </div>

        {/* Recruiter Standard — foundational free callout */}
        <div
          className="p-6 sm:p-8 rounded-2xl border mb-10"
          style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 20%)' }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
            <div>
              <h3 className="text-xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                Recruiter Standard
              </h3>
              <p className="text-xs mt-1" style={{ color: 'hsl(220, 10%, 55%)' }}>
                For complete, active recruiter profiles
              </p>
            </div>
            <div>
              <span className="text-3xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                Free
              </span>
              <span className="text-xs ml-2" style={{ color: 'hsl(220, 10%, 55%)' }}>
                1 active opportunity
              </span>
            </div>
          </div>
          <p
            className="text-[10px] font-bold uppercase tracking-wider mb-3 mt-4"
            style={{ color: 'hsl(152, 60%, 52%)' }}
          >
            Available Now
          </p>
          <ul className="grid sm:grid-cols-2 gap-2">
            {recruiterStandardBullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2 text-sm"
                style={{ color: 'hsl(220, 10%, 75%)' }}
              >
                <Check
                  className="h-4 w-4 mt-0.5 shrink-0"
                  style={{ color: 'hsl(152, 60%, 42%)' }}
                />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Paid recruiter cards */}
        <div data-testid="recruiter-paid-grid" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {recruiterPaidPlans.map((p) => (
            <div
              key={p.name}
              className="p-6 rounded-2xl border relative flex flex-col"
              style={{
                background: 'hsl(220, 20%, 10%)',
                borderColor: p.highlight ? 'hsl(25, 95%, 53%)' : 'hsl(220, 16%, 16%)',
                boxShadow: p.highlight
                  ? '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)'
                  : undefined,
              }}
            >
              {p.highlight && (
                <div
                  className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[10px] font-bold"
                  style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}
                >
                  MOST POPULAR
                </div>
              )}
              {p.previewOnly && (
                <div
                  data-testid={`recruiter-plan-preview-only-${p.name.toLowerCase()}`}
                  className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[10px] font-bold"
                  style={{ background: 'hsl(220, 16%, 24%)', color: 'hsl(0, 0%, 90%)' }}
                >
                  PREVIEW ONLY
                </div>
              )}

              <h3 className="text-base font-bold mb-1" style={{ color: 'hsl(0, 0%, 100%)' }}>
                {p.name}
              </h3>
              <p className="text-xs mb-4" style={{ color: 'hsl(220, 10%, 55%)' }}>
                {p.limit}
              </p>
              <div className="mb-5">
                <span className="text-3xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                  {p.price}
                </span>
                <span className="text-xs ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>
                  /month
                </span>
              </div>
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-2"
                style={{ color: 'hsl(152, 60%, 52%)' }}
              >
                {p.previewOnly ? 'Existing / Included Access' : 'Available Now'}
              </p>

              <ul className="space-y-2.5 mb-5">
                {p.availableBullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-xs"
                    style={{ color: 'hsl(220, 10%, 70%)' }}
                  >
                    <Check
                      className="h-3.5 w-3.5 mt-0.5 shrink-0"
                      style={{ color: 'hsl(25, 95%, 53%)' }}
                    />
                    {b}
                  </li>
                ))}
              </ul>
              {p.comingSoonBullets && p.comingSoonBullets.length > 0 && (
                <>
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider mb-2"
                    style={{ color: 'hsl(220, 10%, 50%)' }}
                  >
                    Coming Soon
                  </p>
                  <ul className="space-y-2.5 mb-2">
                    {p.comingSoonBullets.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-2 text-xs"
                        style={{ color: 'hsl(220, 10%, 50%)' }}
                      >
                        <Check
                          className="h-3.5 w-3.5 mt-0.5 shrink-0"
                          style={{ color: 'hsl(220, 10%, 40%)' }}
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            onClick={onWorkspace}
            size="lg"
            className="text-sm font-bold rounded-xl h-12 px-6 gap-2"
            style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}
          >
            {workspaceLabel} <ArrowRight className="h-4 w-4" />
          </Button>
          <span className="text-xs" style={{ color: 'hsl(220, 10%, 50%)' }}>
            Complete your recruiter profile to unlock standard posting. Upgrade for premium
            recruiting tools.
          </span>
        </div>

        <p
          className="text-[11px] text-center mt-6 max-w-2xl mx-auto"
          style={{ color: 'hsl(220, 10%, 40%)' }}
        >
          Pay figures and Profit Intelligence shown to drivers are estimates based on
          recruiter-provided data — never guaranteed earnings or guaranteed jobs. HaulTrackerPro
          tracks referral progress only. Referral bonuses, if offered, are paid externally by
          the recruiter according to their own terms — HaulTrackerPro does not process or
          guarantee referral payments. Universal driver contract protections (review, approve,
          request changes, reject, optional in-app signature, hired-status protection) do not
          depend on a paid recruiter plan. Contract-management tools are designed to make the
          recruiter–driver workflow clearer — they are not legal advice.
        </p>

        {/* Recruiter final CTA */}
        <div
          className="mt-16 py-14 px-6 rounded-2xl text-center"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 50%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%), hsl(220, 20%, 10%)',
            border: '1px solid hsl(220, 16%, 20%)',
          }}
        >
          <h2
            className="text-2xl sm:text-3xl font-black tracking-tight mb-4"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Ready to post opportunities and manage hiring in one workspace?
          </h2>
          <p
            className="text-sm mb-6 max-w-lg mx-auto"
            style={{ color: 'hsl(220, 10%, 60%)' }}
          >
            Standard posting is free for complete, active recruiter profiles. Add a paid plan
            whenever you want premium visibility, reports, and AI-assisted contract review.
          </p>
          <Button
            onClick={onWorkspace}
            size="lg"
            className="text-base font-bold rounded-xl h-12 px-8 gap-2"
            style={{
              background: 'hsl(25, 95%, 53%)',
              color: 'hsl(0, 0%, 100%)',
              boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.5)',
            }}
          >
            {workspaceLabel} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Back-office (agency) view
// ---------------------------------------------------------------------------

function AgencyView({ navigate }: { navigate: (path: string) => void }) {
  const assistant = ASSISTANT_AGENCY_PLANS.assistant_free;
  const agencyPlans = ALL_AGENCY_PLAN_KEYS.map((k) => ASSISTANT_AGENCY_PLANS[k]);

  return (
    <section
      id="assistants-agencies"
      data-testid="pricing-agency-view"
      className="py-8 sm:py-12 scroll-mt-24"
      style={{ background: 'hsl(220, 20%, 8%)' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-3"
            style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: 'hsl(25, 95%, 60%)' }}
          >
            Driver Assistants &amp; Back-Office Agencies
          </div>
          <h2
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Back-Office Business Plans
          </h2>
          <p
            className="mt-3 text-sm sm:text-base max-w-2xl mx-auto"
            style={{ color: 'hsl(220, 10%, 60%)' }}
          >
            Helping a driver through an approved invitation is free. Paid Agency Workspace plans
            are for managing clients, team members, service packages, requests, and shared work.
          </p>
        </div>

        {/* Assistant — compact free callout */}
        <div
          className="mb-10 p-5 sm:p-6 rounded-2xl border"
          style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h3 className="text-lg font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
              {assistant.label}
            </h3>
            <div>
              <span className="text-2xl font-black" style={{ color: 'hsl(0, 0%, 100%)' }}>
                Free
              </span>
              <span className="text-xs ml-2" style={{ color: 'hsl(220, 10%, 55%)' }}>
                no software fee
              </span>
            </div>
          </div>
          <p className="text-sm mb-3" style={{ color: 'hsl(220, 10%, 65%)' }}>
            {assistant.tagline}
          </p>
          <ul className="grid sm:grid-cols-2 gap-2 mb-3">
            {assistant.publicBullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2 text-sm"
                style={{ color: 'hsl(220, 10%, 75%)' }}
              >
                <Check
                  className="h-4 w-4 mt-0.5 shrink-0"
                  style={{ color: 'hsl(152, 60%, 42%)' }}
                />
                {b}
              </li>
            ))}
          </ul>
          <p className="text-xs mb-3" style={{ color: 'hsl(220, 10%, 50%)' }}>
            {assistant.limitationsCopy}
          </p>
          <Button
            onClick={() => navigate('/auth?next=%2Fassistant')}
            variant="outline"
            className="rounded-xl font-bold gap-2"
            style={{
              borderColor: 'hsl(25, 95%, 53%)',
              color: 'hsl(25, 95%, 60%)',
              background: 'transparent',
            }}
          >
            Become a Driver Assistant <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Agency Workspace subheading */}
        <div className="mb-6">
          <h3
            className="text-xl sm:text-2xl font-black tracking-tight"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Agency Workspace
          </h3>
          <p className="text-sm mt-2" style={{ color: 'hsl(220, 10%, 60%)' }}>
            Multi-client back-office plans. Software access only — HaulTracker Pro does not
            process service payments.
          </p>
        </div>

        {/* Agency plan cards */}
        <div data-testid="agency-paid-grid" className="grid sm:grid-cols-3 gap-5">
          {agencyPlans.map((p, i) => {
            const highlight = i === 1; // Team is the recommended middle tier
            return (
              <div
                key={p.key}
                className="p-6 rounded-2xl border relative flex flex-col"
                style={{
                  background: 'hsl(220, 20%, 10%)',
                  borderColor: highlight ? 'hsl(25, 95%, 53%)' : 'hsl(220, 16%, 16%)',
                  boxShadow: highlight
                    ? '0 0 30px -8px hsl(25, 95%, 53%, 0.2), 0 0 0 1px hsl(25, 95%, 53%, 0.15)'
                    : undefined,
                }}
              >
                {highlight && (
                  <div
                    className="absolute -top-3 right-6 px-3 py-1 rounded-full text-[10px] font-bold"
                    style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}
                  >
                    MOST POPULAR
                  </div>
                )}
                <h3
                  className="text-base font-bold mb-1"
                  style={{ color: 'hsl(0, 0%, 100%)' }}
                >
                  {p.label}
                </h3>
                <p className="text-xs mb-4" style={{ color: 'hsl(220, 10%, 55%)' }}>
                  {p.tagline}
                </p>
                <div className="mb-4">
                  <span
                    className="text-3xl font-black"
                    style={{ color: 'hsl(0, 0%, 100%)' }}
                  >
                    ${p.monthlyPrice}
                  </span>
                  <span className="text-xs ml-1" style={{ color: 'hsl(220, 10%, 55%)' }}>
                    /month
                  </span>
                </div>
                <ul className="space-y-2.5 mb-4">
                  {p.publicBullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-xs"
                      style={{ color: 'hsl(220, 10%, 70%)' }}
                    >
                      <Check
                        className="h-3.5 w-3.5 mt-0.5 shrink-0"
                        style={{ color: 'hsl(25, 95%, 53%)' }}
                      />
                      {b}
                    </li>
                  ))}
                </ul>
                <p
                  className="text-[11px] mb-4"
                  style={{ color: 'hsl(220, 10%, 45%)' }}
                >
                  {p.limitationsCopy}
                </p>
                {/* Phase 8B: route to /auth then /agency with sanitized ?plan=. */}
                <Button
                  onClick={() =>
                    navigate(`/auth?next=${encodeURIComponent(`/agency?plan=${p.key}`)}`)
                  }
                  variant="outline"
                  className="w-full rounded-xl font-bold gap-2 mt-auto"
                  style={{
                    borderColor: 'hsl(25, 95%, 53%)',
                    color: 'hsl(25, 95%, 60%)',
                    background: 'transparent',
                  }}
                >
                  Choose {p.label} <ArrowRight className="h-4 w-4" />
                </Button>
                <p
                  className="text-[11px] text-center mt-2"
                  style={{ color: 'hsl(220, 10%, 40%)' }}
                >
                  You&rsquo;ll sign in, then Start Agency Billing from your agency dashboard.
                </p>
              </div>
            );
          })}
        </div>

        <div
          className="mt-8 p-5 rounded-2xl border"
          style={{
            background: 'hsl(25, 95%, 53%, 0.06)',
            borderColor: 'hsl(25, 95%, 53%, 0.35)',
          }}
        >
          <h3
            className="text-sm font-black mb-2"
            style={{ color: 'hsl(25, 95%, 60%)' }}
          >
            Payments for assistant &amp; agency services
          </h3>
          <p className="text-sm" style={{ color: 'hsl(220, 10%, 75%)' }}>
            HaulTracker Pro does <b>not</b> currently process payments between drivers and
            assistants or agencies. Service agreements and payments happen outside the platform for now.
            HaulTracker Pro does not guarantee clients, customers, or income for assistants or agencies.
          </p>
          <p className="text-sm mt-2" style={{ color: 'hsl(220, 10%, 75%)' }}>
            {AGENCY_SETTLEMENT_RECORDKEEPING_DISCLAIMER} Settlement statements prepared in an Agency
            Workspace are records shared with an approved driver client — payment still happens
            outside HaulTracker Pro.
          </p>
          <p className="sr-only">{OUTSIDE_PAYMENTS_DISCLAIMER}</p>
        </div>

        {/* Back-office final CTA */}
        <div
          className="mt-16 py-14 px-6 rounded-2xl text-center"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 50%, hsl(25, 95%, 53%, 0.08) 0%, transparent 70%), hsl(220, 20%, 10%)',
            border: '1px solid hsl(220, 16%, 20%)',
          }}
        >
          <h2
            className="text-2xl sm:text-3xl font-black tracking-tight mb-4"
            style={{ color: 'hsl(0, 0%, 100%)' }}
          >
            Support drivers your way.
          </h2>
          <p
            className="text-sm mb-6 max-w-lg mx-auto"
            style={{ color: 'hsl(220, 10%, 60%)' }}
          >
            Help one driver at a time through approved invitations, or spin up a full agency
            workspace to manage multiple clients, packages, and teammates.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={() => navigate('/auth?next=%2Fassistant')}
              variant="outline"
              className="rounded-xl font-bold gap-2"
              style={{
                borderColor: 'hsl(25, 95%, 53%)',
                color: 'hsl(25, 95%, 60%)',
                background: 'transparent',
              }}
            >
              Become a Driver Assistant <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => navigate('/assistants-agencies')}
              className="rounded-xl font-bold gap-2"
              style={{
                background: 'hsl(25, 95%, 53%)',
                color: 'hsl(0, 0%, 100%)',
                boxShadow: '0 4px 24px -4px hsl(25, 95%, 53%, 0.5)',
              }}
            >
              Start an Agency Workspace <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

