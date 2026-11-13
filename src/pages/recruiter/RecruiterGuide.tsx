import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Building2, CreditCard, ClipboardList, Users,
  FileSignature, BarChart3, ShieldCheck, Truck, CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';

const steps = [
  { num: '01', icon: Building2, title: 'Add the recruiter workspace and complete your profile', desc: 'Add the recruiter workspace to your account and provide the canonical standard-posting fields: recruiter name, company name, a valid recruiter email, and company type. A DOT or MC number is required only when your company type is Carrier / Motor Carrier — third-party recruiters, staffing agencies, and independent recruiters do not need DOT or MC for standard posting.' },
  { num: '02', icon: ShieldCheck, title: 'Accept posting terms and unlock standard posting', desc: 'Once those profile fields are complete, the current posting terms are accepted, and your account is not suspended, standard posting is unlocked. No admin approval, no verification gate, and no paid plan are required.' },
  { num: '03', icon: ShieldCheck, title: 'Optionally request Verified Recruiter badge review', desc: 'The Verified Recruiter badge is a separate trust-display process and does not gate standard posting. Pending or rejected badge review does not by itself disable your standard posting.' },
  { num: '04', icon: ClipboardList, title: 'Post a structured opportunity', desc: 'Recruiter Standard keeps 1 active opportunity at a time with unlimited drafts; Starter allows 5 active, Growth 15, and Fleet 25 for existing or included Fleet access. Capture pay model, CPM/percentage/flat, deductions, deadhead, escrow, home time, equipment, sign-on. To save typing, paste an existing job post, recruiter pitch, or rate sheet and let AI extract the structured fields — you review and edit every extracted field, and the extractor itself does not save anything until you submit the form. Clear structure means drivers can compare you on real numbers.' },
  { num: '05', icon: Users, title: 'Manage your applicant pipeline', desc: 'Each driver application lands in your dashboard with the profile details the driver submitted. Private phone and email are revealed only after the driver approves your contact request. Move applicants through the recruiter-controlled stages available in the dashboard.' },
  { num: '06', icon: CreditCard, title: 'Upgrade for premium tools when needed', desc: 'Standard posting is always available to complete, active recruiter workspaces. Upgrade to Starter ($19) or Growth ($49) when you want more active listings, premium visibility, recruiter reports, contract-management, AI-assisted risk review, analytics, and carrier settlement issuance. Fleet ($149) remains preview-only for new standalone subscriptions. Billing is handled by Stripe — the Stripe portal is the source of truth for your account-specific billing status and effective dates.' },
  { num: '07', icon: BarChart3, title: 'Use Growth/Fleet reports and AI-assisted contract-management tools', desc: "Growth and Fleet add the recruiter contract-management dashboard, contract upload/management interface, and AI-assisted risk review. Universal driver protections — contract review, approve/reject/request changes, optional in-app signature, and the hired-status protection that requires driver approval before hiring — apply regardless of the recruiter's plan. Not legal advice." },
  { num: '08', icon: ClipboardList, title: 'Issue settlement statements on a standalone paid plan', desc: 'Carrier-issued settlements require an active standalone paid recruiter/carrier entitlement plus an active carrier↔driver relationship the driver has accepted. An agency-included recruiter entitlement is a recruiting entitlement only and does not grant carrier-issued settlement authority. Once a relationship is accepted you can prepare, finalize, void, or correct statements the driver can view and reconcile. Recordkeeping only — HaulTrackerPro does not process payroll, pay drivers, or guarantee any settlement amount.' },


];

const businessStarterSteps = [
  { title: 'Prepare your business', detail: 'Choose Independent Recruiter, Third-Party Recruiting Company, or Staffing Agency when appropriate. Check applicable state or local business and recruiting requirements. An account on HaulTrackerPro is not a business license.' },
  { title: 'Obtain carrier authorization', detail: 'Find a legitimate carrier needing drivers. Arrange an authorized hiring request and written agreement on recruiting fees and payment outside HaulTrackerPro. Existing recruiter contract tools apply to driver-facing contracts, not carrier-client service agreements.' },
  { title: 'Post a real opportunity', detail: 'Complete your recruiter profile and accept the current posting terms. The free tier has 1 active listing at a time and unlimited drafts; paid tiers increase active limits.' },
  { title: 'Manage driver applications', detail: 'Review applicants inside your pipeline. Request contact information through the consent-based workflow. Do not disclose private driver contact details without permission.' },
  { title: 'Coordinate placements and external payment', detail: 'The carrier makes its hiring decision. Carrier-client invoicing, commissions, and actual payment take place outside the platform; dedicated carrier-client CRM and commission management are not yet available.' },
];

const tips = [
  'Be specific about pay — drivers convert better on transparent CPM, deductions, and home-time than on vague "up to $X" claims.',
  'Respond fast. Response time is one of the biggest drivers of conversion across the pipeline.',
  'Use Growth/Fleet contract-management and AI-assisted risk review for any lease, escrow, or non-standard agreement. They make terms easier to review and reduce back-and-forth. (Not legal advice.)',
  'Pause or close listings that are full instead of leaving them stale — only active listings count toward your plan limit, and drafts are always unlimited.',
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Recruiter User Guide | HaulTrackerPro',
  description: 'How recruiters add the recruiter workspace, complete their profile to unlock standard posting, optionally request Verified Recruiter badge review, manage applicants, and use Growth/Fleet contract-management with AI-assisted risk review on HaulTrackerPro.',
  publisher: { '@type': 'Organization', name: 'HaulTrackerPro', url: 'https://haultrackerpro.com' },
  mainEntityOfPage: 'https://haultrackerpro.com/recruiter/guide',
};

