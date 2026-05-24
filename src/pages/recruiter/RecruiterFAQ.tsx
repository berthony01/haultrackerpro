import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';

const faqs = [
  {
    q: 'How do I get approved as a recruiter?',
    a: 'Open the Recruiter Dashboard, click "Apply for Recruiter Access", and submit your company name, DOT, MC, address, hiring states, equipment types, and contact info. A HaulTrackerPro admin reviews every recruiter manually — typically within one business day. You\'ll see your status (pending, approved, needs attention, or suspended) in Recruiter Settings.',
  },
  {
    q: 'Why was my recruiter profile rejected?',
    a: 'Common reasons: incomplete or mismatched DOT/MC, a company that does not match your stated identity, or missing contact details. Open Recruiter Settings → Update profile, fix the highlighted fields, and resubmit. Reviewer notes appear directly on the profile.',
  },
  {
    q: 'What can I post once I am approved?',
    a: 'Structured opportunities — pay model (CPM, percentage, flat), deductions, deadhead pay, escrow, home time, equipment, sign-on bonuses, and benefits. Pay claims must be truthful and supportable. Vague "up to $X" copy without supporting structure may be flagged or removed by moderation.',
  },
  {
    q: 'How are pay numbers shown to drivers?',
    a: 'Drivers see your raw figures plus a HaulTrackerPro Profit Intelligence estimate (gross / deductions / RPM). All values are labeled as estimates based on recruiter-provided data — no guaranteed earnings are claimed on your behalf.',
  },
  {
    q: 'What plans are available and what do they include?',
    a: 'Verified recruiters can post unlimited standard opportunities for free — no paid subscription required. Paid plans add premium recruiting tools on top: Starter ($19/mo) adds enhanced applicant tracking, applicant notes, status history, basic listing analytics, and recruiter trust tools. Growth ($49/mo) adds Priority Placement in driver listings, featured listing eligibility, Recruiter Activity & Pipeline reports (PDF + CSV), contract workflow tools, and pipeline analytics. Fleet ($149/mo) keeps everything in Growth and adds top placement eligibility, advanced analytics, and priority support — with team seats, bulk opportunity tools, and a company-level hiring dashboard coming soon. You can change or cancel plans from Recruiter Settings → Billing. Cancellations take effect at the end of the current period.',

  },
  {
    q: 'How are payments processed and is my card data safe?',
    a: 'Billing runs through Stripe. HaulTrackerPro never stores card numbers — only Stripe customer and subscription identifiers. Manage your card and billing history through the in-app billing portal.',
  },
  {
    q: 'When and how do I get a driver\'s contact info?',
    a: 'When a driver requests info on your opportunity, you receive a contact snapshot (name, email, and phone if provided) at the moment of the request. The driver also sees their info will be shared. Contact only the drivers who request info on your specific listing — scraping or contacting other recruiters\' applicants is prohibited.',
  },
  {
    q: 'Can I message drivers in-app?',
    a: 'Today, drivers receive your contact info and you respond via email or phone. In-app messaging is on the roadmap; meanwhile every status change on an application is logged so you and the driver share a clean timeline.',
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
    a: "Contract workflow tools are included with the Growth and Fleet recruiter plans. Attach a contract (PDF or image) to any application. HaulTrackerPro parses it and surfaces plain-English risk flags to the driver. The driver can approve, request changes, reject, or sign. Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record. These tools are designed to make the workflow clearer — they are not legal advice.",

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
        description="Answers for recruiters: verification, posting unlimited standard opportunities, billing, applicants, and contract workflow tools on HaulTrackerPro."
        path="/recruiter/faq"
        jsonLd={jsonLd}
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
