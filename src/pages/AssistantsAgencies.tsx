import { ArrowLeft, ArrowRight, Truck, Users, Building2, Shield, CheckCircle2, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import { useAuth } from '@/hooks/useAuth';
import MarketingHeader from '@/components/marketing/MarketingHeader';


const AMBER = 'hsl(25, 95%, 53%)';
const AMBER_BRIGHT = 'hsl(25, 95%, 60%)';
const NAVY_BG = 'hsl(220, 20%, 8%)';
const NAVY_SURFACE = 'hsl(220, 20%, 10%)';
const NAVY_BORDER = 'hsl(220, 16%, 16%)';
const TEXT_MUTED = 'hsl(220, 10%, 65%)';
const TEXT_DIM = 'hsl(220, 10%, 50%)';
const GREEN = 'hsl(152, 60%, 45%)';

const faqs = [
  {
    q: 'Can I use HaulTracker Pro to help other drivers manage paperwork?',
    a: 'Yes. Driver Assistants can help one or more drivers with load entry, expenses, fuel logs, reports, and basic account organization — but only after the driver explicitly approves their access and chooses which permissions to grant.',
  },
  {
    q: 'Can I start a back-office agency with HaulTracker Pro?',
    a: 'Yes. Create an Agency Workspace, publish service packages, share your private agency request link with drivers, and manage approved driver clients from a shared work queue. This is an opportunity to build a back-office side hustle — it is not a guarantee of clients or income.',
  },
  {
    q: 'Do assistants get access automatically?',
    a: 'No. Submitting an agency request never grants any account access. A driver must explicitly approve a specific assistant or agency delegation, and they choose exactly which permissions are granted (loads, expenses, fuel, reports, limited settings).',
  },
  {
    q: 'Does HaulTracker Pro handle payments between drivers and assistants?',
    a: 'Agency software subscriptions are already live and billed through Stripe. What remains outside HaulTracker Pro is service payments between a driver and an assistant or agency for back-office work — those are arranged directly between them.',
  },
  {
    q: 'Can a direct assistant work on settlement statements?',
    a: 'Only with the matching driver-approved permission. Settlement view permission is required to view a statement, settlement-management permission is required to manage or prepare one, and settlement-finalize permission is required to finalize one. Advanced reconciliation and imported outside settlements follow the recipient driver\'s own Pro entitlement, never the assistant\'s plan, and assistant finalization also requires the recipient driver to be on Pro.',
  },
  {
    q: 'What can a paid agency do with settlements?',
    a: 'A paid agency plan can prepare settlement statements for delegated driver clients when settlement-management permission has been granted. Finalizing additionally requires settlement-finalize permission. The recipient driver being Free or Pro does not gate paid agency preparation.',
  },
  {
    q: 'Can drivers revoke assistant or agency access?',
    a: 'Yes. Drivers can revoke any assistant or agency access at any time from the Driver Control Center, and access ends immediately. Every action an assistant or agency takes is recorded in an audit log the driver can review.',
  },
  {
    q: 'What can assistants and agencies NOT do?',
    a: 'They cannot bypass driver approval, they cannot grant themselves new permissions, and they cannot access drivers who have not approved them. HaulTracker Pro does not process service payments, does not guarantee income, and does not operate as a public marketplace.',
  },
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

export default function AssistantsAgencies() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleAgencyCTA = () => {
    if (user) navigate('/agency');
    else navigate('/auth?next=%2Fagency');
  };
  const handleAssistantCTA = () => {
    if (user) navigate('/assistant');
    else navigate('/auth?next=%2Fassistant');
  };
  // Display text only — does not affect access, handlers, or routing.
  const assistantCtaLabel = user ? 'Open Assistant Access Center' : 'Sign in for Assistant Access';

  return (
    <div className="min-h-screen" style={{ background: NAVY_BG }}>
      <SEOHead
        title="Assistants & Agencies — Trucking Back-Office Side Hustle | HaulTrackerPro"
        description="Use HaulTracker Pro to help truckers manage loads, expenses, fuel logs, and reports. Build a back-office side hustle or run a multi-driver trucking agency, with driver-approved access and full audit logs."
        path="/assistants-agencies"
        jsonLd={[
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Assistants & Agencies', path: '/assistants-agencies' },
          ]),
          faqJsonLd,
        ]}
      />

      <MarketingHeader
        primaryCta={{ label: 'Create Agency Workspace', mobileLabel: 'Agency', onClick: handleAgencyCTA }}
      />


      <main>
        <section className="relative overflow-hidden">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-10 text-center">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs font-medium mb-6 mx-auto" style={{ color: TEXT_DIM }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6" style={{ background: 'hsl(25, 95%, 53%, 0.12)', color: AMBER_BRIGHT }}>
              <Briefcase className="h-3.5 w-3.5" /> Side Hustle &amp; Agency Workflow
            </div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.05] text-white max-w-3xl mx-auto">
              Turn trucking paperwork into a <span style={{ color: AMBER }}>service business</span>.
            </h1>
            <p className="mt-6 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: TEXT_MUTED }}>
              Many drivers don't want to enter loads, expenses, fuel logs, and paperwork themselves. Use HaulTracker Pro to offer bookkeeping-style support to truckers — as a Driver Assistant helping one driver, or as an Agency managing multiple approved driver clients. Drivers stay in full control of who can access their account.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={handleAgencyCTA} size="lg" className="text-base font-bold rounded-xl h-13 px-7 gap-2" style={{ background: AMBER, color: 'white' }}>
                <Building2 className="h-5 w-5" /> Create Agency Workspace
              </Button>
              <Button onClick={handleAssistantCTA} size="lg" variant="outline" className="text-base font-bold rounded-xl h-13 px-7 gap-2 hover:bg-transparent" style={{ borderColor: AMBER, color: AMBER_BRIGHT, background: 'transparent', borderWidth: 2 }}>
                <Users className="h-5 w-5" /> {assistantCtaLabel}
              </Button>
            </div>
            <p className="mt-5 text-xs" style={{ color: TEXT_DIM }}>
              This is an opportunity to build a back-office side hustle — HaulTracker Pro does not guarantee clients, customers, or income.
            </p>
          </div>
        </section>

        {/* Three cards */}
        <section className="border-t" style={{ borderColor: NAVY_BORDER }}>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  icon: Users,
                  tag: 'Driver Assistant',
                  title: 'Help one or more drivers',
                  bullets: [
                    'Help drivers with load entry, expenses, fuel logs, and reports',
                    'Each driver approves you and chooses your permissions',
                    'Every action is audit-logged on the driver\'s account',
                    'Settlements only with the matching permission: settlement view to view, settlement-management to manage, settlement-finalize to finalize',
                  ],
                  cta: 'Become a Driver Assistant',
                  onClick: handleAssistantCTA,
                },
                {
                  icon: Building2,
                  tag: 'Back-Office Agency',
                  title: 'Manage multiple approved drivers',
                  bullets: [
                    'Publish service packages and share a private request link',
                    'Driver-approved delegation, never silent access',
                    'Shared work queue with waiting-on-driver responses',
                    'Paid agency plans can prepare settlement statements for approved driver clients (recordkeeping only) with settlement-management permission; finalizing also requires settlement-finalize permission',
                  ],
                  cta: 'Create Agency Workspace',
                  onClick: handleAgencyCTA,
                },
                {
                  icon: Shield,
                  tag: 'Driver Control',
                  title: 'Drivers stay in full control',
                  bullets: [
                    'Drivers see exactly who has access and what they can do',
                    'Driver-approved delegation required for every assignment',
                    'Drivers can revoke any access instantly — full audit trail',
                  ],
                  cta: 'See Driver Control Center',
                  onClick: () => navigate(user ? '/driver/assistant-control' : '/auth'),
                },
              ].map((card) => (
                <div key={card.tag} className="rounded-2xl border p-6 flex flex-col" style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                      <card.icon className="h-5 w-5" style={{ color: AMBER }} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER_BRIGHT }}>{card.tag}</span>
                  </div>
                  <h3 className="text-lg font-black text-white leading-tight">{card.title}</h3>
                  <div className="mt-4 space-y-2 flex-1">
                    {card.bullets.map((b) => (
                      <p key={b} className="text-sm flex items-start gap-2 text-white/90">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: GREEN }} />
                        <span>{b}</span>
                      </p>
                    ))}
                  </div>
                  <Button onClick={card.onClick} variant="outline" className="mt-5 rounded-xl font-bold gap-2 hover:bg-transparent" style={{ borderColor: AMBER, color: AMBER_BRIGHT, borderWidth: 2, background: 'transparent' }}>
                    {card.cta} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What you can manage / What HTP does not do yet */}
        <section className="border-t" style={{ borderColor: NAVY_BORDER }}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20 grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border p-6" style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}>
              <h3 className="text-lg font-black text-white mb-3">What you can help manage</h3>
              <ul className="space-y-2 text-sm" style={{ color: TEXT_MUTED }}>
                {[
                  'Load entry and edits (with permission)',
                  'Expenses, including the Fuel category',
                  'Fuel logs for gallons, MPG, and IFTA-style reporting',
                  'Reports, exports, and weekly closeouts',
                  'Limited settings (with permission)',
                  'Responding to waiting-on-driver work items',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: GREEN }} /> {t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border p-6" style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}>
              <h3 className="text-lg font-black text-white mb-3">What HaulTracker Pro does NOT do</h3>
              <ul className="space-y-2 text-sm" style={{ color: TEXT_MUTED }}>
                {[
                  'Process service payments between drivers and assistants or agencies',
                  'Guarantee clients, customers, or income',
                  'Run a public marketplace where anyone can hire anyone',
                  'Grant assistant or agency access without explicit driver approval',
                  'Allow assistants to manage drivers who have not approved them',
                  'Pay, hold, transfer, verify, or guarantee any settlement amount — settlement statements are recordkeeping only',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: AMBER }} /> {t}</li>
                ))}
              </ul>
              <p className="mt-4 text-xs" style={{ color: TEXT_DIM }}>
                Agency software subscriptions are already live and billed through Stripe. Only service payments between drivers and assistants or agencies remain outside HaulTracker Pro.
              </p>
            </div>

          </div>
        </section>

        {/* FAQ */}
        <section className="border-t" style={{ borderColor: NAVY_BORDER }}>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-black text-white text-center mb-8">Common questions</h2>
            <div className="space-y-3">
              {faqs.map((f) => (
                <details key={f.q} className="rounded-xl border p-5" style={{ background: NAVY_SURFACE, borderColor: NAVY_BORDER }}>
                  <summary className="text-sm sm:text-base font-bold text-white cursor-pointer">{f.q}</summary>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: TEXT_MUTED }}>{f.a}</p>
                </details>
              ))}
            </div>

            <div className="mt-12 text-center">
              <h3 className="text-xl font-black text-white">Ready to start?</h3>
              <p className="mt-2 text-sm" style={{ color: TEXT_MUTED }}>
                Build a back-office service business around real trucking paperwork.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={handleAgencyCTA} className="rounded-xl font-bold gap-2" style={{ background: AMBER, color: 'white' }}>
                  <Building2 className="h-4 w-4" /> Create Agency Workspace
                </Button>
                <Button onClick={handleAssistantCTA} variant="outline" className="rounded-xl font-bold gap-2 hover:bg-transparent" style={{ borderColor: AMBER, color: AMBER_BRIGHT, borderWidth: 2, background: 'transparent' }}>
                  <Users className="h-4 w-4" /> Sign in to become a Driver Assistant
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8" style={{ borderColor: NAVY_BORDER, background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: TEXT_DIM }}>
          <span>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <a href="/features" className="hover:underline">Features</a>
            <a href="/pricing" className="hover:underline">Pricing</a>
            <a href="/faq" className="hover:underline">FAQ</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
