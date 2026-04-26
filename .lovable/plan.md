## Audit findings — what's missing from public pages

I diffed recent shipped work against every public-facing page. Here's what's been added but is **not** mentioned anywhere a prospect can see:


| Recent addition                                                                                                                 | Mentioned publicly?                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Intelligent Parking Finder** (`/parking`, real-time availability reports, safety ratings, points/leaderboard, CSV/PDF export) | ❌ Not on Landing, Features, Pricing, FAQ, footer, sitemap, or `featureList.ts`     |
| **Free Trucker Starter Kit** (`/starter-kit`)                                                                                   | ✅ Footer + Landing CTA + Pricing — but ❌ missing from `public/sitemap.xml` and FAQ |
| **Driver Points + Leaderboard** (gamification tied to parking)                                                                  | ❌ Not mentioned anywhere public                                                    |
| **Expenses pagination** (1000+ expense scaling)                                                                                 | Internal — no public copy needed                                                   |
| **Deadhead pay parsing** in paste-load                                                                                          | ❌ Not surfaced in Features/FAQ                                                     |
| **Mileage parser refactor**                                                                                                     | Internal — no public copy needed                                                   |


The biggest gap by far is **Parking Finder** — it's a real feature with a route, DB tables, RLS, and UI, but a visitor would never know it exists.

---

## Strategic update plan (phased, surgical)

### Phase 1 — Source of truth: `src/lib/featureList.ts`

Add a new top-level category **"Driver Community & Parking (Pro)"** with these entries (this powers `/features` page + the markdown export automatically):

- **Real-Time Parking Finder** — "Find safe truck parking with live availability reports from other drivers. See verified open spots, full lots, and safety ratings near you."
- **Report & Verify Spots** — "Tap a lot to report status (available / limited / full) and rate safety. One report per lot per hour to keep data fresh and trustworthy."
- **Driver Points & Leaderboard** — "Earn points for every verified parking report. Build streaks, climb the leaderboard, and help the trucking community."
- **Parking Log Export (CSV + PDF)** — "Export your logged parking stops weekly or monthly to submit with load paperwork."

Also add to existing **AI Automation (Pro)** category:

- **Deadhead Pay Parsing** — "Paste loads that include deadhead pay and the parser separates it from line-haul automatically."

### Phase 2 — Landing page (`src/pages/Landing.tsx`)

- Add a **single new feature card** (or a 4th tile) in the existing Pro features grid section highlighting "Find Safe Parking, Live" with the Parking icon. Keep copy short, link to `/features#parking` or `/pricing`.
- Do **not** redesign the hero or stack new sections — keep changes additive and on-theme (existing `hsl(220, 20%, 10%)` cards, orange accent).

### Phase 3 — Pricing page (`src/pages/Pricing.tsx`)

- Add **"Real-Time Parking Finder"** and **"Driver Points & Leaderboard"** rows to the Pro feature comparison list.
- Free shows ❌, Pro shows ✅. No price changes, no Stripe touch.

### Phase 4 — FAQ (`src/pages/FAQ.tsx`)

Add 3 new FAQ entries:

- `parking-finder`: "How does the Parking Finder work?" — explains live reports, 1-per-hour throttle, safety ratings, points.
- `parking-points`: "How do I earn driver points?" — 5 points per verified parking report, streaks, leaderboard.
- `parking-export`: "Can I export my parking stops?" — CSV + PDF for weekly/monthly paperwork.

Also add a `starter-kit` FAQ: "What's in the Free Trucker Starter Kit?" pointing to `/starter-kit`.

### Phase 5 — Sitemap (`public/sitemap.xml`)

Add missing public URLs:

- `/starter-kit` (priority 0.8, weekly) — currently absent
- `/features` is already there; `/parking` is **protected** so it correctly stays out of the sitemap.

### Phase 6 — Footer (Landing page footer block)

The footer "Resources" column already lists Free Starter Kit + guides. No change needed there. Confirm copyright year shows 2026.

### Phase 7 — Relevant guide page CTAs (subtle, native)

Add a small "Driver Tools" callout box (existing card style) on these specifically-relevant guides linking to Parking Finder via signup (since `/parking` is protected, the CTA should route to `/auth` with a "Free 14-day trial includes Parking Finder" note):

- `TruckerBookkeepingGuide.tsx`
- `TruckDriverPerDiem.tsx` (parking is part of life on the road)
- `HowToUseHaulTrackerPro.tsx` — add Parking Finder to the walkthrough section
- `TruckingFinanceGuides.tsx` — add Parking + Starter Kit to the resource grid

