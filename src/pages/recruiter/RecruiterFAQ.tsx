import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';

const faqs = [
  {
    q: 'How do I unlock standard recruiter posting?',
    a: 'Add the recruiter workspace to your account and complete the canonical readiness fields — recruiter name, company name, a valid recruiter email, and company type — then accept the current posting terms. A DOT or MC number is required only when your company type is Carrier / Motor Carrier; third-party recruiters, staffing agencies, and independent recruiters do not need DOT or MC for standard posting. Once those fields are complete and your account is not suspended, Recruiter Standard lets you keep 1 active opportunity at a time with unlimited drafts. No admin approval, no verification gate, and no paid plan are required to post a standard opportunity.',
  },
  {
    q: 'Can I paste an existing job post instead of typing the form?',
    a: 'Yes. Paste an existing job post, recruiter pitch, or rate sheet into the opportunity paste tool and AI extracts the structured fields into the form. You review and edit every extracted field before submitting. The extractor itself does not save anything — nothing is saved as an opportunity until you submit the form.',
  },
  {
    q: 'How does Verified Recruiter badge review work?',
    a: 'The Verified Recruiter badge is a separate trust-display process and does not gate standard posting. HaulTrackerPro reviews eligible recruiter profiles for the badge shown on driver listings. Pending or rejected badge review affects the badge and trust display only — it does not by itself remove your ability to post standard opportunities once your profile is complete and active. You will see your badge review status and any reviewer notes in Recruiter Settings.',
  },

  {
    q: 'What can I post after setup is complete?',
    a: 'Structured opportunities — pay model (CPM, percentage, flat), deductions, deadhead pay, escrow, home time, equipment, sign-on bonuses, and benefits. Pay claims must be truthful and supportable. Opportunity moderation and review remain available to the platform; misleading or vague "up to $X" copy without supporting structure may be flagged or removed.',
  },
  {
    q: 'How are pay numbers shown to drivers?',
    a: 'Drivers see your raw figures plus a HaulTrackerPro Profit Intelligence estimate (gross / deductions / RPM). All values are labeled as estimates based on recruiter-provided data — no guaranteed earnings are claimed on your behalf.',
  },
  {
    q: 'What plans are available and what do they include?',
    a: 'Recruiter Standard is free for complete, active recruiter workspaces and includes 1 active opportunity at a time with unlimited drafts. Starter ($19/mo) allows up to 5 active opportunities and adds applicant status history, a basic referral tracking view, and carrier settlement issuance. Growth ($49/mo) allows up to 15 active opportunities and adds priority-placement eligibility, featured-listing eligibility, recruiter reports (PDF + CSV), the recruiter contract-management dashboard, AI-assisted contract risk review, full referral progress tracking, pipeline analytics, and opportunity performance insights. Fleet ($149/mo) allows up to 25 active opportunities for existing or included Fleet access and adds top-placement eligibility and priority support — new standalone Fleet checkout is unavailable, and team seats, bulk opportunity tools, custom recruiter profile, and a company-level hiring dashboard are coming soon. Drafts are unlimited on every plan. You can change or cancel plans from Recruiter Settings → Billing. Cancellations take effect at the end of the current period.',
  },
  {
    q: 'How are payments processed and is my card data safe?',
    a: 'Billing runs through Stripe. HaulTrackerPro never stores card numbers — only Stripe customer and subscription identifiers. Manage your card and billing history through the in-app billing portal.',
  },
  {
    q: 'Can I issue settlement statements to drivers?',
    a: 'Yes, on a paid recruiter/carrier plan. Once a driver accepts your carrier-to-driver relationship invitation, you can prepare a settlement statement with line items, finalize it, void it, or supersede it with a correction, and the driver can view and reconcile the finalized statement. This is recordkeeping only — HaulTrackerPro does not pay, hold, transfer, verify, or guarantee any settlement amount, and payment happens outside the platform.',
  },
  {
    q: 'When and how do I get a driver\'s contact info?',
    a: 'When a driver applies to your opportunity, you receive the profile details the driver submitted. The driver\'s private phone number and email are disclosed only after the driver approves a separate contact request. Contact only the drivers who applied to your specific listing — scraping or contacting other recruiters\' applicants is prohibited.',
  },
  {
    q: 'Can I message drivers in-app?',
    a: 'Today, once a driver approves your contact request you respond via email or phone. In-app messaging is on the roadmap; meanwhile every status change on an application is logged so you and the driver share a clean timeline.',
  },
  {
    q: 'Can drivers refer other drivers to my opportunities?',
    a: 'Yes. Drivers can refer another driver to one of your opportunities, and you\'ll see each referral in your recruiter dashboard. You can move referrals through new → contacted → interviewed → hired → closed, or mark them as paid externally once you\'ve fulfilled your referral terms outside the platform.',
  },
  {
    q: 'Does HaulTrackerPro handle referral payments?',
    a: 'No. HaulTrackerPro tracks referral progress only — it does not process, hold, or guarantee referral payments. Referral bonuses, if you offer them, are paid externally by you to the referring driver according to your own terms.',
  },
  {
    q: 'How do I set my referral terms?',
    a: 'In Recruiter Settings → Referral Terms, you can define your bonus amount, when a bonus may be paid externally (for example, after hire or after 30 days), and any conditions. Referring drivers see your terms before sending a referral, so expectations are clear up front.',
  },
  {
    q: 'How do contract workflow tools work?',
    a: "Universal driver contract workflow protections — viewing the contract sent by a recruiter, approving, requesting changes, rejecting, recording an optional in-app signature, and the hired-state protection that prevents recruiters from marking a driver hired until the driver approves the current contract — are available on every driver plan and do not depend on a paid recruiter plan. Growth and Fleet recruiter plans add the recruiter contract-management dashboard, contract upload/management interface, and AI-assisted contract risk review that surfaces plain-English risk flags. These tools are designed to make the workflow clearer — they are not legal advice.",
  },
  {
    q: 'Is the in-app signature legally binding?',
    a: 'It is a platform-generated record of consent — typed name, timestamp, IP, user agent, contract version ID, and audit metadata. It is not represented as a qualified or advanced electronic signature, and is not DocuSign-equivalent. Enforceability depends on jurisdiction and contract type; consult an attorney for high-stakes agreements.',
  },
  {
    q: 'What happens if I am suspended?',
    a: 'Active listings are paused and you cannot post new ones. You will see reviewer notes in Recruiter Settings. Contact support@haultrackerpro.com to appeal or correct the issue.',
  },
  {
    q: 'Can I get a refund?',
    a: 'HaulTrackerPro does not refund partial billing periods unless required by law. You can cancel at any time and keep access until the end of the period you paid for.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

export default function RecruiterFAQ() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="Recruiter FAQ | HaulTrackerPro"
        description="Answers for recruiters: unlocking standard posting after profile completion, separate Verified Recruiter badge review, billing, applicants, and contract workflow tools on HaulTrackerPro."
        path="/recruiter/faq"
        jsonLd={[jsonLd, buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'For Recruiters', path: '/recruiters' }, { name: 'Recruiter FAQ', path: '/recruiter/faq' }])]}
      />
      <nav className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">HaulTrackerPro</span>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <header>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary mb-3">
            <ShieldCheck className="h-3 w-3" /> For Recruiters
          </div>
          <h1 className="text-3xl sm:text-4xl font-black font-heading tracking-tight">Recruiter FAQ</h1>
          <p className="mt-3 text-sm text-muted-foreground max-w-xl">
            Everything you need to know about verification, posting, billing, applicants, and contract workflow tools.
          </p>
        </header>

        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`r-faq-${i}`} className="border rounded-xl px-4 bg-card shadow-card">
              <AccordionTrigger className="text-sm font-semibold text-left hover:no-underline">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
          <h2 className="text-lg font-black font-heading">Still need help?</h2>
          <p className="text-sm text-muted-foreground">Reach the team at <a className="font-semibold text-primary" href="mailto:support@haultrackerpro.com">support@haultrackerpro.com</a>.</p>
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            <Button size="sm" onClick={() => navigate('/recruiter/guide')} className="rounded-xl gap-1">Recruiter Guide <ArrowRight className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/recruiter/features')} className="rounded-xl gap-1">Features <ArrowRight className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/recruiter/updates')} className="rounded-xl">Updates</Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/recruiters')} className="rounded-xl">For Recruiters</Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/about')} className="rounded-xl">About</Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/pricing')} className="rounded-xl">Pricing</Button>
          </div>
          <p className="text-sm text-muted-foreground pt-1">
            Want the full breakdown?{' '}
            <button onClick={() => navigate('/resources/trucking-recruiter-tools')} className="font-semibold text-primary hover:underline">
              Read the trucking recruiter tools guide →
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
