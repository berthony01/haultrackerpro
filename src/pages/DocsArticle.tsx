import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DOCS_CATEGORY_LABELS,
  type DocsAudience,
} from '@/lib/docs/docsRegistry';
import {
  articleRoute,
  getArticleBySlug,
  type CalloutTone,
  type DocsArticle,
  type DocsArticleCallout,
  type DocsArticleSection,
} from '@/lib/docs/docsArticles';

const AUDIENCE_LABELS: Readonly<Record<DocsAudience, string>> = {
  driver: 'Drivers',
  recruiter: 'Recruiters',
  driver_assistant: 'Driver Assistants',
  agency: 'Agencies',
  all: 'All roles',
};

function CalloutBlock({ callout }: { callout: DocsArticleCallout }) {
  const tone: CalloutTone = callout.tone;
  const styles =
    tone === 'important'
      ? 'border-primary/40 bg-primary/5'
      : tone === 'caution'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-border bg-muted/30';
  const Icon = tone === 'important' ? ShieldAlert : tone === 'caution' ? AlertTriangle : Info;
  const iconColor =
    tone === 'important' ? 'text-primary' : tone === 'caution' ? 'text-amber-500' : 'text-muted-foreground';
  return (
    <div className={`rounded-lg border ${styles} p-4 my-4`} role="note">
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${iconColor}`} aria-hidden="true" />
        <div>
          <p className="font-semibold text-sm mb-1">{callout.title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{callout.body}</p>
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: DocsArticleSection }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl sm:text-2xl font-semibold mb-3 text-primary">{section.heading}</h2>
      {section.paragraphs?.map((p, i) => (
        <p key={`p-${i}`} className="text-base text-foreground/90 leading-relaxed mb-3">
          {p}
        </p>
      ))}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="list-disc pl-6 space-y-2 my-3 text-base text-foreground/90">
          {section.bullets.map((b, i) => (
            <li key={`b-${i}`} className="leading-relaxed">
              {b}
            </li>
          ))}
        </ul>
      )}
      {section.callouts?.map((c, i) => <CalloutBlock key={`c-${i}`} callout={c} />)}
    </section>
  );
}

function ArticleNotFound({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="Article not found | HaulTrackerPro Docs"
        description="The requested help article could not be found. Return to the Help Center to browse available guides."
        path={`/docs/${slug}`}
        noindex
      />
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <BookOpen className="h-10 w-10 text-primary mx-auto mb-4" aria-hidden="true" />
        <h1 className="text-2xl sm:text-3xl font-bold mb-3">This help article isn’t available</h1>
        <p className="text-muted-foreground mb-6">
          We couldn’t find a documentation article for that link. It may have moved, or the URL may be
          mistyped.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/docs">Back to Help Center</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Return home</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

function ArticleView({ article }: { article: DocsArticle }) {
  const path = articleRoute(article.slug);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title={`${article.title} | HaulTrackerPro Docs`}
        description={article.summary}
        path={path}
      />

      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <Link
            to="/docs"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Help Center
          </Link>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Product documentation
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <div className="mb-6 flex flex-wrap gap-2">
          <Badge variant="secondary">{DOCS_CATEGORY_LABELS[article.category]}</Badge>
          {article.audiences.map((a) => (
            <Badge key={a} variant="outline">
              {AUDIENCE_LABELS[a]}
            </Badge>
          ))}
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">{article.title}</h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-4">{article.summary}</p>
        <p className="text-xs text-muted-foreground mb-8">
          Reviewed for product accuracy:{' '}
          <time dateTime={article.reviewedForProductAccuracy}>
            {article.reviewedForProductAccuracy}
          </time>
          . Product documentation — not legal advice. Current Terms of Service and Privacy Policy control
          where applicable.
        </p>

        <article className="prose-none">
          {article.sections.map((s, i) => (
            <SectionBlock key={`s-${i}`} section={s} />
          ))}

          {article.callouts && article.callouts.length > 0 && (
            <section className="mt-8">
              {article.callouts.map((c, i) => <CalloutBlock key={`ac-${i}`} callout={c} />)}
            </section>
          )}
        </article>

        {article.relatedRoutes && article.relatedRoutes.length > 0 && (
          <section aria-labelledby="related-links" className="mt-10 border-t border-border/60 pt-6">
            <h2 id="related-links" className="text-lg font-semibold mb-3">
              Related
            </h2>
            <ul className="space-y-2">
              {article.relatedRoutes.map((r) => (
                <li key={r.route}>
                  <Link to={r.route} className="text-primary underline">
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/docs">Back to Help Center</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/legal">Legal Center</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

const DocsArticlePage = () => {
  const { articleSlug } = useParams<{ articleSlug: string }>();
  const slug = articleSlug ?? '';
  const article = getArticleBySlug(slug);
  if (!article) return <ArticleNotFound slug={slug} />;
  return <ArticleView article={article} />;
};

export default DocsArticlePage;