Do **not** add CTAs to every SEO page — keep it relevant.

### Phase 8 — Verification

- `tsc --noEmit` clean
- All new internal links resolve (no 404s)
- Pricing toggle, Stripe flow, auth, dashboard untouched
- Sitemap XML validates
- Mobile (375px) and tablet (715px) layouts unchanged in spacing

---

## Files that will change

**Modified (8):**

1. `src/lib/featureList.ts` — new category + 1 deadhead entry
2. `src/pages/Landing.tsx` — 1 feature card added
3. `src/pages/Pricing.tsx` — 2 comparison rows added
4. `src/pages/FAQ.tsx` — 4 FAQ entries added
5. `public/sitemap.xml` — `/starter-kit` URL added
6. `src/pages/TruckerBookkeepingGuide.tsx` — small Parking/Starter Kit callout
7. `src/pages/HowToUseHaulTrackerPro.tsx` — Parking Finder walkthrough block
8. `src/pages/TruckingFinanceGuides.tsx` — resource grid update

You are working inside the existing HaulTrackerPro codebase.

We are making a strategic pricing and messaging change:

REMOVE all 14-day free trial language and trial-based positioning.

HaulTrackerPro should now use this clean funnel:

1. Free Trucker Starter Kit = lead magnet
2. Free Plan = app entry point
3. Pro Plan = paid upgrade

Do this carefully in phases.

# PHASE 1 — Audit trial language and trial logic

Search the entire codebase for:

- "14-day"
- "14 day"
- "free trial"
- "trial"
- "trial_ends_at"
- "trial expired"
- "trial banner"
- "trial days"
- "start trial"
- "free for 14 days"
- any plan/access logic tied to trial status

Audit:

- Landing page
- Pricing page
- FAQ
- Features page
- Starter Kit pages
- guide/resource pages
- dashboard upgrade prompts
- billing/subscription components
- Supabase migrations/functions
- plan access logic
- Stripe checkout logic
- email templates
- onboarding copy

Report where trial language or trial logic exists before changing anything.

# PHASE 2 — Remove public-facing trial messaging

Remove or replace all public-facing trial copy.

Replace trial language with:

- "Free plan available"
- "Start free"
- "Create your free account"
- "Upgrade to Pro when you're ready"
- "Unlock Pro tools"
- "Available with Pro"

Do not mention 14-day trial anywhere.

# PHASE 3 — Rewrite pricing page messaging

Update /pricing to use this structure:

Hero headline:  
Simple tracking for free. Pro tools when you're ready.

Hero subheadline:  
Start with HaulTrackerPro's free plan to log loads, track basic income, and understand your numbers. Upgrade to Pro when you want advanced tools like Parking Finder, Smart Load Advisor, deeper reports, and driver intelligence.

Primary CTA:  
Start Free

Secondary CTA:  
Compare Plans

Free plan positioning:  
Best for drivers who want to start tracking loads and expenses without paying upfront.

Pro plan positioning:  
Best for drivers who want deeper profit insight, smarter load decisions, parking tools, exports, and advanced tracking.

Feature comparison should clearly separate:

Free:

- Basic load tracking
- Basic income tracking
- Basic expense tracking
- Starter dashboard
- Free Trucker Starter Kit access
- Basic summaries if currently supported

Pro:

- Smart Load Advisor
- Intelligent Parking Finder
- Driver Points / Leaderboard
- Advanced income and expense reports
- CSV/PDF exports
- Cost per mile intelligence
- Estimated vs actual pay tracking if Pro-gated
- Tax estimate tools if Pro-gated
- Driver Scorecard if Pro-gated
- Advanced alerts if available

Important:  
Only list features under Free or Pro if the code actually supports that plan access.  
Do not invent features.  
Do not make false claims.

Remove:

- start free trial
- trial countdown
- trial expiration copy
- trial urgency
- trial banners on pricing

# PHASE 4 — Remove or safely disable trial logic

If trial logic exists in app-side access control, remove it only if it is safe.

Audit before modifying:

- planAccess utilities
- subscription hooks
- PlanGate components
- TrialBanner components
- trial state hooks
- database triggers that create trial periods
- edge functions that expire trials
- cron jobs related to trials
- Stripe trial settings

Goal:  
Free users should remain Free.  
Pro users should remain Pro.  
Expired/canceled users should fall back to Free unless subscription status says otherwise.

