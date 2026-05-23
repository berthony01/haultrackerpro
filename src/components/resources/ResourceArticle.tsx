import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

export interface ResourceCTA {
  label: string;
  to: string;
  variant?: 'default' | 'outline';
}

export interface ResourceSection {
  heading: string;
  body?: string;
  bullets?: string[];
}

export interface ResourceArticleProps {
  path: string;
  seoTitle: string;
  seoDescription: string;
  pageTitle: string;
  intro: string;
  sections: ResourceSection[];
  disclaimer?: string;
  ctas: ResourceCTA[];
  related?: { to: string; title: string }[];
  ctaTitle?: string;
  ctaDescription?: string;
}

export default function ResourceArticle({
  path,
  seoTitle,
  seoDescription,
  pageTitle,
  intro,
  sections,
  disclaimer,
  ctas,
  related,
  ctaTitle,
  ctaDescription,
}: ResourceArticleProps) {
  const navigate = useNavigate();

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: pageTitle,
      description: seoDescription,
      author: { '@type': 'Organization', name: 'HaulTrackerPro' },
      publisher: { '@type': 'Organization', name: 'HaulTrackerPro' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://haultrackerpro.com/' },
        { '@type': 'ListItem', position: 2, name: 'Resources', item: 'https://haultrackerpro.com/resources' },
        { '@type': 'ListItem', position: 3, name: pageTitle, item: `https://haultrackerpro.com${path}` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title={seoTitle} description={seoDescription} path={path} jsonLd={jsonLd} />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl h-10 w-10 shrink-0"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading truncate">{pageTitle}</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-10">
        <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-primary">Home</Link>
          <span className="mx-1">/</span>
          <Link to="/resources" className="hover:text-primary">Resources</Link>
          <span className="mx-1">/</span>
          <span className="text-foreground">{pageTitle}</span>
        </nav>

        <section className="space-y-3">
          <h2 className="text-3xl font-black font-heading">{pageTitle}</h2>
          <p className="text-muted-foreground leading-relaxed">{intro}</p>
        </section>

        {sections.map((s) => (
          <section key={s.heading} className="space-y-3">
            <h3 className="text-xl font-bold font-heading">{s.heading}</h3>
            {s.body && <p className="text-muted-foreground leading-relaxed">{s.body}</p>}
            {s.bullets && (
              <ul className="space-y-2">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {disclaimer && (
          <section className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground leading-relaxed">
            {disclaimer}
          </section>
        )}

        <section className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-4">
          <h3 className="text-xl font-black font-heading">Get clearer numbers on every load</h3>
          <div className="flex flex-wrap justify-center gap-3">
            {ctas.map((c) => (
              <Button
                key={c.label}
                size="lg"
                variant={c.variant ?? 'default'}
                className="rounded-xl gap-2"
                onClick={() => navigate(c.to)}
              >
                {c.label} <ArrowRight className="h-4 w-4" />
              </Button>
            ))}
          </div>
        </section>

        {related && related.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-lg font-bold font-heading">Related guides</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {related.map((r) => (
                <Link
                  key={r.to}
                  to={r.to}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border bg-card shadow-sm hover:border-primary/40 transition-colors"
                >
                  <span className="text-sm font-semibold">{r.title}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
            <div className="text-xs text-muted-foreground pt-2">
              See also: <Link to="/" className="text-primary hover:underline">Home</Link> ·{' '}
              <Link to="/pricing" className="text-primary hover:underline">Pricing</Link> ·{' '}
              <Link to="/faq" className="text-primary hover:underline">FAQ</Link> ·{' '}
              <Link to="/recruiters" className="text-primary hover:underline">For Recruiters</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
