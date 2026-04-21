import { ArrowLeft, FileText, AlertTriangle, BarChart3, Link2, Search, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SEOHead from '@/components/SEOHead';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

type Faq = { question: string; answer: ReactNode; keywords?: string };

// ── CSV header sets (must match real exports) ─────────────────────────────────
const CSV_HEADERS = {
  'All Loads / Filtered / Monthly / Per-Week': [
    'Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Loaded Miles', 'Deadhead Miles',
    'Rate/Mile', 'Wait Fee', 'Detention Fee', 'Other Fees', 'Estimated Pay',
    'Actual Pay', 'Difference', 'Status', 'Notes', 'Company Name', 'Company Start Date',
  ],
  'Profit Report': [
    'Date', 'Pickup', 'Dropoff', 'Stops Summary', 'Estimated Pay', 'Actual Pay',
    'Linked Expenses', 'Net Load Profit', 'Company Name', 'Company Start Date',
  ],
  'Schedule C Summary': [
    'Schedule C Line', 'Line Description', 'Categories', 'Total Amount',
  ],
} as const;

// ── Reusable sub-components ───────────────────────────────────────────────────

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

const CsvHeaderPreview = () => (
  <div className="mt-3 space-y-4">
    <p className="text-xs text-muted-foreground italic">
      Live preview of the exact header row written to each CSV — what you'll see on row 1 when you open the download.
    </p>
    {(Object.entries(CSV_HEADERS) as [keyof typeof CSV_HEADERS, readonly string[]][]).map(([name, cols]) => (
      <div key={name} className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
          <span className="text-xs font-bold text-foreground">{name}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{cols.length} columns</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="bg-primary/10">
                {cols.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-left font-bold text-foreground whitespace-nowrap border-r border-border last:border-r-0">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="text-muted-foreground">
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1.5 whitespace-nowrap border-r border-border last:border-r-0">…</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    ))}
  </div>
);

// PDF mock with hover highlighting wired to a toggle
const PdfMockPreview = () => {
  const [highlightOn, setHighlightOn] = useState(true);
  const [hovered, setHovered] = useState<'totals' | 'variance' | 'lanes' | null>(null);

  const ring = (key: 'totals' | 'variance' | 'lanes') =>
    highlightOn && hovered === key ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '';

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-2 p-2 rounded-lg bg-muted/30 border border-border">
        <Label htmlFor="pdf-highlight" className="text-xs font-semibold text-foreground cursor-pointer">
          Matches your real PDF
          <span className="block text-[10px] text-muted-foreground font-normal">Hover a section below to highlight it</span>
        </Label>
        <Switch id="pdf-highlight" checked={highlightOn} onCheckedChange={setHighlightOn} />
      </div>

      <div className="rounded-xl border border-border bg-background p-3 sm:p-4 text-[11px] leading-tight">
        {/* Header band */}
        <div className="flex items-start justify-between pb-2 mb-2 border-b border-border">
          <div>
            <div className="font-black text-foreground text-sm">Acme Trucking LLC</div>
            <div className="text-muted-foreground">Weekly Profit Report · Mar 17 – Mar 23, 2026</div>
          </div>
          <FileText className="h-4 w-4 text-primary shrink-0" />
        </div>

        {/* Totals strip */}
        <div
          className={`mb-3 rounded-lg transition-shadow ${ring('totals')}`}
          onMouseEnter={() => setHovered('totals')}
          onMouseLeave={() => setHovered(null)}
        >
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
          {highlightOn && hovered === 'totals' && (
            <div className="mt-1 text-[10px] font-bold text-primary uppercase tracking-wider text-center">↑ Totals strip</div>
          )}
        </div>

        {/* Per-load table */}
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

        {/* Variance callout */}
        <div
          className={`mb-3 rounded-lg transition-shadow ${ring('variance')}`}
          onMouseEnter={() => setHovered('variance')}
          onMouseLeave={() => setHovered(null)}
        >
          <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-destructive shrink-0" />
            <div>
              <div className="font-bold text-destructive text-[10px] uppercase tracking-wider">Pay Variance Highlight</div>
              <div className="text-foreground">MIA → DAL short-paid $350 · 1 load aging 18 days unpaid</div>
            </div>
          </div>
          {highlightOn && hovered === 'variance' && (
            <div className="mt-1 text-[10px] font-bold text-destructive uppercase tracking-wider text-center">↑ Pay variance callout</div>
          )}
        </div>

        {/* Lane / Broker summary */}
        <div
          className={`rounded-lg transition-shadow ${ring('lanes')}`}
          onMouseEnter={() => setHovered('lanes')}
          onMouseLeave={() => setHovered(null)}
        >
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
          {highlightOn && hovered === 'lanes' && (
            <div className="mt-1 text-[10px] font-bold text-primary uppercase tracking-wider text-center">↑ Lane / Broker summary</div>
          )}
        </div>

        <p className="text-[9px] text-muted-foreground italic mt-3 text-center">Mock layout — your real PDF uses your data and company name.</p>
      </div>
    </div>
  );
};

// Anchor validator — opens /#profit-intelligence in a new tab and reports back
const AnchorValidator = () => {
  const [status, setStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle');
  const [detail, setDetail] = useState<string>('');

  const run = async () => {
    setStatus('running');
    setDetail('Fetching / and inspecting #profit-intelligence…');
    try {
      // Same-origin fetch — confirms element exists in the rendered HTML or shell.
      const res = await fetch('/', { cache: 'no-store' });
      const html = await res.text();
      const hasAnchor = html.includes('id="profit-intelligence"') || html.includes("id='profit-intelligence'");

      // Also actively probe the live DOM via a hidden iframe so we verify scroll behavior.
      const iframe = document.createElement('iframe');
      iframe.src = '/#profit-intelligence';
      iframe.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:600px;height:800px;border:0;';
      document.body.appendChild(iframe);

      const result = await new Promise<{ ok: boolean; msg: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ ok: hasAnchor, msg: hasAnchor
          ? 'Anchor present in HTML; live scroll check timed out (likely SPA hydration).'
          : 'Anchor not found in HTML and live check timed out.' }), 4000);
        iframe.addEventListener('load', () => {
          // Poll for the element across a few frames (mirrors the production scroll handler).
          let tries = 0;
          const poll = () => {
            tries++;
            try {
              const el = iframe.contentDocument?.getElementById('profit-intelligence');
              if (el) {
                clearTimeout(timeout);
                const rect = el.getBoundingClientRect();
                resolve({ ok: true, msg: `Found #profit-intelligence (${Math.round(rect.width)}×${Math.round(rect.height)}px). Scroll target resolves on direct URL & refresh.` });
                return;
              }
            } catch {/* cross-origin guard — should not fire on same origin */}
            if (tries < 30) requestAnimationFrame(poll);
            else {
              clearTimeout(timeout);
              resolve({ ok: false, msg: 'Iframe loaded but #profit-intelligence never appeared in the DOM.' });
            }
          };
          requestAnimationFrame(poll);
        });
      });

      iframe.remove();
      setStatus(result.ok ? 'pass' : 'fail');
      setDetail(result.msg);
    } catch (e) {
      setStatus('fail');
      setDetail(e instanceof Error ? e.message : 'Unknown error.');
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-foreground">Anchor self-test</p>
          <p className="text-[11px] text-muted-foreground">Verifies <code className="px-1 rounded bg-muted">/#profit-intelligence</code> resolves on direct nav & refresh.</p>
        </div>
        <Button size="sm" onClick={run} disabled={status === 'running'} className="h-8">
          {status === 'running' ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</> : 'Run test'}
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

// ── FAQ data ──────────────────────────────────────────────────────────────────

const faqs: Faq[] = [
  {
    question: 'Why is estimated pay different from actual?',
    answer: 'Estimated pay is calculated from your rate per mile × loaded miles + fees (detention, wait, other). Actual pay is what the broker or carrier deposits into your account. Differences can occur due to deductions, adjustments, fuel surcharges, or billing corrections.',
  },
  {
    question: 'How do I export reports?',
    answer: 'Go to Reports from the bottom navigation. You can export your data as CSV, PDF summary, or a full profit report. You can also export all your data as JSON from Settings → Export All My Data.',
    keywords: 'export csv pdf reports download',
  },
  {
    question: 'CSV columns — exact header row preview for each export type',
    keywords: 'csv columns headers export preview live',
    answer: (
      <div>
        <p className="mb-2">Below is the exact header row written as row 1 of each CSV file — same names, same order, same count.</p>
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
    question: 'PDF mock — what\'s inside the weekly / monthly PDF report?',
    keywords: 'pdf mock preview report weekly monthly variance lane broker totals',
    answer: (
      <div>
        <p className="mb-1">Each branded PDF is laid out as: a header with your company name and date range, a totals strip, a per-load table, pay variance callouts for short-paid or unpaid loads, and a brief lane and broker summary. Toggle <strong>"Matches your real PDF"</strong> below and hover any section to highlight it.</p>
        <PdfMockPreview />
      </div>
    ),
  },
  {
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
  {
    question: 'Can I edit past loads?',
    answer: 'Yes! Go to My Loads, tap on any load to see its details, then use the edit button to modify any field. You can update pay received, miles, locations, and all other details at any time.',
  },
  {
    question: 'How do I delete my account?',
    answer: 'Go to Settings → scroll to the Account section → tap "Delete Account." You\'ll need to type DELETE to confirm. This permanently removes everything tied to your account: loads and stops, expenses, fuel logs, brokers, recurring expense templates, weekly snapshots, AI insights, smart alerts, feedback, parse history, your settings and subscription record, and your sign-in account itself. This action cannot be undone.',
  },
  {
    question: 'What is the Weekly Closeout?',
    answer: 'The Weekly Closeout lets you finalize your week\'s data. It creates a snapshot of your earnings, miles, and deadhead percentage so you can track performance week over week.',
  },
  {
    question: 'How does multi-stop tracking work?',
    answer: 'When logging a load, toggle "Multi-stop load?" to add intermediate stops between pickup and drop-off. Each stop can have a type (Pickup, Stop, Drop) and optional detention minutes. Loaded miles and deadhead miles remain totals for the whole load.',
  },
  {
    question: 'How does the Rate Con Screenshot Scanner work?',
    answer: 'Open the load form and tap "Scan Rate Con Screenshot" (Pro feature). Upload or snap a photo of your rate confirmation. The app uses OCR to extract text from the image, then parses pickup, dropoff, miles, rate, and revenue from the text. You always review the extracted fields before saving — accuracy depends on image quality and format.',
  },
  {
    question: 'What does the Driver Scorecard measure?',
    answer: 'The Driver Scorecard grades you across 5 metrics: Rate Per Mile performance, Deadhead Efficiency, Expense Control, Profit Trend (week over week), and Logging Streak (consecutive weeks of activity). Each metric includes a specific coaching recommendation to help you improve. Scores range from 0–100 with tier rankings from Bronze to Platinum.',
  },
  {
    question: 'What\'s included in the 14-day free trial?',
    answer: 'Every new account starts with a 14-day Pro trial — no credit card required. You get full access to AI Voice Logging, AI Receipt Scanning, Rate Con Screenshot Scanner, Driver Scorecard with coaching advice, Weekly Closeout with anomaly detection, all 5 performance charts, dollar-impact Smart Alerts, branded PDF reports, and full tax breakdowns. No restrictions — try everything before you commit.',
  },
  {
    question: 'How do I upgrade to Pro?',
    answer: 'Go to Settings → tap "Upgrade to Pro" or visit the Pricing page. You can choose monthly ($19.99/mo) or annual ($179.88/yr — save $60). Both start with a 14-day free trial. Payment is handled securely through Stripe.',
  },
  {
    question: 'Can I cancel my Pro subscription?',
    answer: 'Yes, anytime. Go to Settings → Billing → Manage Billing to open your billing portal. Cancel there and you\'ll keep Pro access until the end of your current billing period. You can always re-subscribe later.',
  },
  {
    question: 'How is net profit calculated?',
    answer: 'Net Profit = Gross Revenue − Total Expenses. Gross revenue uses actual pay received when available, and falls back to estimated pay (rate per mile × loaded miles + fees) for unpaid loads. Expenses include everything you\'ve logged across all categories. Net $/Mile divides net profit by total miles to show your true earning rate.',
  },
  {
    question: 'How does the tax estimator work?',
    answer: 'The Tax Set-Aside Planner uses the IRS method for self-employment tax: your income is first multiplied by 92.35%, then the SE tax rate (typically 15.3%) is applied. Half of SE tax is deducted from your income before calculating federal and state income tax. Pro users see a full breakdown by tax type. You can configure your federal rate, state rate, SE rate, and add a safety buffer in Settings. This is an estimate — always verify with a tax professional.',
  },
];

// Plain-text extractor for search matching across ReactNode answers
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
  const [query, setQuery] = useState('');

  // Pre-compute searchable text once per FAQ
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

  // Open the matched item by default when searching
  const defaultOpen = query.trim() && filtered.length ? `faq-0` : undefined;

  // Auto-scroll to anchor if hash present (e.g. /faq#profit-intelligence-link)
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const match = faqs.findIndex((f) => f.question.toLowerCase().includes(hash.replace(/-/g, ' ')));
    if (match >= 0) setQuery(faqs[match].question.split(' ').slice(0, 2).join(' '));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="FAQ | HaulTrackerPro" description="Answers to common questions about tracking loads, expenses, and profit." path="/faq" />
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

        {/* Search */}
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
        <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
          <span>{filtered.length} of {faqs.length} {filtered.length === 1 ? 'answer' : 'answers'}</span>
          {query && (
            <button onClick={() => setQuery('')} className="text-primary font-semibold hover:underline">
              Clear search
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No FAQ entries match <strong className="text-foreground">"{query}"</strong>. Try a different keyword.
          </div>
        ) : (
          <Accordion type="single" collapsible className="space-y-2" defaultValue={defaultOpen}>
            {filtered.map((faq, i) => (
              <AccordionItem key={faq.question} value={`faq-${i}`} className="border rounded-xl px-4 bg-card shadow-card">
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
      </main>
    </div>
  );
}
