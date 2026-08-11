import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, BookOpen, AlertTriangle, ExternalLink } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DOCS_CATEGORY_LABELS,
  getDocsByCategory,
  isDocsEntryLinkable,
  searchDocs,
  type DocsCategory,
  type DocsEntry,
} from '@/lib/docs/docsRegistry';

const DocsEntryCard = ({ entry }: { entry: DocsEntry }) => {
  const linkable = isDocsEntryLinkable(entry);
  const inner = (
    <Card
      className={
        'h-full transition-shadow ' +
        (linkable ? 'hover:shadow-lg border-primary/20' : 'opacity-80 border-dashed')
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{entry.title}</CardTitle>
          {linkable ? (
            <Badge variant="secondary" className="shrink-0">Guide</Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">Coming soon</Badge>
          )}
        </div>
        <CardDescription className="text-sm leading-relaxed">
          {entry.description}
        </CardDescription>
      </CardHeader>
      {linkable && (
        <CardContent className="pt-0">
          <span className="inline-flex items-center text-sm font-medium text-primary">
            Open guide <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </CardContent>
      )}
    </Card>
  );

  if (linkable && entry.route) {
    return (
      <Link to={entry.route} aria-label={`Open ${entry.title}`} className="block h-full">
        {inner}
      </Link>
    );
  }

  return (
    <div
      role="group"
      aria-label={`${entry.title} — coming soon`}
      aria-disabled="true"
      className="block h-full cursor-not-allowed"
    >
      {inner}
    </div>
  );
};

const Docs = () => {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchDocs(query), [query]);
  const grouped = useMemo(() => getDocsByCategory(), []);
  const isSearching = query.trim().length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="Documentation & Help Center | HaulTrackerPro"
        description="Guides for drivers, recruiters, driver assistants and agencies using HaulTrackerPro. Search real product documentation and see what's still in preparation."
        path="/docs"
      />

      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to home
          </Link>
          <Link to="/legal" className="text-sm text-muted-foreground hover:text-primary">
            Legal Center →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Documentation & Help Center
            </h1>
          </div>
          <p className="max-w-3xl text-base sm:text-lg text-muted-foreground leading-relaxed">
            Guides are organized by role — <strong>drivers</strong>,{' '}
            <strong>recruiters</strong>, <strong>driver assistants</strong> and{' '}
            <strong>agencies</strong> — plus billing, account, AI/OCR,{' '}
            <strong>settlement statements and reconciliation</strong>, and opportunity topics.
            Live guides link directly to the product. Items marked{' '}
            <em>Coming soon</em> are being prepared and are not clickable yet.
          </p>
        </section>

        <section className="mb-8">
          <label htmlFor="docs-search" className="sr-only">
            Search documentation
          </label>
          <div className="relative max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="docs-search"
              type="search"
              placeholder="Search guides by title, topic or role…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </section>

        {isSearching ? (
          <section aria-label="Search results">
            <h2 className="text-lg font-semibold mb-4">
              {results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”
            </h2>
            {results.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <p className="text-base">
                    No guides matched that search yet.
                  </p>
                  <p className="text-sm mt-2">
                    Try a different keyword, or{' '}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => setQuery('')}
                    >
                      clear the search
                    </button>
                    .
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map((entry) => (
                  <DocsEntryCard key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </section>
        ) : (
          (Object.keys(grouped) as DocsCategory[]).map((cat) => {
            const entries = grouped[cat];
            if (entries.length === 0) return null;
            return (
              <section key={cat} className="mb-10" aria-labelledby={`docs-cat-${cat}`}>
                <h2
                  id={`docs-cat-${cat}`}
                  className="text-xl font-semibold mb-4 text-primary"
                >
                  {DOCS_CATEGORY_LABELS[cat]}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {entries.map((entry) => (
                    <DocsEntryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            );
          })
        )}

        <section
          aria-labelledby="docs-limitations"
          className="mt-14 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="docs-limitations" className="text-lg font-semibold mb-2">
                Important limitations
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                HaulTrackerPro is a productivity and record-keeping tool. Calculations,
                AI and OCR output, extracted opportunities, contract review results,
                parking reports and tax estimates are provided for convenience only and
                must be independently reviewed by you before you rely on them for
                financial, legal, safety or tax decisions.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                For the terms governing use of the product, see the{' '}
                <Link to="/terms" className="text-primary underline">Terms of Service</Link>{' '}
                and the{' '}
                <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
                Additional policies are being prepared — see the{' '}
                <Link to="/legal" className="text-primary underline">Legal Center</Link>.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/legal">Legal Center</Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Docs;
