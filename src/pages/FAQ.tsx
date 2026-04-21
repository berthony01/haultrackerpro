import { ArrowLeft, FileText, AlertTriangle, BarChart3, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SEOHead from '@/components/SEOHead';
import type { ReactNode } from 'react';

type Faq = { question: string; answer: ReactNode };

// Reusable sub-components for rich FAQ answers ────────────────────────────────

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

const PdfMockPreview = () => (
  <div className="mt-3 rounded-xl border border-border bg-background p-3 sm:p-4 text-[11px] leading-tight">
    {/* Header band */}
    <div className="flex items-start justify-between pb-2 mb-2 border-b border-border">
      <div>
        <div className="font-black text-foreground text-sm">Acme Trucking LLC</div>
        <div className="text-muted-foreground">Weekly Profit Report · Mar 17 – Mar 23, 2026</div>
      </div>
      <FileText className="h-4 w-4 text-primary shrink-0" />
    </div>
    {/* Totals strip — labelled */}
    <div className="relative mb-3">
      <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-muted/40">
        {[
          { l: 'Loads', v: '8' },
          { l: 'Loaded Mi', v: '4,820' },
          { l: 'Deadhead Mi', v: '610' },
          { l: 'Est. Pay', v: '$11,240' },
          { l: 'Actual Pay', v: '$10,890' },
          { l: 'Variance', v: '−$350' },
        ].map((t) => (
          <div key={t.l} className="text-center">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{t.l}</div>
            <div className="font-black text-foreground tabular-nums">{t.v}</div>
          </div>
        ))}
      </div>
      <span className="absolute -left-1 top-1/2 -translate-y-1/2 -translate-x-full hidden sm:flex items-center gap-1 text-[9px] font-bold text-primary uppercase tracking-wider">
        Totals →
      </span>
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
    {/* Pay variance callout */}
    <div className="relative flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30 mb-3">
      <AlertTriangle className="h-3 w-3 mt-0.5 text-destructive shrink-0" />
      <div>
        <div className="font-bold text-destructive text-[10px] uppercase tracking-wider">Pay Variance Highlight</div>
        <div className="text-foreground">MIA → DAL short-paid $350 · 1 load aging 18 days unpaid</div>
      </div>
      <span className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full hidden sm:flex text-[9px] font-bold text-destructive uppercase tracking-wider">
        ← Variance
      </span>
    </div>
    {/* Lane / Broker summary */}
    <div className="relative grid grid-cols-2 gap-2">
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
      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full hidden sm:block text-[9px] font-bold text-primary uppercase tracking-wider">
        ↑ Lane / Broker Summary
      </span>
    </div>
    <p className="text-[9px] text-muted-foreground italic mt-3 text-center">Mock layout — your real PDF uses your data and company name.</p>
  </div>
);

// FAQ data ───────────────────────────────────────────────────────────────────

const faqs: Faq[] = [
  {
    question: 'Why is estimated pay different from actual?',
    answer: 'Estimated pay is calculated from your rate per mile × loaded miles + fees (detention, wait, other). Actual pay is what the broker or carrier deposits into your account. Differences can occur due to deductions, adjustments, fuel surcharges, or billing corrections.',
  },
  {
    question: 'How do I export reports?',
    answer: 'Go to Reports from the bottom navigation. You can export your data as CSV, PDF summary, or a full profit report. You can also export all your data as JSON from Settings → Export All My Data.',
  },
  {
    question: 'What columns are in each CSV export?',
    answer: (
      <div>
        <p className="mb-3">Each export type produces its own column set, scoped to what that report needs:</p>
        <ColumnGroup
          title="All Loads / Filtered Loads / Monthly Summary / Per-Week (17 columns)"
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
    ),
  },
  {
    question: 'What\'s inside the weekly / monthly PDF report?',
    answer: (
      <div>
        <p className="mb-1">Each branded PDF is laid out as: a header with your company name and date range, a totals strip, a per-load table, pay variance callouts for short-paid or unpaid loads, and a brief lane and broker summary.</p>
        <PdfMockPreview />
      </div>
    ),
  },
  {
    question: 'How does the Pricing → Profit Intelligence link work with direct URLs and refreshes?',
    answer: (
      <div className="space-y-2">
        <p>The "Profit Intelligence" link on the Pricing page navigates to <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">/#profit-intelligence</code> on the home page. The same URL works as a direct, shareable link or after a full page refresh — the home page reads the hash on mount and instantly anchors the viewport to the Profit Intelligence section.</p>
        <p>The scroll uses <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">behavior: 'auto'</code> (instant) and polls for the section element across animation frames, so there is no top-flash, smooth-scroll jump, or flicker on first load. You land directly on the four flagship cards (Score a Load, Best/Worst Lanes, Money-Slip Alerts, Weekly Pulse) followed by the interactive demo.</p>
        <div className="flex items-center gap-1.5 text-xs text-primary font-semibold mt-2">
          <Link2 className="h-3 w-3" />
          <span>Direct link: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">https://haultrackerpro.com/#profit-intelligence</code></span>
        </div>
      </div>
    ),
  },
  {
    question: 'Which demo inputs are used when I tap "Use My Numbers"?',
    answer: (
      <div>
        <p className="mb-3">The Profit Intelligence demo on the home page sends the following values into the Load Entry form when you tap <strong className="text-foreground">"Use My Numbers in HaulTrackerPro"</strong>:</p>
        <ul className="space-y-1.5">
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
        <p className="text-xs text-muted-foreground italic mt-3">Pickup, dropoff, dates, and broker stay empty so you can fill in the real load. Broker on-time % is demo-only and does not transfer — it would be derived from your real broker reliability data inside the app.</p>
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

export default function FAQ() {
  const navigate = useNavigate();

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
        <h2 className="text-2xl font-black font-heading mb-6">FAQ</h2>
        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="border rounded-xl px-4 bg-card shadow-card">
              <AccordionTrigger className="text-sm font-semibold text-left hover:no-underline">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </main>
    </div>
  );
}
