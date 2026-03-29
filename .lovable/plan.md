

# HaulTrackerPro — Bug Fixes, AI Integration & Pricing Update

This is a large initiative. I'll break it into **4 phases** to be implemented sequentially, ensuring each phase is stable before moving on.

---

## Phase 1: Bug Fixes & Infrastructure Gaps

These are non-AI items that should be resolved first.

### 1.1 Trial Expiry Scheduler (Critical)
The `expire_ended_trials()` function exists but nothing calls it. Set up a **pg_cron** scheduled job to call it every hour.
- Enable `pg_cron` and `pg_net` extensions via migration
- Insert a cron schedule (via insert tool) that calls the function hourly

### 1.2 Error Boundary
- Create `src/components/ErrorBoundary.tsx` — a class component that catches runtime errors and shows a friendly "Something went wrong, tap to reload" screen
- Wrap the app in `App.tsx` inside this boundary

### 1.3 PWA Manifest
- Create `public/manifest.webmanifest` with app name, icons (192 & 512), theme color (#f97316), display: standalone
- Add `<link rel="manifest">` to `index.html`

### 1.4 Fix Hardcoded Lovable URLs
- `src/lib/loadUtils.ts` lines 298 & 320 — change `haultrackerpro.lovable.app` → `haultrackerpro.com`
- `supabase/functions/create-checkout/index.ts` line 106 — change fallback to `https://haultrackerpro.com`
- `supabase/functions/customer-portal/index.ts` line 38 — same fix

### 1.5 Missing React Key Props
- Review and fix `.map()` calls in `AlertsView.tsx` (line 117 already has keys — confirmed OK)
- `ProTimeSavedCard.tsx` line 87 — already has `key={chip.label}` ✓
- `FuelLogForm.tsx` line 166 — already has `key={load.id}` ✓
- These appear resolved. Will double-check during implementation.

---

## Phase 2: AI Integration (5 Features)

All AI features use **Lovable AI** (gateway at `ai.gateway.lovable.dev`). The `LOVABLE_API_KEY` is already provisioned. I recommend using `google/gemini-2.5-flash-lite` for most features (cheapest, fast, sufficient for structured extraction and short summaries) and `google/gemini-2.5-flash` for the weekly report (needs slightly better reasoning).

**Estimated cost per Pro user: ~$1-2/month** — well within margin even at $15/mo.

### 2.1 Database: `ai_insights` Cache Table
New table to cache all AI-generated content (avoids repeat API calls):

```
ai_insights (
  id uuid PK,
  user_id uuid NOT NULL,
  insight_type text NOT NULL,  -- 'lane_advice' | 'weekly_report' | 'tax_tips'
  content text NOT NULL,
  context_hash text,           -- hash of input data to detect staleness
  generated_at timestamptz DEFAULT now(),
  week_start date,
  created_at timestamptz DEFAULT now()
)
```
With RLS: users can only read/insert their own rows.

### 2.2 Edge Function: `ai-insight`
A single edge function that handles all AI insight types via a `type` parameter:
- `lane_advice` — takes aggregated lane stats, returns 2-3 sentences of advice
- `weekly_report` — takes weekly closeout data, returns 3-4 paragraph narrative
- `tax_tips` — takes quarterly expense summary, returns optimization suggestions
- `parse_expense` — takes natural language text, returns structured expense(s) via tool calling
- `parse_ratecon` — takes OCR text, returns structured load data via tool calling

Uses `LOVABLE_API_KEY` to call the Lovable AI gateway. Caches results in `ai_insights` where appropriate.

### 2.3 Smart Load Advisor — AI Weekly Advice
- Modify `SmartLoadAdvisor.tsx` to call `ai-insight` with type `lane_advice` once per week
- Pass aggregated stats (best/worst lanes, RPM, deadhead %) as context
- Display AI-generated personalized advice below the lane rankings
- Cache in `ai_insights` — only regenerate if data changes or 7 days pass

### 2.4 Natural Language Expense Entry
- Modify `VoiceExpenseModal.tsx` to send transcript to `ai-insight` with type `parse_expense`
- AI parses compound sentences into multiple structured expenses
- Falls back to existing regex parser if AI call fails
- Still uses Web Speech API for voice capture (free, client-side)

### 2.5 AI Weekly Business Report
- Modify `WeeklyCloseout.tsx` to call `ai-insight` with type `weekly_report` after finalization
- Pass week stats: loads, miles, revenue, expenses, deadhead, RPM, fuel costs
- Display narrative in a new expandable section
- Cache the result — one generation per closeout

### 2.6 AI-Enhanced Rate Con Parsing
- Modify `ScanLoadModal.tsx` to send OCR text to `ai-insight` with type `parse_ratecon`
- AI extracts structured load data far more accurately than regex
- Falls back to existing `parseLoadText()` if AI fails

### 2.7 Quarterly Tax Optimization Tips
- Modify `TaxEstimateCard.tsx` to show an AI-generated tip (Pro only)
- Call `ai-insight` with type `tax_tips` once per quarter
- Pass expense categories, per diem days, deduction totals
- Cache result in `ai_insights`

---

## Phase 3: Pricing Update

### 3.1 Update Plan Prices
- `src/lib/billing/plans.ts`: Change `pro_monthly` from $15 → $19.99, `pro_yearly` from $10/mo ($120/yr) → $14.99/mo ($179.88/yr)
- **Important**: You'll need to create new Stripe price objects in Stripe dashboard and update the price IDs. The existing Stripe prices can't be edited — new ones must be created.
- Update all references on Landing, Pricing, FAQ pages

### 3.2 Update Marketing Copy
- `Landing.tsx` — update FAQ answer mentioning "$15/month" and add AI features to the demo section
- `Pricing.tsx` — add AI-powered features to the Pro comparison table
- `featureList.ts` — add AI entries: "AI Load Advisor", "AI Weekly Report", "AI Tax Tips", "Natural Language Expense Parsing"
- `FAQ.tsx` — add FAQ about AI features and data privacy
- `HowToUseHaulTrackerPro.tsx` — add AI section

---

## Phase 4: Dashboard Mockup & Polish

### 4.1 New Dashboard Mockup
- Replace `src/assets/dashboard-mockup.png` with an updated screenshot once AI features are visible

---

## Implementation Order

I recommend implementing in this order across multiple sessions:

1. **Phase 1** (bug fixes) — ~1 session
2. **Phase 2.1-2.2** (DB table + edge function) — ~1 session
3. **Phase 2.3-2.7** (wire AI into components) — ~2 sessions
4. **Phase 3** (pricing + marketing) — ~1 session
5. **Phase 4** (mockup) — after everything is live

---

## Cost Analysis

| Feature | Model | Est. Cost/User/Month |
|---------|-------|---------------------|
| Lane Advice | gemini-2.5-flash-lite | ~$0.001 |
| Expense Parsing | gemini-2.5-flash-lite | ~$0.50 (heavy use) |
| Weekly Report | gemini-2.5-flash | ~$0.02 |
| Rate Con Parsing | gemini-2.5-flash-lite | ~$0.05 |
| Tax Tips | gemini-2.5-flash-lite | ~$0.003 |
| **Total** | | **~$0.50-1.50/user/mo** |

At $19.99/mo after Stripe fees (~$19.09 net), AI costs represent 3-8% of revenue. Very sustainable.

---

## Pricing Recommendation

Given the AI features you're adding, raising to **$19.99/mo** now makes sense. Your feature set will be superior to competitors charging $25-40/mo. The annual plan at $179.88/yr ($14.99/mo effective) gives a strong discount incentive.

Shall I start with Phase 1 (bug fixes)?

