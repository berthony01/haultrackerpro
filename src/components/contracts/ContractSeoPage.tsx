import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ShieldCheck, FileText, AlertTriangle, CheckCircle2, Sparkles, Building2, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

export interface ContractSeoFaq { q: string; a: string }

export interface ContractSeoPageProps {
  path: string;
  title: string;
  description: string;
  h1: string;
  headerLabel: string;
  intro: string;
  reviewItems: string[];
  faqs: ContractSeoFaq[];
  /** Optional extra educational sections rendered between intro and "What this helps you review". */
  extraSections?: { heading: string; body: string | React.ReactNode }[];
  breadcrumbName: string;
}

const SITE = 'https://haultrackerpro.com';

const RELATED_CONTRACT_PAGES: { path: string; title: string }[] = [
  { path: '/trucking-contract-review', title: 'AI Trucking Contract Review for 1099 Drivers' },
  { path: '/owner-operator-contract-review', title: 'Owner-Operator Contract Review' },
  { path: '/lease-purchase-contract-red-flags', title: 'Lease-Purchase Contract Red Flags' },
  { path: '/trucking-escrow-agreement-review', title: 'Trucking Escrow Agreement Review' },
  { path: '/1099-truck-driver-contract-protection', title: '1099 Truck Driver Contract Protection' },
  { path: '/ai-contract-review-for-truckers', title: 'AI Contract Review for Truckers' },
];

const HOW_IT_WORKS = [
  'Recruiter uploads the contract.',
  'AI parses the document.',
  'Driver sees a plain-English summary and risk flags.',
  'Driver approves, rejects, or requests changes.',
  'Driver can record approval/signature when required.',
  'Recruiter cannot move forward to hired status until required contract steps are completed.',
];

export default function ContractSeoPage({
  path,
  title,
  description,
  h1,
  headerLabel,
  intro,
  reviewItems,
  faqs,
  extraSections,
  breadcrumbName,
}: ContractSeoPageProps) {
  const navigate = useNavigate();

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Features', item: `${SITE}/features` },
      { '@type': 'ListItem', position: 3, name: breadcrumbName, item: `${SITE}${path}` },
    ],
  };

  const related = RELATED_CONTRACT_PAGES.filter((p) => p.path !== path);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={title}
        description={description}
        path={path}
        jsonLd={[faqJsonLd, breadcrumbJsonLd]}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading whitespace-nowrap overflow-hidden text-ellipsis">
            {headerLabel}
          </h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">{h1}</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">{intro}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/auth')}>
              Start Tracking Smarter <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-xl gap-2" onClick={() => navigate('/features#contract-protection')}>
              Explore Contract Protection
            </Button>
          </div>
        </section>

        {/* Optional extra educational sections */}
        {extraSections?.map((s, i) => (
          <section key={i}>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-6 w-6 text-primary" />
              <h2 className="text-2xl font-black font-heading">{s.heading}</h2>
            </div>
            {typeof s.body === 'string' ? (
              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{s.body}</p>
            ) : (
              s.body
            )}
          </section>
        ))}

        {/* What this helps you review */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">What this helps you review</h2>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {reviewItems.map((item) => (
              <li key={item} className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* How HaulTrackerPro Contract Protection works */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">How HaulTrackerPro Contract Protection works</h2>
          </div>
          <ol className="space-y-3">
            {HOW_IT_WORKS.map((step, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Free vs Pro */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-card space-y-3">
          <h2 className="text-2xl font-black font-heading">Start with basic protection. Use Pro for deeper clause help.</h2>
          <p className="text-muted-foreground leading-relaxed">
            Basic contract viewing, AI-assisted risk flags, approval decisions, and required signature records
            help drivers avoid moving forward blindly. Driver Pro now includes <strong>Plain-English Clause
            Rewrite</strong>, which lets you paste a confusing clause and get a clearer explanation, concern
            points, and questions to ask before approving. Additional tools like contract history, downloadable
            records, AI follow-up support, and version comparison may be added later.
          </p>
          <p className="text-xs text-muted-foreground">
            Plain-English Clause Rewrite and any other AI output is informational only — not legal advice.
            HaulTrackerPro is not a law firm. Consider speaking with a qualified attorney before signing.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="outline" className="rounded-xl" onClick={() => navigate('/pricing')}>
              See pricing
            </Button>
            <Button variant="ghost" className="rounded-xl" onClick={() => navigate('/features#contract-protection')}>
              Compare features
            </Button>
          </div>
        </section>

        {/* Recruiter workflow */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Built for recruiters too</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Recruiters can use HaulTrackerPro to upload contracts, send them to drivers, track approval or
            rejection, and avoid pushing candidates forward before required contract steps are complete.
            Recruiter contract tools are part of the recruiter-paid workflow.
          </p>
          <div className="mt-3">
            <Link to="/recruiters" className="text-sm font-semibold text-primary hover:underline">
              Learn more about recruiter tools →
            </Link>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              AI contract review is informational only. HaulTrackerPro is not a law firm and does not provide
              legal advice. Always read the full contract and consider speaking with a qualified attorney
              before signing important agreements.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center space-y-3 py-4">
          <h2 className="text-2xl font-black font-heading">Ready to protect your next contract?</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/auth')}>
              Start Tracking Smarter <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-xl" onClick={() => navigate('/features#contract-protection')}>
              Explore Contract Protection
            </Button>
          </div>
        </section>

        {/* FAQs */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-xl border border-border bg-card p-4 shadow-card">
                <summary className="cursor-pointer list-none font-semibold flex items-start gap-2">
                  <span className="text-primary mt-0.5">Q.</span>
                  <span>{f.q}</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Internal site links */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-card">
          <h2 className="text-lg font-bold font-heading mb-3">Keep exploring</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link to="/" className="rounded-lg border border-border px-3 py-1.5 hover:border-primary/40">Home</Link>
            <Link to="/features" className="rounded-lg border border-border px-3 py-1.5 hover:border-primary/40">Features</Link>
            <Link to="/pricing" className="rounded-lg border border-border px-3 py-1.5 hover:border-primary/40">Pricing</Link>
            <Link to="/how-to-use-haultrackerpro" className="rounded-lg border border-border px-3 py-1.5 hover:border-primary/40">How to use</Link>
            <Link to="/faq" className="rounded-lg border border-border px-3 py-1.5 hover:border-primary/40">FAQ</Link>
            <Link to="/recruiters" className="rounded-lg border border-border px-3 py-1.5 hover:border-primary/40">For recruiters</Link>
          </div>
        </section>

        {/* Related Contract Guides */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-black font-heading">Related Contract Guides</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {related.map((g) => (
              <Link
                key={g.path}
                to={g.path}
                className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card shadow-card hover:border-primary/40 transition-colors"
              >
                <span className="text-sm font-semibold text-primary">{g.title}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
