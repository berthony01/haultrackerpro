import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPlannedArticleById, buildDraftPrompt, type PlannedArticle } from '@/lib/contentCalendar';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeft, Plus, Sparkles, Loader2, Eye, ExternalLink, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import SafeMarkdown from '@/components/resources/SafeMarkdown';

type Status = 'draft' | 'approved' | 'published' | 'archived';
type Approval = 'pending_review' | 'approved' | 'rejected' | 'needs_revision';

const TOPIC_CLUSTERS = [
  'profit', 'rpm', 'fuel', 'expenses', 'taxes', 'bookkeeping',
  'deadhead', 'contracts', 'recruiter_tools', 'parking', 'load_selection',
] as const;

interface Article {
  id: string;
  slug: string;
  title: string;
  seo_title: string;
  meta_description: string;
  excerpt: string | null;
  content: string;
  topic_cluster: string;
  status: Status;
  approval_status: Approval;
  author_name: string | null;
  generated_by_ai: boolean;
  ai_generation_prompt: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY: Partial<Article> = {
  slug: '', title: '', seo_title: '', meta_description: '', excerpt: '',
  content: '', topic_cluster: 'profit', status: 'draft',
  approval_status: 'pending_review', author_name: '', generated_by_ai: false,
};

function slugify(t: string) {
  return t.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// Map calendar topic clusters onto the generator's allowed cluster list.
function resolveGeneratorCluster(planCluster: string): string {
  const allowed = TOPIC_CLUSTERS as readonly string[];
  const clusterMap: Record<string, string> = { spreadsheets: 'profit', quickbooks: 'bookkeeping' };
  return allowed.includes(planCluster) ? planCluster : (clusterMap[planCluster] ?? 'profit');
}

// Preserve AI-generated FAQ, internal links, and disclaimer by appending
// them to the markdown content so the admin can edit before saving.
function mergeDraftIntoMarkdown(draft: Record<string, unknown>): string {
  let mergedContent = String(draft.content ?? '').trimEnd();
  const faqItems = Array.isArray(draft.faq_items) ? (draft.faq_items as Array<{ q?: unknown; a?: unknown }>) : [];
  const validFaq = faqItems
    .map((f) => ({ q: String(f?.q ?? '').trim(), a: String(f?.a ?? '').trim() }))
    .filter((f) => f.q && f.a);
  if (validFaq.length && !/##\s+Frequently Asked Questions/i.test(mergedContent)) {
    mergedContent += '\n\n## Frequently Asked Questions\n' +
      validFaq.map((f) => `\n### ${f.q}\n\n${f.a}`).join('\n');
  }
  const links = Array.isArray(draft.suggested_internal_links)
    ? (draft.suggested_internal_links as Array<{ label?: unknown; path?: unknown }>) : [];
  const validLinks = links
    .map((l) => ({ label: String(l?.label ?? '').trim(), path: String(l?.path ?? '').trim() }))
    .filter((l) => l.label && l.path.startsWith('/'));
  if (validLinks.length && !/##\s+Related Resources/i.test(mergedContent)) {
    mergedContent += '\n\n## Related Resources\n\n' +
      validLinks.map((l) => `- [${l.label}](${l.path})`).join('\n');
  }
  const disclaimer = String(draft.disclaimer ?? '').trim();
  if (disclaimer && !/##\s+Disclaimer/i.test(mergedContent)) {
    mergedContent += `\n\n## Disclaimer\n\n${disclaimer}`;
  }
  return mergedContent;
}

export default function ResourceArticlesAdmin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { isAdmin, isLoading } = useAdmin();

  const [filter, setFilter] = useState<'all' | Status | 'pending_review' | 'needs_revision'>('all');
  const [rows, setRows] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('edit');
  const [aiOpen, setAiOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Article>>(EMPTY);
  const [safetyChecked, setSafetyChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefillNotice, setPrefillNotice] = useState<{ title: string; duplicateSlug: boolean } | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [justApproved, setJustApproved] = useState(false);
  const [justPublishedSlug, setJustPublishedSlug] = useState<string | null>(null);
  const handledPrefillRef = useRef<string | null>(null);
  const handledCalendarGenerateRef = useRef<string | null>(null);
  const [calendarGenerating, setCalendarGenerating] = useState<string | null>(null);
  const [calendarGenerateError, setCalendarGenerateError] = useState<string | null>(null);

  // AI form
  const [aiTopic, setAiTopic] = useState('');
  const [aiCluster, setAiCluster] = useState<string>('profit');
  const [aiAudience, setAiAudience] = useState('owner-operator');
  const [aiAngle, setAiAngle] = useState('');
  const [aiNotes, setAiNotes] = useState('');
  const [aiKeyword, setAiKeyword] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAdmin) navigate('/', { replace: true });
  }, [isLoading, isAdmin, navigate]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('resource_articles').select('*').order('updated_at', { ascending: false });
    if (filter === 'pending_review') q = q.eq('approval_status', 'pending_review');
    else if (filter === 'needs_revision') q = q.eq('approval_status', 'needs_revision');
    else if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Article[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { if (isAdmin) fetchRows(); }, [isAdmin, fetchRows]);