export default function RecruiterGuide() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="Recruiter User Guide | HaulTrackerPro"
        description="Step-by-step guide for trucking recruiters: add the recruiter workspace, complete your profile to unlock standard posting, request Verified Recruiter badge review separately, manage applicants, and use Growth/Fleet contract-management with AI-assisted risk review."
        path="/recruiter/guide"
        jsonLd={[jsonLd, buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'For Recruiters', path: '/recruiters' }, { name: 'Recruiter Guide', path: '/recruiter/guide' }])]}
      />

      <nav className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">HaulTrackerPro</span>
          </div>
        </div>
      </nav>

      <section className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary mb-4">
            <ShieldCheck className="h-3 w-3" /> For Recruiters
          </div>
          <h1 className="text-3xl sm:text-5xl font-black font-heading tracking-tight mb-3">
            Recruiter <span className="text-primary">User Guide</span>
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl mx-auto">
            From workspace setup to hired driver, with separate company Dispatch and Telegram Mini App guidance.
          </p>
        </div>
      </section>

      <section id="business-starter" className="border-b border-border bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-black font-heading mb-3">Start an independent trucking recruiting business</h2>
          <p className="text-sm sm:text-base text-muted-foreground mb-7">
            You do not need to own trucks to use an Independent Recruiter workspace. Follow these steps, and note which business operations still happen outside HaulTrackerPro.
          </p>
          <ol className="space-y-3">
            {businessStarterSteps.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-border bg-card p-4 sm:p-5 flex gap-4">
                <span className="text-primary font-bold shrink-0">{index + 1}.</span>
                <div>
                  <h3 className="font-bold mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted-foreground mt-5">
            A recruiter workspace does not guarantee carrier clients, placements, income, or compliance with local requirements.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-10">The 8-step flow</h2>
        <div className="space-y-4">
          {steps.map((s) => (
            <Card key={s.num} className="shadow-card border-border">
              <CardContent className="p-5 flex gap-4">
                <div className="shrink-0 h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <s.icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <span className="text-xs font-bold text-primary tracking-wider">STEP {s.num}</span>
                  <h3 className="text-base font-bold font-heading mt-0.5 mb-1">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="dispatch" className="scroll-mt-20 border-t border-border bg-muted/20" aria-labelledby="dispatch-guide-heading">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 mb-3">
            <Truck className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 id="dispatch-guide-heading" className="text-2xl sm:text-3xl font-black font-heading">Company Dispatch and Telegram Mini App</h2>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground mb-6">
            Recruiting opportunities and Dispatch loads are different workflows. Posting a job does not assign a load. Dispatch is for an authorized company workspace with drivers who accept a company connection.
          </p>
          <ol className="list-decimal pl-5 space-y-4 text-sm sm:text-base text-foreground/90">
            <li><strong>Open your company Dispatch workspace.</strong> The owner opens Dispatch from the recruiter workspace or the website Dispatch page. Staff require company-granted load viewing, creation or status-update permissions for their assigned actions.</li>
            <li><strong>Connect the driver first.</strong> The company owner uses Connect drivers to invite an existing or new HaulTracker Pro driver by account email. The verified driver reviews and accepts the request under Driver Company Connections. This is separate from a recruiter job application.</li>
            <li><strong>Create and manage the assigned load.</strong> Select a connected driver, enter route, miles and agreed pay, then save. Loads start Pending. Delivered and Cancelled require confirmation. Delivered from the Dispatch board requires an actual delivery date. Drivers see the same load in their own account, including cancellations, while unfinished and cancelled loads are excluded from completed earnings.</li>
            <li><strong>Open Dispatch inside Telegram.</strong> Link your personal Telegram identity with HaulTracker Pro. In a private chat with @HaulTrackerBot, use <code>/start dispatch</code> to open the signed Mini App. Sign in with the connected HaulTracker account. The website and Mini App share load records, but do not share a browser sign-in session automatically.</li>
            <li><strong>Connect a group separately if needed.</strong> Use the Dispatch Telegram group setup in your recruiter workspace: add the bot to the chosen group, generate a one-time connection command, and send it from your linked Telegram account within 15 minutes. Group updates require matching load references and authorized review. Simply adding the bot never grants group members permission to dispatch loads.</li>
          </ol>
          <p className="mt-5 text-sm text-muted-foreground">A completed older group update may have no confirmed actual delivery date. The driver interface labels this clearly, and reports use the scheduled delivery or pickup date until a confirmed date exists. Drivers do not need company staff or Telegram bot access to view assigned loads.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="min-h-11"><Link to="/dispatch">Open authorized Dispatch <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="min-h-11"><Link to="/recruiter/faq">Dispatch and Telegram FAQ</Link></Button>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-8">Tips that move the needle</h2>
          <div className="space-y-3">
            {tips.map((t, i) => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card shadow-card">
                <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <span className="text-sm">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-4xl font-black font-heading mb-3">Ready to start posting?</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Add the recruiter workspace to your account. Standard posting unlocks once your profile is complete, posting terms are accepted, and your account is active.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap">
            <Button asChild size="lg" className="rounded-xl font-bold text-base px-10">
              <Link to="/auth?intent=recruiter">Add Recruiter Workspace <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-xl font-bold text-base px-10">
              <Link to="/recruiter/faq">Recruiter FAQ</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-xl font-bold text-base px-10">
              <Link to="/recruiter/features">Recruiter Features</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            New to HaulTrackerPro?{' '}
            <Link to="/about" className="font-semibold text-primary hover:underline">Learn why we built it</Link>
            {' '}or{' '}
            <Link to="/resources" className="font-semibold text-primary hover:underline">explore the resource hub</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
