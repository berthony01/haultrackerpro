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
  { num: '01', icon: Building2, title: 'Add the recruiter workspace and complete your profile', desc: 'Add the recruiter workspace to your account and fill in company name, DOT and/or MC number, address, hiring states, equipment types, and a valid recruiter contact email.' },
  { num: '02', icon: ShieldCheck, title: 'Accept posting terms and unlock standard posting', desc: 'Once your recruiter profile is complete, current posting terms are accepted, and your account is active, standard posting is unlocked. No admin approval and no paid plan are required.' },
  { num: '03', icon: ShieldCheck, title: 'Optionally request Verified Recruiter badge review', desc: 'The Verified Recruiter badge is a separate trust-display process. Pending or rejected badge review does not by itself disable your standard posting.' },
  { num: '04', icon: ClipboardList, title: 'Post a structured opportunity', desc: 'Recruiter Standard keeps 1 active opportunity at a time with unlimited drafts; Starter allows 5 active, Growth 15, and Fleet 25 for existing or included Fleet access. Capture pay model, CPM/percentage/flat, deductions, deadhead, escrow, home time, equipment, sign-on. Clear structure means drivers can compare you on real numbers.' },
  { num: '05', icon: Users, title: 'Manage your applicant pipeline', desc: 'Each driver application lands in your dashboard with the profile details the driver submitted. Private phone and email are revealed only after the driver approves your contact request. Move applicants through the recruiter-controlled stages available in the dashboard.' },
  { num: '06', icon: CreditCard, title: 'Upgrade for premium tools when needed', desc: 'Standard posting is always available to complete, active recruiter workspaces. Upgrade to Starter ($19) or Growth ($49) when you want more active listings, premium visibility, recruiter reports, contract-management, AI-assisted risk review, analytics, and carrier settlement issuance. Fleet ($149) remains preview-only for new standalone subscriptions. Billing is handled by Stripe — change or cancel anytime in Recruiter Settings.' },
  { num: '07', icon: BarChart3, title: 'Use Growth/Fleet reports and AI-assisted contract-management tools', desc: "Growth and Fleet add the recruiter contract-management dashboard, contract upload/management interface, and AI-assisted risk review. Universal driver protections — contract review, approve/reject/request changes, optional in-app signature, and the hired-status protection that requires driver approval before hiring — apply regardless of the recruiter's plan. Not legal advice." },
  { num: '08', icon: ClipboardList, title: 'Issue settlement statements on a paid plan', desc: 'Paid recruiter/carrier plans can invite a driver into a carrier-to-driver relationship and, once accepted, prepare, finalize, void, or correct settlement statements the driver can view and reconcile. Recordkeeping only — HaulTrackerPro does not pay, hold, verify, or guarantee any settlement amount.' },

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
            From application to hired driver — a clear walkthrough of how to use HaulTrackerPro as a recruiter.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-black font-heading text-center mb-10">The 7-step flow</h2>
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
