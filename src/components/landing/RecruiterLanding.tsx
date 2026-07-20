import {
  ArrowRight,
  Users,
  ShieldCheck,
  ClipboardList,
  Search,
  Handshake,
  BarChart3,
  Share2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

const NAVY = 'hsl(220, 20%, 8%)';
const NAVY_2 = 'hsl(220, 20%, 11%)';
const BORDER = 'hsl(220, 16%, 18%)';
const AMBER = 'hsl(25, 95%, 53%)';
const TEXT = 'hsl(0, 0%, 100%)';
const MUTED = 'hsl(220, 10%, 70%)';

const pains = [
  { icon: AlertTriangle, title: 'Ghost applicants', desc: 'Drivers apply, then vanish. You waste hours chasing leads that were never serious.' },
  { icon: AlertTriangle, title: 'Fake or bait postings everywhere', desc: 'Job boards are flooded with inflated pay claims and unverified carriers. Real recruiters get buried.' },
  { icon: AlertTriangle, title: 'Paying for clicks, not hires', desc: 'Most platforms charge per click or per lead with no skin in the game on quality.' },
];

const features = [
  { icon: ShieldCheck, title: 'Complete recruiter profiles post standard opportunities', desc: 'Any complete, active recruiter profile with current posting terms accepted can post standard opportunities — no admin approval or paid plan required. The Verified Recruiter badge is a separate trust-display review.' },
  { icon: ClipboardList, title: 'Structured opportunity postings', desc: 'Required fields for pay, lanes, equipment, deductions, and home-time create clear, comparable listings.' },
  { icon: Users, title: 'Reach financially serious drivers', desc: 'HaulTrackerPro drivers track real profit, RPM, and deductions. They evaluate opportunities by the numbers.' },
  { icon: Handshake, title: 'In-app applicant pipeline', desc: 'Review interest, manage driver contact requests, and track status from one dashboard — no spreadsheets.' },
  { icon: BarChart3, title: 'Free standard posting', desc: 'Complete, active recruiter workspaces post unlimited standard opportunities at no cost. Upgrade for premium recruiting tools.' },
  { icon: Search, title: 'Recruiter contract-management + AI risk review (Growth & Fleet)', desc: "Growth and Fleet unlock the recruiter contract-management dashboard and AI-assisted risk review. Universal driver protections — review, approve, request changes, reject, optional in-app signature, and the hired-status protection that requires driver approval before hiring — apply to every driver plan." },
  { icon: Share2, title: 'Driver-to-driver referral tracking', desc: 'Drivers can refer other drivers to your opportunities. Track referral progress, set your external referral terms, and see referral analytics. Referral bonuses, if offered, are paid externally by you — HaulTrackerPro does not process referral payments.' },
];

const steps = [
  { n: '1', title: 'Add recruiter workspace and complete required profile fields', desc: 'Add the recruiter workspace to your account and fill in the required recruiter details (company, DOT/MC, address, hiring states, equipment, contact email).' },
  { n: '2', title: 'Accept posting terms and unlock standard posting', desc: 'Once your profile is complete, posting terms are accepted, and your account is active, standard posting is unlocked.' },
  { n: '3', title: 'Post unlimited standard opportunities', desc: 'Fill in lanes, pay structure, equipment, and deductions in a structured form. Post as many standard opportunities as you need.' },
  { n: '4', title: 'Optionally request Verified Recruiter badge review', desc: 'The Verified Recruiter badge shown on driver listings is a separate trust-display review. Pending or rejected badge review does not by itself disable standard posting.' },
  { n: '5', title: 'Manage applicants and add premium tools when needed', desc: 'Drivers who request info show up in your pipeline. Upgrade to Starter, Growth, or Fleet when you want premium visibility, recruiter contract-management with AI risk review, and analytics.' },
];

type RecruiterPlanCard = {
  name: string;
  price: string;
  limit: string;
  availableBullets: string[];
  comingSoonBullets?: string[];
  highlight?: boolean;
};

const plans: RecruiterPlanCard[] = [
  {
    name: 'Recruiter Standard',
    price: '$0',
    limit: 'Unlimited standard posts',
    availableBullets: [
      'Unlimited standard opportunity posts',
      'Standard marketplace placement',
      'Basic applicant and contact-request flow',
      'Opportunity management: edit, pause, and close listings',
      'Verified Recruiter badge shown only after separate badge approval',
    ],
  },
  {
    name: 'Starter',
    price: '$19',
    limit: 'Premium tools',
    availableBullets: [
      'Everything in Recruiter Standard',
      'Enhanced applicant tracking',
      'Applicant status history',
      'Basic referral tracking view',
    ],
  },
  {
    name: 'Growth',
    price: '$49',
    limit: 'Premium tools',
    highlight: true,
    availableBullets: [
      'Everything in Starter',
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
    limit: 'Premium tools',
    availableBullets: [
      'Everything in Growth',
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

const trustPoints = [
  { icon: ShieldCheck, title: 'Complete recruiter profile required to post', desc: 'Only complete, active recruiter profiles with current posting terms accepted can post standard opportunities — no admin approval or paid plan required.' },
  { icon: CheckCircle2, title: 'Verified Recruiter badge review (separate)', desc: 'HaulTrackerPro reviews eligible recruiter profiles for the Verified Recruiter badge on driver listings. Pending or rejected badge review does not by itself disable standard posting.' },
  { icon: ClipboardList, title: 'Structured opportunity posts', desc: 'Required fields for pay, lanes, equipment, and home-time keep listings clear and comparable. Platform opportunity moderation still applies.' },
  { icon: Handshake, title: 'Driver contact permission workflow', desc: 'Drivers opt in to share contact info — no scraping, no off-platform solicitation.' },
  { icon: Share2, title: 'Referral progress tracking', desc: 'Track driver-to-driver referrals end to end. Referral bonuses, if offered, are paid externally by recruiters — Haul Tracker Pro tracks progress only and does not process, verify, or guarantee payments.' },
];

const faqs = [
  { q: 'How do I unlock standard recruiter posting?', a: 'Add the recruiter workspace to your account, complete the required recruiter profile, and accept the current posting terms. Once your account is active and not suspended, standard posting is unlocked — no admin approval and no paid plan required.' },
  { q: 'What about the Verified Recruiter badge?', a: 'The Verified Recruiter badge is a separate trust-display process. HaulTrackerPro reviews eligible recruiter profiles for the badge shown on driver listings. Pending or rejected badge review does not by itself disable your standard posting.' },
  { q: 'What counts as a "hire" for billing?', a: 'You pay for premium recruiting tools, not per hire. There is no per-hire fee or success fee on any plan.' },
  { q: 'What is your refund policy?', a: 'We refund pro-rated billing periods only when caused by a platform fault. Standard cancellations stop renewal at the end of the current period.' },
  { q: 'Can I post multiple lanes in one opportunity?', a: 'Yes. Each opportunity supports multiple hiring states and equipment types. Use separate postings when pay or deductions differ significantly.' },
  { q: 'Do drivers see my direct contact info?', a: 'Only after a driver opts in by requesting more information on your opportunity. Driver-initiated contact only — no scraping or off-platform solicitation is allowed.' },
  { q: 'Can drivers refer other drivers to my opportunity?', a: 'Yes. Drivers can refer another driver to your opportunity. You see each referral in your pipeline and can mark it contacted, interviewed, hired, closed, or marked paid externally. HaulTrackerPro tracks referral progress only — referral bonuses, if offered, are paid externally by you according to your own terms.' },
  { q: 'Does HaulTrackerPro pay referral bonuses?', a: 'No. HaulTrackerPro does not process, hold, or guarantee referral payments. You set your external referral terms, and you pay any bonus directly to the referring driver outside the platform.' },
  { q: 'Can I post before paying?', a: 'Yes. Complete, active recruiter workspaces can post unlimited standard opportunities at no cost. Paid plans unlock premium tools like priority placement, featured listings, and recruiter contract-management with AI risk review. You can cancel anytime from Recruiter Settings → Billing.' },
];

export default function RecruiterLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const goRecruiterAccess = () => {
    if (user) navigate('/dashboard?page=recruiter-access');
    else navigate('/auth?intent=recruiter');
  };

  return (
    <div>
      {/* HERO */}
      <section className="px-4 sm:px-6 py-12 sm:py-20" style={{ background: NAVY }}>
        <div className="max-w-5xl mx-auto text-center space-y-6">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: AMBER }}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Complete recruiter profile required — no admin approval or paid plan for standard posting
          </div>
          <h1
            className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight"
            style={{ color: TEXT }}
          >
            Hire qualified drivers — faster.
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto" style={{ color: MUTED }}>
            HaulTrackerPro connects recruiters with financially serious owner-operators and
            lease drivers. Structured postings, in-app pipeline, contract-management with AI risk
            review on Growth & Fleet — all in one place.
            <span className="block mt-2 text-xs">
              Driver?{' '}
              <button
                onClick={() => navigate('/?for=driver')}
                className="underline hover:no-underline"
                style={{ color: AMBER }}
              >
                Switch to the driver view
              </button>
            </span>
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button
              onClick={goRecruiterAccess}
              className="text-base font-bold rounded-xl px-6 py-6"
              style={{ background: AMBER, color: TEXT }}
            >
              {user ? 'Open Recruiter Workspace' : 'Add Recruiter Workspace'}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-base font-bold rounded-xl px-6 py-6"
              style={{ borderColor: BORDER, color: TEXT, background: 'transparent' }}
            >
              See How It Works
            </Button>
          </div>
          <div className="flex flex-wrap justify-center gap-4 pt-4 text-xs" style={{ color: MUTED }}>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" style={{ color: AMBER }} /> No admin approval to post
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" style={{ color: AMBER }} /> Flat monthly pricing
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" style={{ color: AMBER }} /> Driver contract protections
            </span>
          </div>
        </div>
      </section>

      {/* PAIN */}
      <section className="px-4 sm:px-6 py-12 sm:py-16" style={{ background: NAVY_2 }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-10" style={{ color: TEXT }}>
            What's broken about driver recruiting today
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {pains.map((p) => (
              <div
                key={p.title}
                className="p-5 rounded-2xl border"
                style={{ background: NAVY, borderColor: BORDER }}
              >
                <p.icon className="h-6 w-6 mb-3" style={{ color: AMBER }} />
                <h3 className="text-base font-bold mb-2" style={{ color: TEXT }}>
                  {p.title}
                </h3>
                <p className="text-sm" style={{ color: MUTED }}>
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="px-4 sm:px-6 py-12 sm:py-16" style={{ background: NAVY }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-10" style={{ color: TEXT }}>
            How HaulTrackerPro solves it
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="p-5 rounded-2xl border"
                style={{ background: NAVY_2, borderColor: BORDER }}
              >
                <f.icon className="h-6 w-6 mb-3" style={{ color: AMBER }} />
                <h3 className="text-base font-bold mb-2" style={{ color: TEXT }}>
                  {f.title}
                </h3>
                <p className="text-sm" style={{ color: MUTED }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="px-4 sm:px-6 py-12 sm:py-16" style={{ background: NAVY_2 }}>
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-10" style={{ color: TEXT }}>
            How it works
          </h2>
          <div className="space-y-4">
            {steps.map((s) => (
              <div
                key={s.n}
                className="flex gap-4 p-5 rounded-2xl border"
                style={{ background: NAVY, borderColor: BORDER }}
              >
                <div
                  className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center font-black"
                  style={{ background: AMBER, color: TEXT }}
                >
                  {s.n}
                </div>
                <div>
                  <h3 className="text-base font-bold mb-1" style={{ color: TEXT }}>
                    {s.title}
                  </h3>
                  <p className="text-sm" style={{ color: MUTED }}>
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="px-4 sm:px-6 py-12 sm:py-16" style={{ background: NAVY }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-2" style={{ color: TEXT }}>
            Recruiter plans
          </h2>
          <p className="text-center text-sm mb-10" style={{ color: MUTED }}>
            Complete, active recruiter workspaces post unlimited standard opportunities. Upgrade for premium tools.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p) => (
              <div
                key={p.name}
                className="p-6 rounded-2xl border flex flex-col"
                style={{
                  background: p.highlight ? 'hsl(25, 95%, 53%, 0.08)' : NAVY_2,
                  borderColor: p.highlight ? AMBER : BORDER,
                }}
              >
                {p.highlight && (
                  <span
                    className="self-start px-2 py-0.5 rounded-full text-[10px] font-bold mb-2"
                    style={{ background: AMBER, color: TEXT }}
                  >
                    MOST POPULAR
                  </span>
                )}
                <h3 className="text-xl font-black" style={{ color: TEXT }}>
                  {p.name}
                </h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-black" style={{ color: TEXT }}>
                    {p.price}
                  </span>
                  <span className="text-sm" style={{ color: MUTED }}>
                    /mo
                  </span>
                </div>
                <p className="text-sm mt-1 mb-4" style={{ color: AMBER }}>
                  {p.limit}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'hsl(152, 60%, 52%)' }}>
                  Available Now
                </p>
                <ul className="space-y-2 text-sm mb-4" style={{ color: MUTED }}>
                  {p.availableBullets.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: AMBER }} />
                      {feat}
                    </li>
                  ))}
                </ul>
                {p.comingSoonBullets && p.comingSoonBullets.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'hsl(220, 10%, 50%)' }}>
                      Coming Soon
                    </p>
                    <ul className="space-y-2 text-sm mb-4 flex-1" style={{ color: 'hsl(220, 10%, 50%)' }}>
                      {p.comingSoonBullets.map((feat) => (
                        <li key={feat} className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(220, 10%, 40%)' }} />
                          {feat}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {(!p.comingSoonBullets || p.comingSoonBullets.length === 0) && (
                  <div className="flex-1" />
                )}

                <Button
                  onClick={goRecruiterAccess}
                  className="w-full font-bold rounded-xl"
                  style={{
                    background: p.highlight ? AMBER : 'transparent',
                    color: TEXT,
                    border: `1px solid ${p.highlight ? AMBER : BORDER}`,
                  }}
                >
                  Get started
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="px-4 sm:px-6 py-12 sm:py-16" style={{ background: NAVY_2 }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-3" style={{ color: TEXT }}>
            Built for trust-first trucking recruiting
          </h2>
          <p className="text-sm text-center mb-8 max-w-2xl mx-auto" style={{ color: MUTED }}>
            We don't publish customer testimonials we can't verify. Here's what the platform actually enforces today.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trustPoints.map((t, i) => (
              <div
                key={i}
                className="p-5 rounded-2xl border"
                style={{ background: NAVY, borderColor: BORDER }}
              >
                <div className="rounded-lg p-2 w-fit mb-3" style={{ background: 'hsl(25, 95%, 53%, 0.15)' }}>
                  <t.icon className="h-5 w-5" style={{ color: AMBER }} />
                </div>
                <p className="text-sm font-bold mb-1" style={{ color: TEXT }}>{t.title}</p>
                <p className="text-xs leading-snug" style={{ color: MUTED }}>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 sm:px-6 py-12 sm:py-16" style={{ background: NAVY }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-10" style={{ color: TEXT }}>
            Recruiter FAQ
          </h2>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div
                key={f.q}
                className="rounded-2xl border overflow-hidden"
                style={{ background: NAVY_2, borderColor: BORDER }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-3 p-5 text-left"
                >
                  <span className="text-sm font-bold" style={{ color: TEXT }}>
                    {f.q}
                  </span>
                  <ChevronDown
                    className="h-5 w-5 shrink-0 transition-transform"
                    style={{
                      color: MUTED,
                      transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0)',
                    }}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 text-sm" style={{ color: MUTED }}>
                    {f.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-4 sm:px-6 py-16" style={{ background: NAVY_2 }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl font-black mb-4" style={{ color: TEXT }}>
            Start posting structured opportunities
          </h2>
          <p className="text-base mb-8" style={{ color: MUTED }}>
            Add the recruiter workspace to your account. Standard posting unlocks once your profile is complete, posting terms are accepted, and your account is active.
          </p>
          <Button
            onClick={goRecruiterAccess}
            className="text-base font-bold rounded-xl px-8 py-6"
            style={{ background: AMBER, color: TEXT }}
          >
            {user ? 'Open Recruiter Workspace' : 'Add Recruiter Workspace'}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>
    </div>
  );
}
