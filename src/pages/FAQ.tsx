import { ArrowLeft, ArrowRight, FileText, AlertTriangle, BarChart3, Link2, Search, CheckCircle2, XCircle, Loader2, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { CSV_HEADERS_LOADS, CSV_HEADERS_PROFIT, CSV_HEADERS_SCHEDULE_C } from '@/lib/loadUtils';
import { trackFaqShareLinkCopied } from '@/lib/analytics';

type Faq = { id: string; question: string; answer: ReactNode; keywords?: string };

const CSV_EXPORT_TYPES = {
  'weekly-loads':    { label: 'Weekly Loads (per-week export)',     headers: CSV_HEADERS_LOADS },
  'monthly-summary': { label: 'Monthly Summary',                    headers: CSV_HEADERS_LOADS },
  'all-loads':       { label: 'All Loads / Filtered Loads',         headers: CSV_HEADERS_LOADS },
  'profit-report':   { label: 'Profit Report',                      headers: CSV_HEADERS_PROFIT },
  'schedule-c':      { label: 'Schedule C Summary',                 headers: CSV_HEADERS_SCHEDULE_C },
} as const;

type ExportKey = keyof typeof CSV_EXPORT_TYPES;

const EXPECTED_HEADER_SNAPSHOT = {
  loads: ['Date','Pickup','Dropoff','Stops Summary','Loaded Miles','Deadhead Miles','Rate/Mile','Wait Fee','Detention Fee','Other Fees','Estimated Pay','Actual Pay','Difference','Status','Notes','Company Name','Company Start Date'],
  profit: ['Date','Pickup','Dropoff','Status','Loaded Miles','Deadhead Miles','Total Miles','Contract Rate','Gross Revenue','Actual Pay Received','Difference','Expenses','Net Profit','Effective RPM','Net RPM','Notes'],
  scheduleC: ['Schedule C Line','Line Description','Categories','Total Amount'],
};

const eq = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const headersInSync = () =>
  eq(CSV_HEADERS_LOADS, EXPECTED_HEADER_SNAPSHOT.loads) &&
  eq(CSV_HEADERS_PROFIT, EXPECTED_HEADER_SNAPSHOT.profit) &&
  eq(CSV_HEADERS_SCHEDULE_C, EXPECTED_HEADER_SNAPSHOT.scheduleC);

const ColumnGroup = ({ title, columns }: { title: string; columns: { name: string; def: string }[] }) => (
  <div className="mb-4 last:mb-0">
    <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">{title}</p>
    <ul className="space-y-1.5 pl-0">
      {columns.map((c) => (
        <li key={c.name} className="text-xs leading-relaxed">
          <span className="font-semibold text-foreground">{c.name}</span>
          <span className="text-muted-foreground"> — {c.def}</span>
        </li>
      ))}
    </ul>
  </div>
);

const HeaderIntegrityBadge = () => {
  const ok = headersInSync();
  return ok ? (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/30 text-xs">
      <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div>
        <div className="font-bold text-foreground">Verified — preview matches the live CSV implementation</div>
        <div className="text-muted-foreground">Headers below are imported directly from the export code, not duplicated copy.</div>
      </div>
    </div>
  ) : (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-xs">
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div>
        <div className="font-bold text-destructive">Heads up — preview headers may be out of date</div>
        <div className="text-muted-foreground">The export implementation has changed since this FAQ snapshot was taken. Verify by downloading a CSV from Reports.</div>
      </div>
    </div>
  );
};

const CsvHeaderPreview = () => {
  const [exportType, setExportType] = useState<ExportKey>('weekly-loads');
  const current = CSV_EXPORT_TYPES[exportType];

  return (
    <div className="mt-3 space-y-3">
      <HeaderIntegrityBadge />

      <div className="flex items-center gap-2 flex-wrap">
        <Label htmlFor="csv-export-type" className="text-xs font-bold text-foreground shrink-0">
          Export type
        </Label>
        <Select value={exportType} onValueChange={(v) => setExportType(v as ExportKey)}>
          <SelectTrigger id="csv-export-type" className="h-9 w-full sm:w-72 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(CSV_EXPORT_TYPES) as [ExportKey, typeof CSV_EXPORT_TYPES[ExportKey]][]).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground italic">
        Exact header row written to row 1 of the <strong className="text-foreground">{current.label}</strong> CSV.
      </p>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
          <span className="text-xs font-bold text-foreground">{current.label}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{current.headers.length} columns</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="bg-primary/10">
                {current.headers.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-left font-bold text-foreground whitespace-nowrap border-r border-border last:border-r-0">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="text-muted-foreground">
                {current.headers.map((c) => (
                  <td key={c} className="px-2 py-1.5 whitespace-nowrap border-r border-border last:border-r-0">…</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const PdfMockPreview = () => {
  const [highlightOn, setHighlightOn] = useState(true);
  const [active, setActive] = useState<'totals' | 'variance' | 'lanes' | null>(null);

  type SectionKey = 'totals' | 'variance' | 'lanes';
  const sectionLabel: Record<SectionKey, string> = {
    totals: 'Totals strip',
    variance: 'Pay variance callout',
    lanes: 'Lane / Broker summary',
  };

  const ring = (key: SectionKey) =>
    highlightOn && active === key ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '';

  const sectionProps = (key: SectionKey) => ({
    role: 'button' as const,
    tabIndex: highlightOn ? 0 : -1,
    'aria-pressed': active === key,
    'aria-label': `Highlight ${sectionLabel[key]}`,
    onMouseEnter: () => setActive(key),
    onMouseLeave: () => setActive((prev) => (prev === key ? null : prev)),
    onFocus: () => setActive(key),
    onBlur: () => setActive((prev) => (prev === key ? null : prev)),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive((prev) => (prev === key ? null : key));
      } else if (e.key === 'Escape') {
        setActive(null);
      }
    },
    className: `rounded-lg transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${ring(key)}`,
  });

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-2 p-2 rounded-lg bg-muted/30 border border-border">
        <Label htmlFor="pdf-highlight" className="text-xs font-semibold text-foreground cursor-pointer">
          Matches your real PDF
          <span className="block text-[10px] text-muted-foreground font-normal">Hover, Tab + Enter, or Space to highlight a section · Esc to clear</span>
        </Label>
        <Switch id="pdf-highlight" checked={highlightOn} onCheckedChange={(v) => { setHighlightOn(v); if (!v) setActive(null); }} />
      </div>

      <div className="rounded-xl border border-border bg-background p-3 sm:p-4 text-[11px] leading-tight">
        <div className="flex items-start justify-between pb-2 mb-2 border-b border-border">
          <div>
            <div className="font-black text-foreground text-sm">Acme Trucking LLC</div>
            <div className="text-muted-foreground">Weekly Profit Report · Mar 17 – Mar 23, 2026</div>
          </div>
          <FileText className="h-4 w-4 text-primary shrink-0" />
        </div>

        <div {...sectionProps('totals')} style={{ marginBottom: '0.75rem' }}>
          <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-muted/40">
            {[
              { l: 'Loads', v: '8' }, { l: 'Loaded Mi', v: '4,820' }, { l: 'Deadhead Mi', v: '610' },
              { l: 'Est. Pay', v: '$11,240' }, { l: 'Actual Pay', v: '$10,890' }, { l: 'Variance', v: '−$350' },
            ].map((t) => (
              <div key={t.l} className="text-center">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{t.l}</div>
                <div className="font-black text-foreground tabular-nums">{t.v}</div>
              </div>
            ))}
          </div>
          {highlightOn && active === 'totals' && (
            <div className="mt-1 text-[10px] font-bold text-primary uppercase tracking-wider text-center">↑ Totals strip</div>
          )}
        </div>

        <div className="rounded-lg border border-border overflow-hidden mb-3">
          <div className="grid grid-cols-5 gap-1 px-2 py-1.5 bg-muted/40 text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
            <div>Date</div><div>Lane</div><div className="text-right">Mi</div><div className="text-right">Est</div><div className="text-right">Actual</div>
          </div>
          {[
            ['3/17', 'ATL → MIA', '650', '$1,430', '$1,430'],
            ['3/19', 'MIA → DAL', '1,310', '$2,750', '$2,400'],
            ['3/21', 'DAL → PHX', '1,065', '$2,130', '$2,130'],
          ].map((r, i) => (
            <div key={i} className="grid grid-cols-5 gap-1 px-2 py-1 text-foreground border-t border-border tabular-nums">
              <div>{r[0]}</div><div className="truncate">{r[1]}</div><div className="text-right">{r[2]}</div><div className="text-right">{r[3]}</div>
              <div className={`text-right ${r[3] !== r[4] ? 'text-destructive font-bold' : ''}`}>{r[4]}</div>
            </div>
          ))}
        </div>

        <div {...sectionProps('variance')} style={{ marginBottom: '0.75rem' }}>
          <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-destructive shrink-0" />
            <div>
              <div className="font-bold text-destructive text-[10px] uppercase tracking-wider">Pay Variance Highlight</div>
              <div className="text-foreground">MIA → DAL short-paid $350 · 1 load aging 18 days unpaid</div>
            </div>
          </div>
          {highlightOn && active === 'variance' && (
            <div className="mt-1 text-[10px] font-bold text-destructive uppercase tracking-wider text-center">↑ Pay variance callout</div>
          )}
        </div>

        <div {...sectionProps('lanes')}>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-muted/40">
              <div className="flex items-center gap-1 mb-1">
                <BarChart3 className="h-3 w-3 text-primary" />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Top Lanes</span>
              </div>
              <div className="text-foreground">ATL → MIA · $1.91/mi avg</div>
              <div className="text-foreground">DAL → PHX · $1.78/mi avg</div>
            </div>
            <div className="p-2 rounded-lg bg-muted/40">
              <div className="flex items-center gap-1 mb-1">
                <BarChart3 className="h-3 w-3 text-primary" />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Brokers Watch</span>
              </div>
              <div className="text-foreground">RoadCo · 21d avg pay</div>
              <div className="text-muted-foreground">2 short-pays this period</div>
            </div>
          </div>
          {highlightOn && active === 'lanes' && (
            <div className="mt-1 text-[10px] font-bold text-primary uppercase tracking-wider text-center">↑ Lane / Broker summary</div>
          )}
        </div>

        <p className="text-[9px] text-muted-foreground italic mt-3 text-center">Mock layout — your real PDF uses your data and company name.</p>
      </div>
    </div>
  );
};

const AnchorValidator = () => {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle');
  const [detail, setDetail] = useState<string>('');
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const location = useLocation();

  const run = useCallback(async () => {
    setStatus('running');
    setDetail('Loading /#profit-intelligence in a hidden frame…');
    try {
      const iframe = document.createElement('iframe');
      iframe.src = '/#profit-intelligence';
      iframe.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:600px;height:800px;border:0;';
      document.body.appendChild(iframe);

      const result = await new Promise<{ ok: boolean; msg: string }>((resolve) => {
        const timeout = setTimeout(
          () => resolve({ ok: false, msg: 'Timed out waiting for #profit-intelligence to render in the frame.' }),
          8000,
        );
        iframe.addEventListener('load', () => {
          let tries = 0;
          const poll = () => {
            tries++;
            try {
              const el = iframe.contentDocument?.getElementById('profit-intelligence');
              if (el) {
                clearTimeout(timeout);
                const rect = el.getBoundingClientRect();
                resolve({
                  ok: true,
                  msg: `Found #profit-intelligence (${Math.round(rect.width)}×${Math.round(rect.height)}px). Scroll target resolves on direct URL & refresh.`,
                });
                return;
              }
            } catch {
              /* same-origin only */
            }
            if (tries < 60) requestAnimationFrame(poll);
            else { clearTimeout(timeout); resolve({ ok: false, msg: 'Iframe loaded but #profit-intelligence never appeared in the DOM.' }); }
          };
          requestAnimationFrame(poll);
        });
      });

      iframe.remove();
      setStatus(result.ok ? 'pass' : 'fail');
      setDetail(result.msg);
      setLastRunAt(new Date());
    } catch (e) {
      setStatus('fail');
      setDetail(e instanceof Error ? e.message : 'Unknown error.');
      setLastRunAt(new Date());
    }
  }, []);

  useEffect(() => {
    run();
  }, [run, location.key]);

  useEffect(() => {
    const onFocus = () => run();
    const onVisibility = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [run]);

  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-foreground">Anchor self-test</p>
          <p className="text-[11px] text-muted-foreground">
            Verifies <code className="px-1 rounded bg-muted">/#profit-intelligence</code> resolves on direct nav & refresh.
            Auto-reruns on revisit, refresh, and tab focus.
          </p>
        </div>
        <Button size="sm" onClick={run} disabled={status === 'running'} className="h-8">
          {status === 'running' ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</> : 'Re-run test'}
        </Button>
      </div>

      {status !== 'idle' && (
        <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
          status === 'pass' ? 'bg-primary/10 text-foreground border border-primary/30' :
          status === 'fail' ? 'bg-destructive/10 text-foreground border border-destructive/30' :
          'bg-muted/40 text-muted-foreground border border-border'
        }`}>
          {status === 'pass' && <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
          {status === 'fail' && <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
          {status === 'running' && <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />}
          <div className="flex-1">
            <div className="font-bold">
              {status === 'pass' && 'Pass — anchor reachable'}
              {status === 'fail' && 'Fail — anchor not reachable'}
              {status === 'running' && 'Running…'}
            </div>
            <div className="text-muted-foreground">{detail}</div>
            {lastRunAt && status !== 'running' && (
              <div className="text-[10px] text-muted-foreground mt-1">Last checked {lastRunAt.toLocaleTimeString()}</div>
            )}
          </div>
        </div>
      )}

      <a
        href="/#profit-intelligence"
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
      >
        Open <code className="px-1 rounded bg-muted text-foreground">/#profit-intelligence</code> in new tab
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
};

const safeFaqSchema = (entries: { question: string; answer: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: entries.map((f) => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer },
  })),
});

const faqs: Faq[] = [
  {
    id: 'estimated-vs-actual',
    question: 'Why is estimated pay different from actual?',
    answer: 'Estimated pay is calculated from your rate per mile × loaded miles + fees (detention, wait, other). Actual pay is what the broker or carrier deposits into your account. Differences can occur due to deductions, adjustments, fuel surcharges, or billing corrections.',
  },
  {
    id: 'export-reports',
    question: 'How do I export reports?',
    answer: 'Go to Reports from the bottom navigation. You can export your data as CSV, PDF summary, or a full profit report. You can also export all your data as JSON from Settings → Export All My Data.',
    keywords: 'export csv pdf reports download',
  },
  {
    id: 'csv-columns',
    question: 'CSV columns — exact header row preview for each export type',
    keywords: 'csv columns headers export preview live weekly monthly',
    answer: (
      <div>
        <p className="mb-2">Pick an export type below to see the exact header row written as row 1 of that CSV file — same names, same order, same count, imported live from the export code.</p>
        <CsvHeaderPreview />
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Column definitions</p>
          <ColumnGroup
            title="All Loads / Filtered / Monthly / Per-Week (17 columns)"
            columns={[
              { name: 'Date', def: 'Load date in YYYY-MM-DD' },
              { name: 'Pickup', def: 'Origin city, state' },
              { name: 'Dropoff', def: 'Destination city, state' },
              { name: 'Stops Summary', def: 'Concatenated multi-stop list (empty for single-stop)' },
              { name: 'Loaded Miles', def: 'Miles with freight on board' },
              { name: 'Deadhead Miles', def: 'Empty miles to pickup' },
              { name: 'Rate/Mile', def: 'Negotiated rate per loaded mile' },
              { name: 'Wait Fee', def: 'Wait-time accessorial paid' },
              { name: 'Detention Fee', def: 'Detention accessorial paid' },
              { name: 'Other Fees', def: 'Lumper, fuel surcharge, layover, etc.' },
              { name: 'Estimated Pay', def: '(loaded miles × rate) + all fees' },
              { name: 'Actual Pay', def: 'What the broker actually deposited' },
              { name: 'Difference', def: 'Actual − Estimated (negative = short-pay)' },
              { name: 'Status', def: 'completed / cancelled / in-progress' },
              { name: 'Notes', def: 'Free-text notes on the load' },
              { name: 'Company Name', def: 'Your company name from Settings' },
              { name: 'Company Start Date', def: 'When you started operating' },
            ]}
          />
          <ColumnGroup
            title="Profit Report (10 columns)"
            columns={[
              { name: 'Date', def: 'Load date' },
              { name: 'Pickup', def: 'Origin city, state' },
              { name: 'Dropoff', def: 'Destination city, state' },
              { name: 'Stops Summary', def: 'Multi-stop list if applicable' },
              { name: 'Estimated Pay', def: 'Calculated revenue from rate + fees' },
              { name: 'Actual Pay', def: 'Cash actually received' },
              { name: 'Linked Expenses', def: 'Sum of expenses tagged to this load' },
              { name: 'Net Load Profit', def: 'Actual Pay − Linked Expenses' },
              { name: 'Company Name', def: 'Your company name' },
              { name: 'Company Start Date', def: 'When you started operating' },
            ]}
          />
          <ColumnGroup
            title="Schedule C Summary (4 columns)"
            columns={[
              { name: 'Schedule C Line', def: 'IRS Schedule C line number (e.g. Line 9 — Car & truck expenses)' },
              { name: 'Line Description', def: 'Plain-English label for that line' },
              { name: 'Categories', def: 'Your in-app expense categories mapped to this line' },
              { name: 'Total Amount', def: 'Sum of expenses in those categories for the period' },
            ]}
          />
        </div>
      </div>
    ),
  },
  {
    id: 'pdf-mock',
    question: 'PDF mock — what\'s inside the weekly / monthly PDF report?',
    keywords: 'pdf mock preview report weekly monthly variance lane broker totals',
    answer: (
      <div>
        <p className="mb-1">Each branded PDF is laid out as: a header with your company name and date range, a totals strip, a per-load table, pay variance callouts for short-paid or unpaid loads, and a brief lane and broker summary. Toggle <strong>"Matches your real PDF"</strong> below and hover (or Tab + Enter) any section to highlight it.</p>
        <PdfMockPreview />
      </div>
    ),
  },
  {
    id: 'profit-intelligence-link',
    question: 'Profit Intelligence link — how does it work with direct URLs and refreshes?',
    keywords: 'profit intelligence link anchor pricing scroll refresh url',
    answer: (
      <div className="space-y-2">
        <p>The "Profit Intelligence" link on the Pricing page navigates to <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">/#profit-intelligence</code> on the home page. The same URL works as a direct, shareable link or after a full page refresh — the home page reads the hash on mount and instantly anchors the viewport to the Profit Intelligence section.</p>
        <p>The scroll uses <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">behavior: 'auto'</code> (instant) and polls for the section element across animation frames, so there is no top-flash, smooth-scroll jump, or flicker on first load.</p>
        <div className="flex items-center gap-1.5 text-xs text-primary font-semibold mt-2">
          <Link2 className="h-3 w-3" />
          <span>Direct link: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">https://haultrackerpro.com/#profit-intelligence</code></span>
        </div>
        <AnchorValidator />
      </div>
    ),
  },
  {
    id: 'use-my-numbers',
    question: '"Use My Numbers" — which demo inputs prefill the Load Entry form (and which fields stay empty)?',
    keywords: 'use my numbers demo prefill load entry empty manual',
    answer: (
      <div>
        <p className="mb-3">The Profit Intelligence demo on the home page sends the following values into the Load Entry form when you tap <strong className="text-foreground">"Use My Numbers in HaulTrackerPro"</strong>:</p>

        <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Prefilled fields</p>
        <ul className="space-y-1.5 mb-4">
          {[
            { i: 'Load pays ($)', m: 'Gross Revenue + Estimated Pay (so the load reflects the rate you tested)' },
            { i: 'Loaded miles', m: 'Loaded Miles' },
            { i: 'Deadhead miles', m: 'Deadhead Miles' },
            { i: 'Load pays ÷ Loaded miles', m: 'Rate/Mile (auto-computed to 2 decimals)' },
            { i: 'Fuel cost ($) + Other expenses ($)', m: 'Mentioned in the auto-generated Notes field so you can log them as separate expenses' },
          ].map((r) => (
            <li key={r.i} className="text-xs leading-relaxed">
              <span className="font-semibold text-foreground">{r.i}</span>
              <span className="text-muted-foreground"> → {r.m}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Empty — you must fill these manually</p>
        <ul className="space-y-1.5 mb-3">
          {[
            { f: 'Pickup location', why: 'City, ST of where you pick up the freight' },
            { f: 'Dropoff location', why: 'City, ST of where you deliver' },
            { f: 'Load date', why: 'Defaults to today; change to actual pickup day' },
            { f: 'Dropoff date', why: 'Optional but anchors the load to the right pay week' },
            { f: 'Broker', why: 'Pick from your brokers list or add a new one — drives broker reliability scoring' },
            { f: 'Wait Fee / Detention Fee / Other Fees', why: 'Itemized accessorials (the demo bundles them into one number)' },
            { f: 'Payment status & Actual Pay', why: 'Defaults to unpaid; update once you invoice and get paid' },
            { f: 'Multi-stop list', why: 'Add intermediate stops if the load isn\'t a single pickup → drop' },
          ].map((r) => (
            <li key={r.f} className="text-xs leading-relaxed">
              <span className="font-semibold text-foreground">{r.f}</span>
              <span className="text-muted-foreground"> — {r.why}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground italic">Broker on-time % is demo-only and does not transfer — it would be derived from your real broker reliability data inside the app.</p>
      </div>
    ),
  },
  { id: 'edit-loads', question: 'Can I edit past loads?', answer: 'Yes! Go to My Loads, tap on any load to see its details, then use the edit button to modify any field. You can update pay received, miles, locations, and all other details at any time.' },
  {
    id: 'delete-account',
    question: 'How do I delete my account?',
    keywords: 'delete account remove close cancel deletion retention agency owner subscription',
    answer: (
      <div className="space-y-2 text-sm leading-relaxed">
        <p>
          Go to <span className="font-semibold">Settings → Account → Delete Account</span> and type <span className="font-mono">DELETE</span> to confirm. Permanent deletion affects the full personal login and every capability it owns (driver, recruiter, assistant), not only the role you are viewing.
        </p>
        <p>
          Any driver and recruiter subscriptions owned by that login are cancelled as part of the permanent-deletion flow before database cleanup — this is different from a normal cancel-at-period-end from the billing portal. Personal operational data (loads, expenses, fuel logs, settings, and similar direct account records) is targeted for transactional cleanup.
        </p>
        <p>
          Some shared, audit, billing/payment, application, signature, security, fraud-prevention, dispute, legal, compliance, backup, or third-party-held records may remain, be detached from your identity, or be anonymized where operationally or lawfully necessary. If you own an agency, personal deletion is blocked until agency ownership is transferred or the agency is closed through support.
        </p>
        <p>
          Export anything you need first — successful deletion has no self-service undo. See{' '}
          <Link to="/docs/account-deletion-data-retention" className="text-primary hover:underline font-medium">
            Account deletion &amp; data retention
          </Link>{' '}
          and{' '}
          <Link to="/docs/billing-cancellation" className="text-primary hover:underline font-medium">
            Cancellation vs. permanent deletion
          </Link>{' '}
          for the complete details.
        </p>
      </div>
    ),
  },
  { id: 'weekly-closeout', question: 'What is the Weekly Closeout?', answer: 'The Weekly Closeout lets you finalize your week\'s data. It creates a snapshot of your earnings, miles, and deadhead percentage so you can track performance week over week.' },
  { id: 'multi-stop', question: 'How does multi-stop tracking work?', answer: 'Toggle "Multi-stop load?" to add route stops between pickup and final delivery. Each stop can have a type (Pickup, Stop, Drop), an optional stop date, and optional detention minutes. The top-level Pickup and Drop-off fields stay canonical — your manual Drop-off Date stays in control unless you enter a date on the final Drop stop, which then drives dashboard/reports/exports.' },
  { id: 'rate-con-scanner', question: 'How does the Rate Con Screenshot Scanner work?', answer: 'Open the load form and tap "Scan Rate Con Screenshot" (Pro feature). Upload or snap a photo of your rate confirmation. The app uses OCR to extract text from the image, then parses pickup, dropoff, miles, rate, and revenue from the text. You always review the extracted fields before saving — accuracy depends on image quality and format.' },
  { id: 'driver-scorecard', question: 'What does the Driver Scorecard measure?', answer: 'The Driver Scorecard grades you across 5 metrics: Rate Per Mile performance, Deadhead Efficiency, Expense Control, Profit Trend (week over week), and Logging Streak (consecutive weeks of activity). Each metric includes a specific coaching recommendation to help you improve. Scores range from 0–100 with tier rankings from Bronze to Platinum.' },
  { id: 'free-plan', question: 'What\'s included in the Free plan?', answer: 'The Free plan lets you log loads, expenses, and fuel, see your weekly profit, and use core dashboard tools — no credit card required. Upgrade to Pro to unlock AI Voice Logging, AI Receipt Scanning, Rate Con Screenshot Scanner, Driver Scorecard, Weekly Closeout with anomaly detection, all 5 performance charts, dollar-impact Smart Alerts, branded PDF reports, and full tax breakdowns. You can also grab the Free Starter Kit (templates + guides) any time.' },
  { id: 'upgrade-pro', question: 'How do I upgrade to Pro?', answer: 'Go to Settings → tap "Upgrade to Pro" or visit the Pricing page. You can choose monthly ($19.99/mo) or annual ($179.88/yr — save $60). Payment is handled securely through Stripe and you can cancel any time.' },
  { id: 'cancel-pro', question: 'Can I cancel my Pro subscription?', answer: 'Yes, anytime. Go to Settings → Billing → Manage Billing to open your billing portal. Cancel there and you\'ll keep Pro access until the end of your current billing period. You can always re-subscribe later.' },
  { id: 'net-profit', question: 'How is net profit calculated?', answer: 'Net Profit = Gross Revenue − Total Expenses. Gross revenue uses actual pay received when available, and falls back to estimated pay (rate per mile × loaded miles + fees) for unpaid loads. Expenses include everything you\'ve logged across all categories. Net $/Mile divides net profit by total miles to show your true earning rate.' },
  { id: 'tax-estimator', question: 'How does the tax estimator work?', answer: 'The Tax Set-Aside Planner uses the IRS method for self-employment tax: your income is first multiplied by 92.35%, then the SE tax rate (typically 15.3%) is applied. Half of SE tax is deducted from your income before calculating federal and state income tax. Pro users see a full breakdown by tax type. You can configure your federal rate, state rate, SE rate, and add a safety buffer in Settings. This is an estimate — always verify with a tax professional.' },
  { id: 'parking-finder', question: 'How does the Parking Finder work?', answer: 'The Parking Finder (Pro) shows real-time truck parking availability reported by other drivers. Tap any lot to see its current status (available, limited, or full), the safety rating, and how recently it was verified. You can submit your own report once per lot per hour — that throttle keeps the data fresh and trustworthy. Free users see a locked preview; the live finder is included with Pro.' },
  { id: 'parking-points', question: 'How do I earn driver points?', answer: 'You earn 5 points every time you submit a verified parking report. Consecutive days of activity build a streak, and your total points place you on the community leaderboard alongside other HaulTrackerPro drivers. Points reward drivers who help the community by keeping parking data fresh.' },
  { id: 'parking-export', question: 'Can I export my parking stops?', answer: 'Yes — Pro users can export logged parking stops as CSV or PDF for any date range. Useful for paperwork, dispatcher reports, or HOS records. Export is available from the Parking page header.' },
  { id: 'starter-kit', question: 'What\'s in the Free Trucker Starter Kit?', answer: 'Six free PDFs for new and aspiring truckers: CDL study notes, test-day checklist, owner-operator paperwork basics, expense tracker template, profit cheat sheet, and a load-board quickstart. No credit card, no spam — just enter your email at /starter-kit and download instantly.' },
  {
    id: 'what-are-opportunities',
    question: 'What are HaulTrackerPro Opportunities?',
    answer: 'Opportunities are trucking opportunities submitted by approved recruiters and carriers. Drivers can review estimated pay, RPM, deadhead, deductions, and request more information.',
  },
  {
    id: 'opportunity-earnings-guaranteed',
    question: 'Are opportunity earnings guaranteed?',
    answer: 'No. Pay, deductions, miles, and Profit Intelligence are estimates based on recruiter-provided information. Drivers should verify details directly with the recruiter or carrier.',
  },
  {
    id: 'how-recruiters-post',
    question: 'How do recruiters post opportunities?',
    answer: 'A recruiter completes the canonical readiness fields — recruiter name, company name, a valid recruiter email, and company type — accepts the current posting terms, and keeps a non-suspended account. A DOT or MC number is required only when the company type is Carrier / Motor Carrier; third-party recruiters, staffing agencies, and independent recruiters do not need DOT or MC for standard posting. Standard posting is not gated on Verified Recruiter badge approval or on admin approval. Once ready, Recruiter Standard allows 1 active opportunity at a time with unlimited drafts. Paid recruiter plans raise the active-opportunity limit and add premium recruiting tools.',
  },
  {
    id: 'recruiter-paste-autofill',
    question: 'Can recruiters paste an existing job post to fill the opportunity form?',
    answer: 'Yes. A recruiter can paste an existing job post, recruiter pitch, or rate sheet, AI extracts the structured opportunity fields, and the recruiter reviews and edits those fields before submitting. The extractor itself does not save anything — nothing is saved as an opportunity until the recruiter submits the form.',
    keywords: 'recruiter paste opportunity auto-fill extract',
  },
  {
    id: 'recruiter-plans',
    question: 'What are recruiter plans?',
    answer: 'Recruiter Standard is free and includes 1 active opportunity with unlimited drafts. Starter ($19/month) allows up to 5 active opportunities and adds applicant status history, a basic referral tracking view, and carrier settlement issuance. Growth ($49/month) allows up to 15 active opportunities and adds priority placement, featured listing eligibility, recruiter reports, the contract-management dashboard with AI-assisted risk review, and pipeline analytics. Fleet ($149/month) allows up to 25 active opportunities for existing or included Fleet access — new standalone Fleet checkout is unavailable. Drafts are unlimited on every plan.',
  },
  {
    id: 'settlement-statements',
    question: 'What are settlement statements in HaulTrackerPro?',
    answer: 'A carrier or agency you have an accepted relationship with can issue you a finalized settlement statement listing pay, deductions, and other line items. Every driver plan — Free and Pro — can view finalized statements issued to them and use basic reconciliation.',
    keywords: 'settlement statement carrier agency pay',
  },
  {
    id: 'settlement-reconciliation',
    question: 'How does settlement reconciliation work?',
    answer: 'Driver Free covers delivered statements and basic reconciliation — confirming or clearing the load match on a settlement line. Driver Pro adds advanced reconciliation (refreshing and rejecting suggested load matches) and driver-imported records for a settlement you received outside HaulTrackerPro. HaulTrackerPro also shows the net implied by the visible line items next to the reported net so a difference is visible.',
    keywords: 'settlement reconciliation load match pro import',
  },
  {
    id: 'settlement-assistant-access',
    question: 'Can my assistant work on my settlements?',
    answer: 'Only within the permissions you granted on an active delegation. Settlement view permission lets an assistant view your statements. Settlement management controls require settlement-management permission, and finalizing requires settlement-finalize permission plus your own Driver Pro entitlement. Advanced reconciliation and imported statements always follow your Pro entitlement as the recipient driver, never the assistant\'s own plan.',
    keywords: 'assistant settlement permission view manage finalize',
  },
  {
    id: 'settlement-agency-preparation',
    question: 'Can a paid agency prepare settlements for me?',
    answer: 'Yes. A paid Agency Starter, Team, or Growth workspace can prepare settlement statements for a delegated driver client when you granted settlement-management permission, and finalizing additionally requires settlement-finalize permission. Whether you are on Driver Free or Driver Pro does not gate paid agency preparation.',
    keywords: 'agency settlement preparation permission finalize',
  },
  {
    id: 'settlement-carrier-issuance',
    question: 'What does a carrier need to issue me a settlement?',
    answer: 'Carrier-issued settlement creation and finalization require an active standalone paid recruiter/carrier entitlement plus an active carrier↔driver relationship you accepted. An agency-included recruiter entitlement is a recruiting entitlement only and does not grant carrier-issued settlement authority.',
    keywords: 'carrier settlement issuance standalone paid relationship',
  },
  {
    id: 'settlement-line-net-difference',
    question: 'What does a difference between line total and reported net mean?',
    answer: 'It is informational only. A difference between the net implied by the visible line items and the reported net does not by itself prove underpayment or overpayment, and it does not block finalization. A difference can also come from lines you cannot see, rounding, or data entry. Confirm amounts against the original statement from the company.',
    keywords: 'settlement line net reported net difference informational',
  },
  {
    id: 'settlement-lifecycle-export',
    question: 'Can settlements be corrected, voided, or exported?',
    answer: 'Yes. A draft can be finalized, a finalized statement can be voided, and a correction can supersede an earlier statement so the version history stays visible to both sides. You can export a statement to CSV and print it from your browser.',
    keywords: 'settlement correction supersede void finalize version history csv print export',
  },
  {
    id: 'settlement-payments',
    question: 'Does HaulTrackerPro pay or guarantee settlement amounts?',
    answer: 'No. Settlement statements are recordkeeping only. HaulTrackerPro does not process payroll, send ACH or direct deposit, calculate or remit employer payroll taxes, issue or file employer tax forms, determine worker classification, or determine whether a deduction is lawful. It does not pay, hold, transfer, escrow, verify, or guarantee any settlement amount, and a settlement record is not proof that payment occurred. Payment happens outside the platform between you and the company that issued the statement.',
    keywords: 'settlement payment guarantee recordkeeping payroll ach',
  },

  {
    id: 'driver-refer-driver',
    question: 'Can drivers refer other drivers to a recruiter opportunity?',
    answer: 'Yes. Submitting a new driver referral is a Pro driver feature. Pro drivers can refer another driver to a recruiter opportunity and track referral progress in their dashboard. Free drivers can still view their existing referral history. Recruiters see referrals in their pipeline and can move them through contacted, interviewed, hired, closed, or marked paid externally.',
    keywords: 'driver referral refer friend',
  },
  {
    id: 'referral-payment-safety',
    question: 'Does HaulTrackerPro handle referral payments?',
    answer: 'No. HaulTrackerPro tracks referral progress only — it does not process, hold, or guarantee referral payments. Referral bonuses, if a recruiter offers them, are paid externally by the recruiter according to their own terms.',
    keywords: 'referral payment bonus external paid',
  },
  {
    id: 'request-info-contact',
    question: 'What happens when a driver requests info?',
    answer: 'The application and the driver\'s submitted profile details go to the recruiter connected to that opportunity. Private phone and email details are disclosed to that recruiter only after the driver approves a separate contact request.',
  },
  {
    id: 'contract-protection-overview',
    question: 'What is Contract Protection?',
    answer: "Contract Protection helps drivers review recruiter-sent contracts using AI-assisted summaries and risk flags. Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record. The recruiter-side workflow is included with the Growth and Fleet recruiter plans.",
  },
  {
    id: 'contract-free-tools',
    question: 'What contract tools are free?',
    answer: 'Free drivers can view recruiter-sent contracts, see basic AI-assisted risk flags or summaries when available, approve, reject, request changes, and record approval/signature when required.',
    keywords: 'free contract tools driver',
  },
  {
    id: 'contract-pro-tools',
    question: 'What contract tools are included with Driver Pro?',
    answer: 'Driver Pro includes the Plain-English Clause Rewrite tool, which lets drivers paste a confusing clause and receive a plain-English explanation, concern points, and questions to ask the recruiter. Additional tools such as saved history, downloadable records, and AI follow-up support may be added later.',
    keywords: 'driver pro contract clause rewrite',
  },
  {
    id: 'contract-recruiter-needs-pro',
    question: 'Do recruiters need Driver Pro to upload contracts?',
    answer: 'No. Recruiter contract upload and approval tracking belong to the recruiter-paid workflow. Driver Pro is separate and is meant for driver-side advanced review tools.',
    keywords: 'recruiter pro upload contract',
  },
  {
    id: 'contract-clause-rewrite-legal-advice',
    question: 'Is the Plain-English Clause Rewrite legal advice?',
    answer: 'No. It is informational only. HaulTrackerPro is not a law firm and does not provide legal advice. Drivers should read the full contract and consider speaking with a qualified attorney before signing important agreements.',
    keywords: 'plain english clause rewrite legal advice',
  },
  {
    id: 'contract-legal-advice',
    question: 'Does HaulTrackerPro give legal advice?',
    answer: 'No. AI contract review is informational only. HaulTrackerPro is not a law firm and does not create an attorney-client relationship. Drivers should read the full contract and speak with a qualified attorney for legal advice.',
    keywords: 'contract legal advice attorney lawyer',
  },
  {
    id: 'contract-recruiter-upload',
    question: 'How do recruiters upload a contract?',
    answer: 'Recruiters can upload a contract as part of the opportunity workflow. The driver can then review the contract, see the AI-assisted summary, and decide whether to approve, reject, or request changes.',
    keywords: 'contract upload recruiter',
  },
  {
    id: 'contract-hired-without-approval',
    question: 'Can a recruiter mark me hired without my approval?',
    answer: 'When a contract approval/signature is required, HaulTrackerPro\u2019s workflow is designed to block recruiters from marking a driver hired until the required contract step is completed.',
    keywords: 'hired status protection contract approval',
  },
  {
    id: 'contract-reject',
    question: 'What happens if I reject a contract?',
    answer: 'If a driver rejects a contract, the recruiter cannot move forward on that contract version. The recruiter may need to revise the terms or continue the conversation outside the platform.',
    keywords: 'reject contract',
  },
  {
    id: 'contract-request-changes',
    question: 'What does "request changes" mean?',
    answer: 'Request changes lets a driver ask the recruiter to revise contract terms before approval or signature. This creates a clearer record of what the driver wants changed.',
    keywords: 'request changes contract revision',
  },
  {
    id: 'contract-signature-vs-docusign',
    question: 'Is the in-app signature the same as DocuSign?',
    answer: 'No. HaulTrackerPro\u2019s in-app signature is a platform record of approval/consent. It is not a notarization, a qualified electronic signature, or a DocuSign-equivalent signature.',
    keywords: 'signature docusign electronic signature',
  },
  {
    id: 'contract-privacy',
    question: 'Is my contract private?',
    answer: 'Contract records are intended to be private between the assigned driver, the recruiter who uploaded the contract, and HaulTrackerPro admins when support, security, moderation, or dispute review is needed.',
    keywords: 'contract privacy private',
  },
  {
    id: 'contract-types-supported',
    question: 'What types of contracts can this help with?',
    answer: 'It is designed for trucking-related contracts such as 1099 independent contractor agreements, owner-operator agreements, lease-purchase terms, escrow language, and similar recruiter-driver documents.',
    keywords: 'contract types 1099 owner-operator lease purchase escrow',
  },
  {
    id: 'contract-ai-misses',
    question: 'Can AI miss something important?',
    answer: 'Yes. AI can misunderstand or miss contract terms. Drivers should always read the full document before signing and should consider legal help for important agreements.',
    keywords: 'ai limitations contract miss',
  },
];

const nodeToText = (node: ReactNode): string => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join(' ');
  if (typeof node === 'object' && 'props' in (node as object)) {
    return nodeToText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
};

export default function FAQ() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const indexed = useMemo(
    () => faqs.map((f) => ({
      faq: f,
      text: `${f.question} ${f.keywords ?? ''} ${nodeToText(f.answer)}`.toLowerCase(),
    })),
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faqs;
    return indexed.filter((x) => x.text.includes(q)).map((x) => x.faq);
  }, [query, indexed]);

  const bestMatchId = filtered[0]?.id;
  const [openItem, setOpenItem] = useState<string | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') ?? '';
    const open = params.get('open') ?? '';
    const hash = location.hash.replace('#', '');

    if (q) setQuery(q);

    let target = '';
    if (open && faqs.some((f) => f.id === open)) target = open;
    else if (hash && faqs.some((f) => f.id === hash)) target = hash;
    else if (q) {
      const lq = q.toLowerCase();
      const match = faqs.find((f) => `${f.question} ${f.keywords ?? ''} ${nodeToText(f.answer)}`.toLowerCase().includes(lq));
      if (match) target = match.id;
    }

    if (target) {
      setOpenItem(target);
      requestAnimationFrame(() => {
        const el = itemRefs.current[target];
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
  }, [location.search, location.hash]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const current = params.get('q') ?? '';
    if (query === current) return;
    if (query) params.set('q', query); else params.delete('q');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [query, navigate, location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (query.trim() && bestMatchId) setOpenItem(bestMatchId);
  }, [query, bestMatchId]);

  const shareableLink = useMemo(() => {
    if (!query.trim() || !bestMatchId) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('q', query);
    url.searchParams.set('open', bestMatchId);
    url.hash = '';
    return url.toString();
  }, [query, bestMatchId]);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="FAQ — Truck Driver Profit Tracking & Recruiter Platform | HaulTrackerPro"
        description="Answers about tracking load profit, fuel and expenses, RPM, reports, recruiter opportunities, and driver referral tracking on HaulTrackerPro."
        path="/faq"
        jsonLd={[
          safeFaqSchema(
            faqs
              .filter((f) =>
                [
                  'free-plan',
                  'net-profit',
                  'tax-estimator',
                  'what-are-opportunities',
                  'opportunity-earnings-guaranteed',
                  'how-recruiters-post',
                  'driver-refer-driver',
                  'referral-payment-safety',
                  'contract-legal-advice',
                ].includes(f.id) && typeof f.answer === 'string',
              )
              .map((f) => ({ question: f.question, answer: f.answer as string })),
          ),
          buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'FAQ', path: '/faq' }]),
        ]}
      />
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Frequently Asked Questions</h1>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-black font-heading mb-4">FAQ</h2>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder='Try "CSV columns", "PDF mock", or "Profit Intelligence link"…'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-11 rounded-xl"
            aria-label="Search FAQ"
          />
        </div>
        <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground gap-2 flex-wrap">
          <span>{filtered.length} of {faqs.length} {filtered.length === 1 ? 'answer' : 'answers'}</span>
          <div className="flex items-center gap-3">
            {shareableLink && (
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(shareableLink);
                  if (bestMatchId) trackFaqShareLinkCopied(bestMatchId);
                }}
                className="text-primary font-semibold hover:underline"
                title="Copy a shareable URL that opens this answer"
              >
                Copy share link
              </button>
            )}
            {query && (
              <button onClick={() => setQuery('')} className="text-primary font-semibold hover:underline">
                Clear search
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No FAQ entries match <strong className="text-foreground">"{query}"</strong>. Try a different keyword.
          </div>
        ) : (
          <Accordion
            type="single"
            collapsible
            className="space-y-2"
            value={openItem}
            onValueChange={(v) => setOpenItem(v || undefined)}
          >
            {filtered.map((faq) => (
              <AccordionItem
                key={faq.id}
                value={faq.id}
                className="border rounded-xl px-4 bg-card shadow-card scroll-mt-20"
                ref={(el) => { itemRefs.current[faq.id] = el as HTMLDivElement | null; }}
              >
                <AccordionTrigger className="text-sm font-semibold text-left hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
          <h3 className="text-lg font-black font-heading">Want a deeper breakdown?</h3>
          <p className="text-sm text-muted-foreground">
            Visit the Haul Tracker Pro resource hub for guides on profit tracking, 1099 expenses, real RPM, contracts, referrals, and recruiter tools — or learn more about why we built it.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button size="sm" onClick={() => navigate('/resources')} className="rounded-xl gap-1">
              Explore Resources <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/about')} className="rounded-xl">
              Learn About Haul Tracker Pro
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/auth')} className="rounded-xl">
              Start Tracking Free
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/pricing')} className="rounded-xl">
              View Pricing
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