  const resetEditorTransient = () => {
    setSafetyChecked(false);
    setPrefillNotice(null);
    setEditorTab('edit');
    setRevisionNote('');
    setShowRevisionInput(false);
    setJustApproved(false);
    setJustPublishedSlug(null);
  };

  const openNew = () => {
    setEditing({ ...EMPTY, created_by: user?.id });
    resetEditorTransient();
    setEditorOpen(true);
  };

  const openEdit = (a: Article, tab: 'edit' | 'preview' = 'edit') => {
    setEditing({ ...a });
    resetEditorTransient();
    setEditorTab(tab);
    setEditorOpen(true);
  };

  const buildPrefillFromPlan = useCallback((plan: PlannedArticle): Partial<Article> => {
    const cluster = resolveGeneratorCluster(plan.topic_cluster);

    const seoTitleFull = `${plan.title} | Haul Tracker Pro`;
    const seoTitle = seoTitleFull.length <= 60 ? seoTitleFull : plan.title.slice(0, 60);

    const metaRaw = `${plan.content_angle} For ${plan.target_audience.join(', ')}.`.replace(/\s+/g, ' ').trim();
    const metaDescription = metaRaw.length <= 160 ? metaRaw : metaRaw.slice(0, 157).trimEnd() + '...';

    const excerpt = plan.content_angle.length <= 220
      ? plan.content_angle
      : plan.content_angle.slice(0, 217).trimEnd() + '...';

    const outlineMd = plan.outline_sections.map((s) => `## ${s}\n\nDraft this section. Keep it practical and specific to ${plan.target_audience[0] ?? 'truck drivers'}. Do not invent statistics or cite sources you cannot verify.\n`).join('\n');
    const faqMd = plan.suggested_faqs.map((q) => `### ${q}\n\nDraft a clear, honest answer here. Review for accuracy before approval.\n`).join('\n');
    const linksMd = plan.suggested_internal_links.map((l) => `- [${l.label}](${l.path})`).join('\n');
    const disclaimerMd = plan.disclaimer_required
      ? 'This article is for educational purposes only and is not tax, legal, accounting, or financial advice. Drivers should consult qualified professionals for decisions specific to their business.'
      : 'Haul Tracker Pro is a tracking tool, not a CPA or financial advisor. Use the information here as a starting point and confirm specifics with a qualified professional when needed.';

    const content = [
      `# ${plan.title}`,
      '',
      `Short intro placeholder: ${plan.content_angle}`,
      '',
      '## Why this matters',
      '',
      `Explain why this topic matters to ${plan.target_audience.join(', ')}. Keep claims grounded.`,
      '',
      '## Key points to cover',
      '',
      outlineMd,
      '## Practical example',
      '',
      'Add a simple example using realistic but clearly illustrative numbers. Do not invent industry-wide statistics.',
      '',
      '## How Haul Tracker Pro can help',
      '',
      `Mention the recommended CTA naturally: ${plan.recommended_cta}.`,
      '',
      '## Frequently Asked Questions',
      '',
      faqMd,
      '## Related Resources',
      '',
      linksMd,
      '',
      '## Disclaimer',
      '',
      disclaimerMd,
      '',
    ].join('\n');

    return {
      title: plan.title,
      slug: plan.slug,
      topic_cluster: cluster,
      seo_title: seoTitle,
      meta_description: metaDescription,
      excerpt,
      content,
      author_name: 'Haul Tracker Pro',
      generated_by_ai: false,
      ai_generation_prompt: buildDraftPrompt(plan),
      status: 'draft',
      approval_status: 'pending_review',
      created_by: user?.id,
    };
  }, [user?.id]);

