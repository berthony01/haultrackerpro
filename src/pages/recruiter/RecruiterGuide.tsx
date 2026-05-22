import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Building2, CreditCard, ClipboardList, Users,
  FileSignature, BarChart3, ShieldCheck, Truck, CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import SEOHead from '@/components/SEOHead';

const steps = [
  { num: '01', icon: Building2, title: 'Submit your recruiter profile', desc: 'Company name, DOT, MC, address, hiring states, equipment types, and recruiter contact details. Admin review is typically within one business day.' },
  { num: '02', icon: ShieldCheck, title: 'Get verified', desc: 'A HaulTrackerPro admin reviews every recruiter. Approved profiles unlock posting; rejected profiles include reviewer notes so you can resubmit.' },
  { num: '03', icon: ClipboardList, title: 'Post standard opportunities (unlimited)', desc: 'Once verified, post as many standard opportunities as you need — no per-plan post cap. Pay model, CPM/percentage/flat, deductions, deadhead, escrow, home time, equipment, sign-on. Clear structure means drivers can compare you on real numbers.' },
  { num: '04', icon: CreditCard, title: 'Upgrade for premium tools (optional)', desc: 'Standard posting is always available to verified recruiters. Upgrade to Starter ($19), Growth ($49), or Fleet ($149) when you want premium visibility, recruiter reports, contract workflow tools, and analytics. Billing is handled by Stripe — change or cancel anytime in Recruiter Settings.' },
  { num: '05', icon: Users, title: 'Manage your applicant pipeline', desc: 'Each driver request lands in your dashboard with contact info and preferences. Move them through new → contacted → interview → offer → hired.' },
  { num: '06', icon: FileSignature, title: 'Use contract workflow tools (Growth & Fleet)', desc: "Attach a contract to an application. Drivers see AI-assisted risk flags and can approve, request changes, reject, or sign. Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record. These tools are designed to make the workflow clearer — they are not legal advice." },
  { num: '07', icon: BarChart3, title: 'Track what works', desc: 'Recruiting Snapshot on the dashboard shows active opportunities, new requests, contacted, interviews, hires, and response rate.' },

];

const tips = [
  'Be specific about pay — drivers convert better on transparent CPM, deductions, and home-time than on vague "up to $X" claims.',
  'Respond fast. Response time is one of the biggest drivers of conversion across the pipeline.',
  'Use contract workflow tools for any lease, escrow, or non-standard agreement. They make terms easier to review and reduce back-and-forth. (Not legal advice.)',
  'Pause listings that are full instead of leaving them stale. Standard posting is unlimited for verified recruiters — upgrade only when you want premium visibility, reports, or contract workflow tools.',
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Recruiter User Guide | HaulTrackerPro',
  description: 'How recruiters get verified, post unlimited standard opportunities, manage applicants, and use contract workflow tools on HaulTrackerPro.',
  publisher: { '@type': 'Organization', name: 'HaulTrackerPro', url: 'https://haultrackerpro.com' },
  mainEntityOfPage: 'https://haultrackerpro.com/recruiter/guide',
};

export default function RecruiterGuide() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="Recruiter User Guide | HaulTrackerPro"
        description="Step-by-step guide for trucking recruiters: verification, posting unlimited standard opportunities, managing applicants, and contract workflow tools."
        path="/recruiter/guide"
        jsonLd={jsonLd}
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
            Apply for recruiter access. Verification is typically within one business day.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-xl font-bold text-base px-10">
              <Link to="/auth?intent=recruiter">Apply for Recruiter Access <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-xl font-bold text-base px-10">
              <Link to="/recruiter/faq">Recruiter FAQ</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
