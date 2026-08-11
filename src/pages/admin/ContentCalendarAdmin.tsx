import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from '@/hooks/useAdmin';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Copy, ExternalLink, ShieldAlert, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONTENT_CALENDAR,
  CALENDAR_SUMMARY,
  buildDraftPrompt,
  type PlannedArticle,
} from '@/lib/contentCalendar';

export default function ContentCalendarAdmin() {
  const navigate = useNavigate();
  const { isAdmin, isLoading } = useAdmin();
  const [clusterFilter, setClusterFilter] = useState<string>('all');

  useEffect(() => {
    if (!isLoading && !isAdmin) navigate('/', { replace: true });
  }, [isLoading, isAdmin, navigate]);

  const filtered = useMemo(() => {
    if (clusterFilter === 'all') return CONTENT_CALENDAR;
    return CONTENT_CALENDAR.filter((a) => a.topic_cluster === clusterFilter);
  }, [clusterFilter]);

  const byWeek = useMemo(() => {
    const map = new Map<number, PlannedArticle[]>();
    filtered.forEach((a) => {
      const arr = map.get(a.week) ?? [];
      arr.push(a);
      map.set(a.week, arr);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const copyPrompt = async (a: PlannedArticle) => {
    const text = buildDraftPrompt(a);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('AI draft prompt copied. Paste into the Article Manager.');
    } catch {
      toast.error('Copy failed. Select and copy manually.');
    }
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Content Calendar Admin"
        description="Admin-only 12-week SEO content calendar."
        path="/admin/content-calendar"
        noindex
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-6xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold font-heading">12-Week SEO Content Calendar</h1>
            <p className="text-xs text-muted-foreground">
              Plan, review, and turn trucking SEO topics into approved article drafts.
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/admin/resource-articles">
              <ExternalLink className="h-4 w-4 mr-1" /> Article Manager
            </Link>
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-6xl mx-auto space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Weeks" value={String(CALENDAR_SUMMARY.total_weeks)} />
          <SummaryCard label="Planned articles" value={String(CALENDAR_SUMMARY.total_articles)} />
          <SummaryCard label="Per week" value={String(CALENDAR_SUMMARY.articles_per_week)} />
          <SummaryCard label="Clusters" value={String(CALENDAR_SUMMARY.main_clusters.length)} />
          <SummaryCard label="Approval" value="Manual" />
        </div>

        {/* Content safety rules */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="flex flex-row items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Content Safety Rules</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <ul className="list-disc pl-5 space-y-1">
              <li>Do not publish AI content without review.</li>
              <li>Do not invent statistics, quotes, studies, or citations.</li>
              <li>Do not promise guaranteed profit, savings, tax deductions, legal protection, or ranking results.</li>
              <li>Add disclaimers for tax, legal, financial, contract, or accounting topics.</li>
              <li>Keep articles useful even if the reader does not sign up.</li>
              <li>Use internal links naturally.</li>
              <li>Update sitemap and llms.txt manually after publishing until dynamic sitemap generation is built.</li>
            </ul>
          </CardContent>
        </Card>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filter by cluster:</span>
          <Select value={clusterFilter} onValueChange={setClusterFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clusters</SelectItem>
              {CALENDAR_SUMMARY.main_clusters.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Week-by-week */}
        <div className="space-y-6">
          {byWeek.map(([week, articles]) => (
            <section key={week} className="space-y-3">
              <h2 className="text-xl font-bold font-heading">
                Week {week}
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {articles.map((a) => (
                  <ArticleCard key={a.id} a={a} onCopy={() => copyPrompt(a)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-2xl font-black font-heading mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function ArticleCard({ a, onCopy }: { a: PlannedArticle; onCopy: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">Week {a.week}</Badge>
          <Badge variant="outline">{a.recommended_publish_day}</Badge>
          <Badge>{a.topic_cluster}</Badge>
          <Badge variant={a.priority === 'high' ? 'default' : 'secondary'}>
            {a.priority} priority
          </Badge>
          {a.disclaimer_required && <Badge variant="destructive">Disclaimer</Badge>}
        </div>
        <CardTitle className="text-base mt-2 leading-snug">{a.title}</CardTitle>
        <p className="text-xs text-muted-foreground font-mono">/{a.slug}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 text-sm">
        <Field label="Primary keyword" value={a.primary_keyword} />
        {a.secondary_keywords.length > 0 && (
          <Field label="Secondary keywords" value={a.secondary_keywords.join(', ')} />
        )}
        <Field label="Audience" value={a.target_audience.join(', ')} />
        <Field label="Search intent" value={a.search_intent} />
        <Field label="Content angle" value={a.content_angle} />

        <details className="rounded-md border border-border bg-muted/30 p-2">
          <summary className="text-xs font-semibold cursor-pointer">Outline ({a.outline_sections.length})</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-muted-foreground">
            {a.outline_sections.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </details>

        <details className="rounded-md border border-border bg-muted/30 p-2">
          <summary className="text-xs font-semibold cursor-pointer">Suggested FAQs ({a.suggested_faqs.length})</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-muted-foreground">
            {a.suggested_faqs.map((q) => <li key={q}>{q}</li>)}
          </ul>
        </details>

        <details className="rounded-md border border-border bg-muted/30 p-2">
          <summary className="text-xs font-semibold cursor-pointer">Internal links ({a.suggested_internal_links.length})</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-muted-foreground">
            {a.suggested_internal_links.map((l) => (
              <li key={l.path}><span className="font-medium">{l.label}</span> — <span className="font-mono">{l.path}</span></li>
            ))}
          </ul>
        </details>

        <Field label="Recommended CTA" value={a.recommended_cta} />
      </CardContent>
      <div className="px-6 pb-4 flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link to={`/admin/resource-articles?new=1&calendarId=${encodeURIComponent(a.id)}&generate=1`}>
            <Sparkles className="h-4 w-4 mr-1" /> Generate Full AI Draft
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={onCopy}>
          <Copy className="h-4 w-4 mr-1" /> Copy AI Draft Prompt
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to={`/admin/resource-articles?new=1&calendarId=${encodeURIComponent(a.id)}`}>
            <ExternalLink className="h-4 w-4 mr-1" /> Open Manual Draft
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