  // Calendar → Article Manager MANUAL handoff. Reads ?new=1&calendarId=<id>
  // (without generate=1), looks up the planned article, opens the editor
  // prefilled with the outline skeleton (never saved).
  useEffect(() => {
    if (!isAdmin) return;
    const isNew = searchParams.get('new') === '1';
    const calendarId = searchParams.get('calendarId');
    const wantsGenerate = searchParams.get('generate') === '1';
    if (!isNew || !calendarId || wantsGenerate) return;
    if (handledPrefillRef.current === calendarId) return;

    const plan = getPlannedArticleById(calendarId);
    if (!plan) {
      handledPrefillRef.current = calendarId;
      toast.error('Calendar article not found. Opening a blank draft.');
      const next = new URLSearchParams(searchParams);
      next.delete('new'); next.delete('calendarId');
      setSearchParams(next, { replace: true });
      return;
    }

    const prefill = buildPrefillFromPlan(plan);
    setEditing(prefill);
    setSafetyChecked(false);
    const duplicateSlug = rows.some((r) => r.slug === plan.slug);
    setPrefillNotice({ title: plan.title, duplicateSlug });
    setEditorOpen(true);
    handledPrefillRef.current = calendarId;

    const next = new URLSearchParams(searchParams);
    next.delete('new'); next.delete('calendarId');
    setSearchParams(next, { replace: true });
  }, [isAdmin, searchParams, setSearchParams, buildPrefillFromPlan, rows]);

