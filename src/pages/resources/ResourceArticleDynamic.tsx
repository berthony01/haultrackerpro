import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import SafeMarkdown from '@/components/resources/SafeMarkdown';

interface PublishedArticle {
  id: string;
  slug: string;
  title: string;
  seo_title: string;
  meta_description: string;
  excerpt: string | null;
  content: string;
  topic_cluster: string;
  author_name: string | null;
  published_at: string | null;
  updated_at: string;
}

export default function ResourceArticleDynamic() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<PublishedArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // Phase 26: public RPC excludes ai_generation_prompt and internal fields.
      const { data, error } = await (supabase as any).rpc(
        'get_public_resource_article',
        { _slug: slug },
      );
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) { setNotFound(true); }
      else setArticle(row as PublishedArticle);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (notFound || !article) {
    return (
      <div className="min-h-screen bg-background">
        <SEOHead title="Resource not found | HaulTrackerPro" description="This trucking resource is not available." path={`/resources/${slug ?? ''}`} noindex />
        <main className="px-4 py-12 max-w-2xl mx-auto text-center space-y-4">
          <h1 className="text-2xl font-black font-heading">Resource not found</h1>
          <p className="text-muted-foreground">This article may have been moved or is not yet published.</p>
          <Button onClick={() => navigate('/resources')}>Back to Resources</Button>
        </main>
      </div>
    );
  }

  const path = `/resources/${article.slug}`;
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.seo_title || article.title,
    description: article.meta_description,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { '@type': article.author_name ? 'Person' : 'Organization', name: article.author_name || 'HaulTrackerPro' },
    publisher: { '@type': 'Organization', name: 'HaulTrackerPro' },
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={article.seo_title || article.title}
        description={article.meta_description}
        path={path}
        jsonLd={[
          articleSchema,
          buildBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Resources', path: '/resources' },
            { name: article.title, path },
          ]),
        ]}
      />
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10" onClick={() => navigate('/resources')} aria-label="Back to resources">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading truncate">{article.title}</h1>
        </div>
      </header>
      <main className="px-4 py-8 max-w-3xl mx-auto space-y-6">
        {article.excerpt && <p className="text-lg text-muted-foreground leading-relaxed">{article.excerpt}</p>}
        <article className="max-w-none">
          <SafeMarkdown content={article.content} />
        </article>
        <div className="border-t border-border pt-4 text-xs text-muted-foreground">
          Educational content only. HaulTrackerPro is not a CPA, attorney, or financial advisor. Consult a qualified professional for tax, legal, or financial decisions.
        </div>
        <div className="text-center">
          <Link to="/resources" className="text-sm text-primary hover:underline">← Back to all resources</Link>
        </div>
      </main>
    </div>
  );
}
