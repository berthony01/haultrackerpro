# HaulTrackerPro — Strict Full Ecosystem Audit Plan

This is an audit-first pass. No new features. No redesigns. No schema changes unless a confirmed bug requires it. Fixes will be surgical and explained per file.

## Scope of inspection (read-only)

I will inspect the following without modifying anything until issues are confirmed:

### 1. Build / Type / Routing
- Run TypeScript check (no manual `npm run build` — Lovable runs it automatically; I'll inspect the build/runtime errors knowledge file).
- Verify all `App.tsx` routes resolve to existing pages.
- Verify Opportunities components, admin components, recruiter components compile.

### 2. App navigation
- `BottomNav.tsx`, `premium/AppSidebar.tsx`, `Index.tsx` tab wiring.
- Confirm `app-shell` / `admin-dark` body class lifecycle in `AdminShell.tsx` (mount/unmount).
- Confirm Opportunities is reachable from both desktop + mobile nav.

### 3. Driver Opportunities flow
Files: `OpportunitiesPage.tsx`, `OpportunityCard.tsx`, `OpportunityDetail.tsx`, `DriverOpportunityProfile.tsx`, `DriverApplicationsPanel.tsx`, hooks `useOpportunities`, `useDriverOpportunityProfile`, `useSavedOpportunities`, `useOpportunityApplications`.
Checks: filter is `status='active' AND admin_review_status='approved'`, NaN/Infinity guards, Pro gating on Profit Intelligence, match badge gated on driver profile, withdraw RPC.

### 4. Recruiter flow
Files: `RecruiterOnboarding`, `RecruiterOpportunityManager`, `RecruiterOpportunityForm`, `RecruiterApplicationsDashboard`, `RecruiterBillingPanel`, hooks `useRecruiterProfile`, `useRecruiterOpportunities`, `useRecruiterBilling`.
Checks: gating states, plan/limit enforcement in UI, capacity guard before activation, status transitions (no backward, no withdrawn from recruiter), DB triggers `recruiter_profile_guard`, `opportunities_guard`, `opportunities_billing_guard`, `opportunity_applications_update_guard` (already verified at SQL level via context).

### 5. Recruiter Billing / Stripe
Files: `create-recruiter-checkout/index.ts`, `recruiter-billing-portal/index.ts`, `stripe-webhook/index.ts`.
Checks:
- Customer lookup uses `recruiter_billing_profiles.stripe_customer_id` only — never email search.
- Metadata includes `billing_type='recruiter'`.
- Webhook routes recruiter vs driver subs by metadata.
- Plan ↔ price ID mapping matches `recruiter_plan_limit` (starter=1, growth=5, fleet=25).
- Cancel resets plan='none', status='canceled', limit=0.
- Confirm pricing the user spec'd ($19/$49/$149) matches current Stripe price IDs (will require Stripe lookup if visible).

### 6. Profit Intelligence
File: `lib/opportunities/opportunityProfit.ts`, `OpportunityProfitBreakdown.tsx`.
Checks: deterministic only (no AI/network), gross fallback chain, no NaN, "estimated" wording, Pro gating.

### 7. Match Engine
File: `lib/opportunities/opportunityMatch.ts`, `OpportunityMatchBadge.tsx`.
Checks: deterministic, gated on driver profile, no fit-badge data leak on recruiter side, NaN guards.

### 8. Admin Dashboard
Files: `Admin.tsx`, `AdminShell`, `AdminSidebar`, `AdminOverviewPremium`, `AdminOpportunitiesPanel`, `AdminRecruitersPanel`, hooks `useAdminOpportunities`, `useAdminRecruiters`, `index.css` `.admin-dark` block.
Checks: route protection via `AdminRoute`, dark theme, body class cleanup, moderation actions wired correctly.

### 9. Public Landing
File: `Landing.tsx`.
Audit: Does it mention Opportunities ecosystem? (Quick scan suggests **no** — Landing is driver-only profit tracking copy.)

### 10. Pricing page (likely gap)
File: `Pricing.tsx`.
Audit: Pricing page only shows driver Free vs Pro. **Confirmed gap from initial read: no recruiter pricing tier (Starter $19 / Growth $49 / Fleet $149) is shown publicly.** This will be flagged + fixed surgically with an additional "For Recruiters" pricing block.

### 11. Terms / Privacy
Files: `Terms.tsx`, `Privacy.tsx`.
Audit: Confirm coverage for recruiter accounts, opportunity data, recruiter billing, contact-snapshot sharing, no guaranteed earnings/jobs language, admin moderation rights.

### 12. SEO / Internal linking
Files: `Landing`, `Pricing`, `FAQ`, `Features`, footer, `SEOHead`.
Audit: Recruiter access discoverability, dead links, accurate metadata.

### 13. Database / RLS
- Run `supabase--linter`.
- Spot-check RLS policies on `opportunities`, `recruiter_profiles`, `recruiter_billing_profiles`, `opportunity_applications`, `driver_opportunity_profiles`, `saved_opportunities`.
- Verify guard triggers (already inspected via context — they look correct).

## Fix policy

For each confirmed issue I will:
- Patch the smallest surface area (single file or single function when possible).
- Preserve all unrelated code, routes, copy, and design tokens.
- Re-state the file diff in the final report.

For confirmed gaps that require a UI block (e.g. recruiter pricing tile on `/pricing`), I will add the minimum block needed without redesigning the rest of the page.

For risky/large issues I will **report only**, not fix, and flag as "Remaining limitation" for explicit user approval.

## Out of scope (will not touch)

- `LoadForm.tsx`, `computeLoadPay.ts`
- Reports (`ReportsView`, `reportPdf`, `reportCsv`, `reportTax`)
- Parking logic
- Driver Pro Stripe path (`create-checkout`, driver subscription rows)
- AI / Lovable AI Gateway calls
- Any database schema change unless a security finding requires it
- Visual redesign of Landing, Pricing, Terms, Privacy beyond the recruiter-pricing addition

## Deliverable

A strict 18-section report (per the user's spec) covering: PASS/PARTIAL/FAIL, build, files inspected, files changed, every functional area, confirmed fixes, remaining limitations, and a manual QA checklist.

After approval I will execute the audit + any surgical fixes in build mode and post the full report.