  // Calendar → FULL AI DRAFT handoff. Reads ?new=1&calendarId=<id>&generate=1,
  // invokes the existing edge function exactly once with the full calendar brief,
  // and opens the editor with the complete AI article for human review.
  // Never auto-saves, auto-approves, or auto-publishes.
  useEffect(() => {
    if (!isAdmin) return;
    const isNew = searchParams.get('new') === '1';
    const calendarId = searchParams.get('calendarId');
    const wantsGenerate = searchParams.get('generate') === '1';
    if (!isNew || !calendarId || !wantsGenerate) return;
    // StrictMode / double-effect protection: mark handled BEFORE awaiting the
    // network call so AI generation can never be charged twice.
    if (handledCalendarGenerateRef.current === calendarId) return;
    handledCalendarGenerateRef.current = calendarId;

    const clearParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('new'); next.delete('calendarId'); next.delete('generate');
      setSearchParams(next, { replace: true });
    };

    const plan = getPlannedArticleById(calendarId);
    if (!plan) {
      toast.error('Calendar article not found. No AI article was created.');
      clearParams();
      return;
    }

    const cluster = resolveGeneratorCluster(plan.topic_cluster);
    setCalendarGenerateError(null);
    setCalendarGenerating(plan.title);
    clearParams();

    void (async () => {
      const { data, error } = await supabase.functions.invoke('generate-resource-article-draft', {
        body: {
          topic: plan.title,
          audience: plan.target_audience.join(', '),
          topic_cluster: cluster,
          angle: plan.content_angle,
          target_keyword: plan.primary_keyword,
          notes: `Search intent: ${plan.search_intent}. Recommended CTA: ${plan.recommended_cta}.`,
          related_links: plan.suggested_internal_links.map((l) => l.path),
          calendar_brief: {
            title: plan.title,
            slug: plan.slug,
            primary_keyword: plan.primary_keyword,
            secondary_keywords: plan.secondary_keywords,
            target_audience: plan.target_audience,
            search_intent: plan.search_intent,
            content_angle: plan.content_angle,
            outline_sections: plan.outline_sections,
            suggested_faqs: plan.suggested_faqs,
            suggested_internal_links: plan.suggested_internal_links,
            recommended_cta: plan.recommended_cta,
            disclaimer_required: plan.disclaimer_required,
          },
        },
      });
      setCalendarGenerating(null);

      if (error) {
        const msg = error.message || 'Full AI generation failed. No AI article was created.';
        setCalendarGenerateError(msg);
        toast.error('Full AI generation failed. No AI article was created.', {
          description: 'You can retry, or use Open Manual Draft from the content calendar.',
        });
        return;
      }

      const d = (data as { draft?: Record<string, unknown>; ai_generation_prompt?: string }) ?? {};
      const draft = (d.draft ?? {}) as Record<string, unknown>;
      const mergedContent = mergeDraftIntoMarkdown(draft);
      if (!String(draft.title ?? '').trim() || !mergedContent.trim()) {
        setCalendarGenerateError('The AI response was incomplete. No AI article was created.');
        toast.error('Full AI generation failed. No AI article was created.', {
          description: 'The response was incomplete. Use Open Manual Draft as a fallback.',
        });
        return;
      }

      setEditing({
        ...EMPTY,
        title: String(draft.title ?? plan.title),
        slug: slugify(String(draft.slug ?? plan.slug)),
        seo_title: String(draft.seo_title ?? '').slice(0, 60),
        meta_description: String(draft.meta_description ?? '').slice(0, 160),
        excerpt: String(draft.excerpt ?? ''),
        content: mergedContent,
        topic_cluster: cluster,
        author_name: 'Haul Tracker Pro',
        generated_by_ai: true,
        ai_generation_prompt: d.ai_generation_prompt ?? buildDraftPrompt(plan),
        status: 'draft',
        approval_status: 'pending_review',
        created_by: user?.id,
      });
      setSafetyChecked(false);
      setPrefillNotice({
        title: plan.title,
        duplicateSlug: rows.some((r) => r.slug === plan.slug),
      });
      setEditorOpen(true);
      toast.success('Full AI draft generated. Review carefully before approving.');
    })();
  }, [isAdmin, searchParams, setSearchParams, rows, user?.id]);


  const canPublish = useMemo(() => {
    const e = editing;
    return Boolean(
      e.title && e.slug && e.seo_title && e.meta_description &&
      e.excerpt && e.content && e.topic_cluster &&
      e.approval_status === 'approved' && safetyChecked
    );
  }, [editing, safetyChecked]);

  const requiredOk = useMemo(() => {
    const e = editing;
    return Boolean(e.title && e.slug && e.seo_title && e.meta_description && e.content && e.topic_cluster);
  }, [editing]);

  const save = async (override?: Partial<Article>, opts?: { silent?: boolean }) => {
    const payload = { ...editing, ...(override ?? {}) };
    if (!payload.title || !payload.slug) {
      toast.error('Title and slug are required');
      return null;
    }
    setSaving(true);
    const upsertData = {
      slug: payload.slug,
      title: payload.title,
      seo_title: payload.seo_title ?? '',
      meta_description: payload.meta_description ?? '',
      excerpt: payload.excerpt ?? '',
      content: payload.content ?? '',
      topic_cluster: payload.topic_cluster ?? 'profit',
      status: payload.status ?? 'draft',
      approval_status: payload.approval_status ?? 'pending_review',
      author_name: payload.author_name ?? null,
      generated_by_ai: !!payload.generated_by_ai,
      ai_generation_prompt: payload.ai_generation_prompt ?? null,
      reviewed_by: payload.reviewed_by ?? null,
      reviewed_at: payload.reviewed_at ?? null,
      published_at: payload.published_at ?? null,
      created_by: payload.created_by ?? user?.id ?? null,
    };
    let res;
    if (payload.id) {
      res = await supabase.from('resource_articles').update(upsertData).eq('id', payload.id).select().maybeSingle();
    } else {
      res = await supabase.from('resource_articles').insert(upsertData).select().maybeSingle();
    }
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return null; }
    if (!opts?.silent) toast.success('Saved');
    setEditing(res.data as Article);
    fetchRows();
    return res.data as Article;
  };

  const setApproval = async (approval_status: Approval) => {
    const updates: Partial<Article> = { approval_status };
    if (approval_status === 'approved') {
      updates.status = 'approved';
      updates.reviewed_by = user?.id ?? null;
      updates.reviewed_at = new Date().toISOString();
    }
    const result = await save(updates, { silent: true });
    if (!result) return;
    if (approval_status === 'approved') {
      setJustApproved(true);
      setShowRevisionInput(false);
      toast.success('Approved — ready to publish', {
        description: 'Tick the safety checklist, then click Publish.',
      });
    } else if (approval_status === 'needs_revision') {
      setJustApproved(false);
      toast.warning('Marked as needs revision', {
        description: revisionNote ? 'Note saved for this session.' : undefined,
      });
    } else {
      toast.success('Saved');
    }
  };

  const publish = async () => {
    if (!canPublish) {
      toast.error('Approve, fill all required fields, and confirm review first.');
      return;
    }
    const result = await save({
      status: 'published',
      published_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    }, { silent: true });
    if (!result) return;
    setJustPublishedSlug(result.slug);
    setJustApproved(false);
    const liveUrl = `/resources/${result.slug}`;
    toast.success('Published', {
      description: 'Live now at ' + liveUrl,
      action: {
        label: 'Open live page',
        onClick: () => window.open(liveUrl, '_blank', 'noopener,noreferrer'),
      },
    });
  };

  const archive = async () => { await save({ status: 'archived' }); };

  const runAi = async () => {
    if (!aiTopic.trim()) { toast.error('Topic required'); return; }
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke('generate-resource-article-draft', {
      body: {
        topic: aiTopic, audience: aiAudience, topic_cluster: aiCluster,
        angle: aiAngle, notes: aiNotes, target_keyword: aiKeyword,
      },
    });
    setAiBusy(false);
    if (error) {
      toast.error(error.message || 'AI draft generation is not configured yet. You can still create articles manually.');
      return;
    }
    const d = (data as { draft?: Record<string, unknown>; ai_generation_prompt?: string }) ?? {};
    const draft = (d.draft ?? {}) as Record<string, unknown>;

    const mergedContent = mergeDraftIntoMarkdown(draft);

    setEditing({
      ...EMPTY,
      title: String(draft.title ?? ''),
      slug: slugify(String(draft.slug ?? draft.title ?? '')),
      seo_title: String(draft.seo_title ?? '').slice(0, 60),
      meta_description: String(draft.meta_description ?? '').slice(0, 160),
      excerpt: String(draft.excerpt ?? ''),
      content: mergedContent,
      topic_cluster: aiCluster,
      generated_by_ai: true,
      ai_generation_prompt: d.ai_generation_prompt ?? null,
      status: 'draft',
      approval_status: 'pending_review',
      created_by: user?.id,
    });
    setSafetyChecked(false);
    setAiOpen(false);
    setEditorOpen(true);
    toast.success('Draft generated. Review carefully before approving.');
  };


  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="Resource Articles Admin" description="Admin-only resource article manager" path="/admin/resource-articles" noindex />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-6xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading flex-1">Resource Articles</h1>
          <Button variant="outline" className="rounded-xl" onClick={() => setAiOpen(true)}>
            <Sparkles className="h-4 w-4 mr-1" /> AI Draft
          </Button>
          <Button className="rounded-xl" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> New Draft
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-6xl mx-auto space-y-4">
        {calendarGenerating && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Generating full AI article… ({calendarGenerating}) The editor opens automatically when it is ready.</span>
          </div>
        )}

        {calendarGenerateError && !calendarGenerating && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
            <div className="font-semibold text-destructive">Full AI generation failed — no AI article was created.</div>
            <p className="text-muted-foreground">
              {calendarGenerateError} Nothing was saved. Retry from the content calendar, or use <strong>Open Manual Draft</strong> for the outline fallback.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Label>Filter:</Label>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_review">Pending review</SelectItem>
              <SelectItem value="needs_revision">Needs revision</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader><CardTitle>Articles ({rows.length})</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground">No articles yet. Create a draft to get started.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>AI</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-muted-foreground">/{a.slug}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{a.topic_cluster}</Badge></TableCell>
                      <TableCell><Badge>{a.status}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{a.approval_status}</Badge></TableCell>
                      <TableCell>{a.generated_by_ai ? 'Yes' : '—'}</TableCell>
                      <TableCell className="text-xs">{a.published_at ? new Date(a.published_at).toLocaleDateString() : '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(a, 'preview')}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openEdit(a)}>Edit</Button>
                          {a.status === 'published' && (
                            <Button size="sm" variant="ghost" asChild>
                              <a href={`/resources/${a.slug}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Live
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Editor */}
      <Dialog open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) resetEditorTransient(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing.id ? 'Edit article' : 'New article draft'}</DialogTitle>
          </DialogHeader>

          {/* Status row — always visible right under the title */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                editing.status === 'published' ? 'default'
                : editing.status === 'archived' ? 'outline'
                : 'secondary'
              }
            >
              Status: {editing.status ?? 'draft'}
            </Badge>
            <Badge
              variant={
                editing.approval_status === 'approved' ? 'default'
                : editing.approval_status === 'needs_revision' || editing.approval_status === 'rejected' ? 'destructive'
                : 'secondary'
              }
            >
              Approval: {editing.approval_status ?? 'pending_review'}
            </Badge>
            {editing.generated_by_ai && <Badge variant="outline">AI-assisted</Badge>}
            {editing.id && editing.status === 'published' && editing.slug && (
              <a
                href={`/resources/${editing.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open live page
              </a>
            )}
          </div>

          {justPublishedSlug && (
            <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="flex-1">Published successfully.</span>
              <a
                href={`/resources/${justPublishedSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open live page
              </a>
            </div>
          )}

          {justApproved && !justPublishedSlug && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span>Approved. Tick the safety checklist below, then click <strong>Publish</strong>.</span>
            </div>
          )}

          {(editing.approval_status === 'needs_revision' || showRevisionInput) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
              <div className="font-semibold text-destructive">
                {editing.approval_status === 'needs_revision' ? 'Needs revision' : 'Add a revision note (optional)'}
              </div>
              <Textarea
                rows={2}
                placeholder="Optional: note what needs to change (session-only, not saved to DB)"
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
              />
            </div>
          )}

          {prefillNotice && !editing.id && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="default">Calendar Draft Prefill</Badge>
                {prefillNotice.duplicateSlug && <Badge variant="destructive">Possible duplicate slug</Badge>}
              </div>
              <p className="text-muted-foreground">
                This draft was prefilled from the content calendar ({prefillNotice.title}). Review, edit, and save it as a draft before approval or publishing.
              </p>
              {prefillNotice.duplicateSlug && (
                <p className="text-destructive text-xs">
                  An article with this slug may already exist. Review existing drafts before saving to avoid overwriting.
                </p>
              )}
            </div>
          )}

          <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as 'edit' | 'preview')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1" /> Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="space-y-3 mt-3">
              <div>
                <Label>Title *</Label>
                <Input value={editing.title ?? ''} onChange={(e) => {
                  const v = e.target.value;
                  setEditing((p) => ({ ...p, title: v, slug: p.slug || slugify(v) }));
                }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Slug *</Label>
                  <Input value={editing.slug ?? ''} onChange={(e) => setEditing((p) => ({ ...p, slug: slugify(e.target.value) }))} />
                </div>
                <div>
                  <Label>Topic cluster *</Label>
                  <Select value={editing.topic_cluster ?? 'profit'} onValueChange={(v) => setEditing((p) => ({ ...p, topic_cluster: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TOPIC_CLUSTERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>SEO title * <span className="text-xs text-muted-foreground">(max 60)</span></Label>
                <Input maxLength={60} value={editing.seo_title ?? ''} onChange={(e) => setEditing((p) => ({ ...p, seo_title: e.target.value }))} />
              </div>
              <div>
                <Label>Meta description * <span className="text-xs text-muted-foreground">(max 160)</span></Label>
                <Textarea maxLength={160} rows={2} value={editing.meta_description ?? ''} onChange={(e) => setEditing((p) => ({ ...p, meta_description: e.target.value }))} />
              </div>
              <div>
                <Label>Excerpt</Label>
                <Textarea rows={2} value={editing.excerpt ?? ''} onChange={(e) => setEditing((p) => ({ ...p, excerpt: e.target.value }))} />
              </div>
              <div>
                <Label>Content * (Markdown)</Label>
                <Textarea rows={14} className="font-mono text-sm" value={editing.content ?? ''} onChange={(e) => setEditing((p) => ({ ...p, content: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Author name</Label>
                  <Input value={editing.author_name ?? ''} onChange={(e) => setEditing((p) => ({ ...p, author_name: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch checked={!!editing.generated_by_ai} onCheckedChange={(v) => setEditing((p) => ({ ...p, generated_by_ai: v }))} />
                  <Label>Generated by AI</Label>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <div className="font-semibold">Pre-publish safety checklist</div>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>No fake statistics, quotes, or citations</li>
                  <li>No guaranteed profit / savings / tax / legal claims</li>
                  <li>Includes disclaimer where tax/legal/financial topics are discussed</li>
                  <li>Useful even if reader does not sign up</li>
                  <li>Internal links are relevant; meta title/description are accurate</li>
                </ul>
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox id="safety" checked={safetyChecked} onCheckedChange={(v) => setSafetyChecked(!!v)} />
                  <Label htmlFor="safety">I reviewed this article for accuracy and safe claims.</Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-3">
              <div className="rounded-lg border border-border bg-background p-4 space-y-4">
                <div className="text-xs text-muted-foreground border-b border-border pb-2">
                  Preview of how this article will render on <code>/resources/{editing.slug || '…'}</code>
                </div>
                <h2 className="text-2xl font-black font-heading">{editing.title || 'Untitled'}</h2>
                {editing.excerpt && (
                  <p className="text-base text-muted-foreground leading-relaxed">{editing.excerpt}</p>
                )}
                <SafeMarkdown content={editing.content ?? ''} />
                <div className="border-t border-border pt-3 text-xs text-muted-foreground space-y-1">
                  <div><strong>SEO title:</strong> {editing.seo_title || '—'}</div>
                  <div><strong>Meta description:</strong> {editing.meta_description || '—'}</div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <TooltipProvider>
            <DialogFooter className="flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="outline" onClick={() => save()} disabled={saving}>Save Draft</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Save current edits without changing approval status.</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!showRevisionInput && editing.approval_status !== 'needs_revision') {
                          setShowRevisionInput(true);
                          return;
                        }
                        setApproval('needs_revision');
                      }}
                      disabled={saving}
                    >
                      {(showRevisionInput || editing.approval_status === 'needs_revision')
                        ? 'Confirm Needs Revision'
                        : 'Mark Needs Revision'}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Flag this article for rework. Optional note is session-only.</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      onClick={() => setApproval('approved')}
                      disabled={saving || !requiredOk}
                    >
                      Approve
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {!requiredOk
                    ? 'Fill in title, slug, SEO title, meta description, content, and cluster first.'
                    : 'Mark as approved so it can be published.'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={publish}
                      disabled={saving || !canPublish}
                      className={justApproved ? 'ring-2 ring-primary ring-offset-2 animate-pulse' : ''}
                    >
                      Publish
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {!canPublish
                    ? 'Approve the article and tick the safety checklist first.'
                    : 'Publish live to /resources/' + (editing.slug ?? '')}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="destructive" onClick={archive} disabled={saving || !editing.id}>Archive</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Remove from public view. Reversible by editing status back to draft.</TooltipContent>
              </Tooltip>
            </DialogFooter>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      {/* AI dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Generate AI draft</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Drafts are never auto-published. You must review, approve, and confirm the safety checklist.
            </p>
            <div>
              <Label>Topic *</Label>
              <Input value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="e.g. How owner-operators can lower deadhead miles" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Topic cluster *</Label>
                <Select value={aiCluster} onValueChange={setAiCluster}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TOPIC_CLUSTERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Audience</Label>
                <Input value={aiAudience} onChange={(e) => setAiAudience(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Angle</Label>
              <Input value={aiAngle} onChange={(e) => setAiAngle(e.target.value)} />
            </div>
            <div>
              <Label>Target keyword</Label>
              <Input value={aiKeyword} onChange={(e) => setAiKeyword(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={aiNotes} onChange={(e) => setAiNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button onClick={runAi} disabled={aiBusy}>
              {aiBusy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating</> : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
