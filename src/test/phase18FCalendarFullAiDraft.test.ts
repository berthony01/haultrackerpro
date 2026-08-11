import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CALENDAR_UI = read('src/pages/admin/ContentCalendarAdmin.tsx');
const ARTICLES_UI = read('src/pages/admin/ResourceArticlesAdmin.tsx');
const EDGE_FN = read('supabase/functions/generate-resource-article-draft/index.ts');
const CALENDAR_LIB = read('src/lib/contentCalendar.ts');

describe('Phase 18F-A — calendar full AI draft handoff', () => {
  it('calendar exposes Generate Full AI Draft using generate=1', () => {
    expect(CALENDAR_UI).toContain('Generate Full AI Draft');
    expect(CALENDAR_UI).toContain('&generate=1');
  });

  it('calendar retains Copy AI Draft Prompt and a manual fallback path', () => {
    expect(CALENDAR_UI).toContain('Copy AI Draft Prompt');
    expect(CALENDAR_UI).toContain('Open Manual Draft');
    // manual path uses the calendarId URL WITHOUT generate=1
    expect(CALENDAR_UI).toMatch(/calendarId=\$\{encodeURIComponent\(a\.id\)\}`/);
  });

  it('handoff invokes the existing edge function and sends calendar_brief', () => {
    expect(ARTICLES_UI).toContain("supabase.functions.invoke('generate-resource-article-draft'");
    expect(ARTICLES_UI).toContain('calendar_brief:');
    for (const field of [
      'primary_keyword',
      'secondary_keywords',
      'target_audience',
      'search_intent',
      'content_angle',
      'outline_sections',
      'suggested_faqs',
      'suggested_internal_links',
      'recommended_cta',
      'disclaimer_required',
    ]) {
      expect(ARTICLES_UI).toContain(field);
    }
  });

  it('does not add a second AI endpoint', () => {
    const invocations = ARTICLES_UI.match(/functions\.invoke\(/g) ?? [];
    expect(invocations.length).toBe(2);
    const names = ARTICLES_UI.match(/functions\.invoke\('([^']+)'/g) ?? [];
    expect(new Set(names)).toEqual(new Set(["functions.invoke('generate-resource-article-draft'"]));
  });

  it('marks the calendar generation request handled before awaiting the network call', () => {
    const start = ARTICLES_UI.indexOf('handledCalendarGenerateRef.current === calendarId');
    const assign = ARTICLES_UI.indexOf('handledCalendarGenerateRef.current = calendarId');
    const invoke = ARTICLES_UI.indexOf(
      "supabase.functions.invoke('generate-resource-article-draft'",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(start);
    expect(invoke).toBeGreaterThan(assign);
  });

  it('successful calendar AI result stays an unapproved AI draft', () => {
    const idx = ARTICLES_UI.indexOf('generated_by_ai: true');
    expect(idx).toBeGreaterThan(-1);
    expect(ARTICLES_UI).toContain("status: 'draft'");
    expect(ARTICLES_UI).toContain("approval_status: 'pending_review'");
    expect(ARTICLES_UI).toContain('ai_generation_prompt');
    // never auto-approved or auto-published by the handoff
    expect(ARTICLES_UI).not.toContain("approval_status: 'approved',\n        status: 'published'");
  });

  it('shows a loading state and an honest failure message', () => {
    expect(ARTICLES_UI).toContain('Generating full AI article…');
    expect(ARTICLES_UI).toContain('Full AI generation failed');
    expect(ARTICLES_UI).toContain('no AI article was created');
  });

  it('generator prompt demands a complete article and rejects placeholders', () => {
    expect(EDGE_FN).toContain('COMPLETE, publish-ready article');
    expect(EDGE_FN).toContain('TODO');
    expect(EDGE_FN).toContain('Draft this section');
    expect(EDGE_FN).toMatch(/NOT an outline/);
  });

  it('generator states the 1,200-2,000 word target and supplied-link-only rule', () => {
    expect(EDGE_FN).toContain('1,200-2,000 words');
    expect(EDGE_FN).toMatch(/NEVER invent internal routes/);
    expect(EDGE_FN).toContain('ALLOWLIST');
  });

  it('generator sanitizes calendar_brief input', () => {
    expect(EDGE_FN).toContain('sanitizeCalendarBrief');
    expect(EDGE_FN).toContain('function cleanStr');
    expect(EDGE_FN).toContain('function cleanList');
  });

  it('edge function performs no resource_articles DB write and preserves admin auth', () => {
    expect(EDGE_FN).not.toMatch(/resource_articles/);
    expect(EDGE_FN).not.toMatch(/\.(insert|update|upsert)\(/);
    expect(EDGE_FN).toContain('admin_users');
    expect(EDGE_FN).toContain('Admin required');
  });

  it('frontend still gates publication behind approval plus the safety confirmation', () => {
    expect(ARTICLES_UI).toContain("e.approval_status === 'approved' && safetyChecked");
    expect(ARTICLES_UI).toContain('Approve, fill all required fields, and confirm review first.');
  });

  it('manual calendar prefill path remains when generate=1 is absent', () => {
    expect(ARTICLES_UI).toContain("searchParams.get('generate') === '1'");
    expect(ARTICLES_UI).toContain('if (!isNew || !calendarId || wantsGenerate) return;');
    expect(ARTICLES_UI).toContain('buildPrefillFromPlan');
  });

  it('calendar planning data is intact and the prompt demands finished prose', () => {
    expect(CALENDAR_LIB).toContain('Writing requirements (mandatory)');
    expect(CALENDAR_LIB).toContain('Do not return an outline');
    expect(CALENDAR_LIB).toContain('Safety rules (mandatory)');
    expect(CALENDAR_LIB).toContain('Do not invent statistics, citations, quotes, studies, or sources.');
  });
});