Do not break existing paid subscription access.

If database columns like trial_ends_at exist:

- do not drop them immediately unless safe
- stop relying on them in UI/access logic
- leave migration notes if cleanup should happen later

If cron jobs or functions only exist for trial expiration:

- identify them
- disable only if confirmed not used elsewhere
- do not remove unrelated billing logic

# PHASE 5 — Update dashboard upgrade messaging

Replace trial-based upgrade prompts with clean Free → Pro prompts.

Examples:

Instead of:  
"Your trial ends soon"

Use:  
"Unlock Pro tools for deeper profit tracking."

Instead of:  
"Start your 14-day free trial"

Use:  
"Upgrade to Pro"

Instead of:  
"Trial expired"

Use:  
"You're currently on the Free plan."

# PHASE 6 — Proceed with public-page update plan

Proceed with the earlier public-page alignment plan, but with NO trial wording.

Implement:

1. Update `src/lib/featureList.ts`  
Add:

- Driver Community & Parking category
- Real-Time Parking Finder
- Report & Verify Spots
- Driver Points & Leaderboard
- Parking Log Export

Add to AI/automation category:

- Deadhead Pay Parsing

2. Update Landing page  
Add one native feature card or subtle section for:

- Intelligent Parking Finder
- Driver community reports
- safety ratings
- driver points

Do not redesign the landing page.

3. Update Pricing page  
Add Pro rows for:

- Real-Time Parking Finder
- Driver Points & Leaderboard

No trial language.

4. Update FAQ  
Add FAQs:

- How does the Parking Finder work?
- How do I earn driver points?
- Can I export parking stops?
- What's in the Free Trucker Starter Kit?

No trial language.

5. Update sitemap  
Add:

- /starter-kit

Do NOT add:

- /starter-kit/thanks
- /parking if it is protected

6. Update guide/resource pages selectively  
Update:

- TruckerBookkeepingGuide
- HowToUseHaulTrackerPro
- TruckingFinanceGuides
- any other directly relevant public resource page

Add subtle native CTAs:

- Get the Free Trucker Starter Kit
- Create a free account
- Upgrade to Pro to unlock Parking Finder

Do NOT mention a 14-day trial.

# PHASE 7 — Legal/privacy audit

Because the Starter Kit collects email leads, audit:

- Privacy page
- Terms page
- any email/marketing consent copy

Ensure the Privacy page clearly mentions:

- collecting name/email for downloads
- sending product updates or related emails
- unsubscribe options if marketing emails are sent
- no selling personal info, if true

Do not overdo legal language.  
Keep it plain and consistent.

# PHASE 8 — QA and verification

Run:

- TypeScript check
- build if available
- route checks
- mobile layout review
- pricing flow check
- auth flow check
- dashboard access check
- Pro gating check
- Starter Kit form and download check
- sitemap validation

Verify:

- no 14-day trial language remains
- no trial CTA remains
- Free plan still works
- Pro plan still works
- Stripe checkout still works
- canceled users fall back correctly
- Starter Kit funnel still works
- /starter-kit is in sitemap
- /starter-kit/thanks is not in sitemap
- /parking remains protected and not in sitemap
- Intelligent Parking Finder is reflected on public-facing pages
- footer links work
- no console errors
- no TypeScript errors

# FINAL REPORT REQUIRED

Report:

1. Trial language found
2. Trial logic found
3. What was removed or replaced
4. Pricing page changes
5. Public page updates
6. Feature list updates
7. FAQ updates
8. Sitemap updates
9. Privacy/legal updates
10. Files changed
11. QA results
12. Remaining recommendations

Critical rule:  
Do not break working auth, Stripe, Supabase, dashboard, protected routes, or Pro access.

Proceed phase by phase.

&nbsp;

**Untouched (explicitly preserved):**

- All auth, Stripe, Supabase migrations, dashboard, protected routes, RLS, edge functions
- `App.tsx` routing (parking route already exists and is correctly protected)
- Visual theme tokens — only existing classes/colors used

---

## What I will NOT do

- Won't move `/parking` to a public route (it requires auth + RLS-backed reports)
- Won't redesign Landing or Pricing layouts
- Won't add a marketing section for the paid Starter Pack (per earlier scope)
- Won't add tracking/leaderboard CTAs to unrelated SEO pages

Approve and I'll execute Phases 1–8 in order with a verification pass at the end. 