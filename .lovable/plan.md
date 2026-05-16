Run a corrected Phase 1 launch-readiness fix pass.

Do not make unrelated changes. Fix only the items below.

1. Fix recruiter Starter pricing card in src/pages/Pricing.tsx.

Starter must clearly include:

- 1 active opportunity

- Verified Recruiter badge

- Applicant pipeline

- Driver contact requests

- Admin-reviewed listings

Do not list Growth/Fleet features under Starter.

2. Fix recruiter FAQ overclaims in src/pages/recruiter/RecruiterFAQ.tsx.

Replace:

"All plans include the applicant pipeline, contract protection, contact-snapshot delivery, and analytics."

With accurate plan-based language:

- Starter includes applicant pipeline, verified recruiter badge, driver contact requests, and 1 active opportunity.

- Growth adds Contract Protection, Priority Placement, Recruiter Activity & Pipeline reports, and 5 active opportunities.

- Fleet adds 25 active opportunities and priority support.

Do not claim analytics dashboard unless it is a real analytics feature.

Do not claim Contract Protection is included in Starter unless that is the intended product decision.

3. Remove or rewrite “free trial” recruiter copy.

In src/components/landing/RecruiterLanding.tsx, remove:

"Can I run a free trial?"

Replace with something like:

"Can I post before paying?"

Answer truthfully based on the actual billing workflow.

Also run the no-trial language guard and ensure it passes.

4. Fix recruiter landing messaging overclaim.

In src/components/landing/RecruiterLanding.tsx, replace:

"message drivers"

With:

"manage driver contact requests"

or

"track driver requests"

Do not imply full in-app messaging exists.

5. Add recruiter Reports to mobile navigation.

In src/components/BottomNav.tsx, add Reports to recruiterMoreItems:

- Reports

- icon: BarChart3 or FileText

- route: recruiter-access:reports

- description: Activity & Pipeline reports

Driver Reports must remain unchanged.

6. Fix or verify Priority Placement billing sync.

Audit the interaction between:

- recruiter_billing_sync_featured()

- opportunities_guard()

- opportunities.featured

Confirm that when a recruiter upgrades Starter → Growth, existing opportunities actually change featured=false to featured=true.

If opportunities_guard blocks the billing trigger update, fix it safely.

Recommended fix:

Update opportunities_guard so system-triggered priority sync can update featured, while normal recruiter/client updates still cannot manually set featured.

Do not rely only on one-time backfill.

QA must prove:

- Starter insert = featured false

- Growth insert = featured true

- Starter → Growth flips existing opportunities true

- Growth → Starter flips existing opportunities false

- canceled/past_due/inactive removes priority

7. Add legal/privacy language for recruiter reports.

Terms and Privacy already cover contract data well. Add only the missing recruiter report/export scope:

- Recruiter reports contain recruiter-owned opportunity/application/contact/contract workflow data.

- Recruiter reports do not include driver loads, fuel, expenses, profit, tax reports, or private driver financial data.

- PDF/CSV exports are the recruiter’s responsibility to store/share securely after download.

8. Fix recruiter reports PDF loading.

Move jsPDF and jspdf-autotable to dynamic imports inside the PDF generation action so opening the recruiter Reports panel does not load PDF libraries until the user actually generates a PDF.

9. Re-run verification:

- Build

- TypeScript

- no-trial language test

- recruiter mobile navigation

- recruiter pricing copy

- Growth/Fleet priority placement

- driver/recruiter role separation

- legal report copy

# HaulTrackerPro — Launch-Readiness Audit

**Audit type:** Read-only review. No code changed.
**Verdict:** **Launch ready after Phase 1 fixes** — current overall score **8.2 / 10**, reaches **9.2 / 10** after the Phase 1 list below.

---

## A. Overall score: 8.2 / 10

## B. Category scores


| Category                  | Score | Notes                                                                                                                                 |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| App loading / performance | 8     | Index.tsx is 884 lines but heavy views are already lazy. A few extras can be split.                                                   |
| Role separation           | 8.5   | Sidebar split by role works; admin view-switcher in place. One direct-URL hardening gap (see F2).                                     |
| Driver features           | 9     | Core load/expense/fuel/reports/contracts all wired with the documented formulas.                                                      |
| Recruiter features        | 8.5   | Pipeline, opportunities, reports, contracts, priority placement all real. Starter card copy is incomplete (see F3).                   |
| Contract workflow         | 9     | Upload → parse → AI review → driver decision → in-app signature is end-to-end. Disclaimers are correctly worded.                      |
| Pricing truthfulness      | 8     | No DocuSign/multi-seat/chat over-claims. Starter bullets are weaker than the actual product (under-promise, not over-promise).        |
| Landing page              | 8     | Long single-page; copy aligns with product. Audit pass on outdated trial language already in place.                                   |
| Legal pages               | 8     | Terms/Privacy present; need a fresh pass to mention Contract Protection consent record + Recruiter Reports data scope.                |
| SEO                       | 8.5   | react-helmet-async wired; sitemap/robots present. A handful of SEO landing pages should be re-checked for stale claims.               |
| Copy consistency          | 8.5   | "HaulTrackerPro" used consistently. Minor "Verified Recruiter" vs "Approved" follow-ups still possible.                               |
| Mobile responsiveness     | 8.5   | BottomNav + sidebar split confirmed. Pricing recruiter card grid validated.                                                           |
| Security / access         | 8     | RLS + trigger guards strong. 87 Supabase linter warnings outstanding (mostly pre-existing `search_path` + SECURITY DEFINER exposure). |
| Database / Supabase       | 8     | Recent priority-placement + contract triggers are tight; older functions still need search_path hardening.                            |
| Code quality              | 8.5   | Lazy splits, typed hooks, RQ everywhere. Some dead/legacy imports remain (see F7).                                                    |


---

## C. Critical blockers (must fix before launch)

**C1. Recruiter Starter plan card under-lists real features**
File: `src/pages/Pricing.tsx` lines 408–417. Starter currently lists only "Approved recruiter / company profile, Applications dashboard, Profit Intelligence integration, Admin-reviewed listings." Real Starter behavior also includes **Verified Recruiter badge** and **Driver contact requests**. Either drivers/buyers will think these are Growth-only, or recruiters will churn after paying because the card doesn't match what they actually get.

**C2. Supabase security linter — 87 outstanding warnings**
Tool: `supabase--linter`. Mix of `function_search_path_mutable`, anon-executable SECURITY DEFINER functions, one always-true RLS policy, and one public-listing storage bucket. Most are pre-existing but at least the **always-true RLS policy (WARN 5)**, the **public bucket listing (WARN 6)**, and any newly created SECURITY DEFINER functions still callable by `anon` must be reviewed before public launch.

**C3. Legal pages have not been refreshed for the new contract + reports surface area**
Files: `src/pages/Terms.tsx`, `src/pages/Privacy.tsx`. Must explicitly cover (a) Contract Protection consent record is not a qualified e-signature, (b) Recruiter Reports contain only recruiter-owned data, (c) uploaded contract file handling and retention.

---

## D. High-priority issues

**D1. Recruiter pricing FAQ partially-true "in-app messaging" answer**
File: `src/pages/recruiter/RecruiterFAQ.tsx` line ~38 — says "In-app messaging is on the roadmap." Acceptable, but landing/pricing cards must not imply it exists. Currently they don't, but worth re-reading after Phase 1 copy pass.

**D2. Pricing comparison row "Contract history, downloads, version comparison, AI follow-ups: Planned Pro tools"**
File: `src/pages/Pricing.tsx` line 80. Correct label, but mixing "Planned" entries inside a yes/no feature grid is confusing. Move to a clearly separated "Coming soon" subsection.

**D3. `RecruiterAccessRoute` lazy chunk is fine, but `RecruiterReportsPanel` pulls `jsPDF` + `autoTable` which is heavy**
Files: `src/lib/recruiterReports/pdf.ts`, `src/components/recruiter/RecruiterReportsPanel.tsx`. Already lazy-imported via `RecruiterAccessRoute`, but confirm the PDF lib itself is dynamic-imported inside `pdf.ts` so the Reports panel skeleton renders fast.

**D4. Direct-URL role hardening**
`Index.tsx` switches views by `page` state but I did not see an explicit redirect when a driver opens `?page=recruiter-access:reports`. Add a guard: if `role==='driver' && !canSwitch`, force `page` back to `dashboard`.

---

## E. Medium-priority issues

- **E1.** Starter recruiter card should display the `1 active opportunity` count alongside the existing limit string for visual parity with Growth/Fleet (already present — verify on mobile).
- **E2.** Pricing Driver "Recurring expenses" feature not surfaced in the free or pro bullet lists.
- **E3.** `ViewModeSwitch` should expose an explicit `aria-label` and persist last view in `localStorage` (already partially memoryized — verify).
- **E4.** Landing page (`src/pages/Landing.tsx`, 983 lines) — split hero/sections into lazy chunks; currently top-of-funnel page ships everything.
- **E5.** SEO landing pages (`OwnerOperator*`, `Trucking*`, `TruckDriver*`) — sweep for any "free trial" or outdated feature names; titles/descriptions vary in length.
- **E6.** Recruiter Reports empty/error states landed but the **date-range echo** under the description should also appear when `isEmpty` (helps users tell whether they typed the wrong range).

## F. Low-priority issues

- **F1.** `src/components/premium/AppSidebar.tsx` driver vs recruiter items duplicated `contracts` and `settings` rows — refactor to a single `commonTail` array.
- **F2.** Consolidate `BarChart3`, `FileSignature`, `Handshake` icon imports.
- **F3.** `Pricing.tsx` uses inline `style={{ ... }}` everywhere instead of design tokens — long-term, move to semantic tokens.
- **F4.** `Index.tsx` should be code-split per role (driver shell vs recruiter shell) — currently both render paths live in one 884-line file.
- **F5.** `useUserRole` checks `sessionStorage` `htp_recruiter_intent` — confirm it is cleared after recruiter profile is created to avoid stale recruiter UI for users that change their mind.
- **F6.** Dead-import sweep: `Users`, `Route`, `TrendingUp` in `Index.tsx` line 55 — confirm all are used in the JSX.

## G. Files / routes involved

- Pricing copy: `src/pages/Pricing.tsx`, `src/components/landing/RecruiterLanding.tsx`, `src/lib/recruiterFeatureList.ts`, `src/lib/featureList.ts`
- Role + routing: `src/pages/Index.tsx`, `src/hooks/useUserRole.ts`, `src/hooks/useViewMode.ts`, `src/components/premium/AppSidebar.tsx`, `src/components/opportunities/recruiter/RecruiterAccessRoute.tsx`
- Recruiter reports: `src/components/recruiter/RecruiterReportsPanel.tsx`, `src/lib/recruiterReports/{aggregator,csv,pdf}.ts`, `src/hooks/recruiter/useRecruiterReportData.ts`
- Contracts: `src/components/contracts/*`, `src/hooks/contracts/*`, contract edge functions
- Legal: `src/pages/Terms.tsx`, `src/pages/Privacy.tsx`
- Database: outstanding linter findings (87) — full list via `supabase--linter`

## H. Recommended fix phases

**Phase 1 (launch blockers — ~1 work session)**

1. C1 — rewrite Starter bullets in `Pricing.tsx` to include Verified Recruiter badge + Driver contact requests.
2. C3 — refresh `Terms.tsx` + `Privacy.tsx` for Contract Protection + Recruiter Reports.
3. C2 partial — fix only the new SECURITY DEFINER + the always-true RLS policy + the public bucket listing. Defer the long tail of pre-existing `search_path` warnings to Phase 4.
4. D4 — direct-URL recruiter route guard for driver accounts.

**Phase 2 (high-priority — ~½ session)**

- D1, D2, D3 (dynamic-import jsPDF inside `pdf.ts`).

**Phase 3 (polish + SEO — ~1 session)**

- E1–E6, sweep all marketing landing pages for stale claims.

**Phase 4 (post-launch)**

- F1–F6, full Supabase linter cleanup, `Index.tsx` split.

## I. Truthfulness check

No found over-claims. Specifically verified absent: DocuSign-equivalent signing, signed PDF generation, in-app chat, multi-seat / team seats, advanced analytics dashboard. All contract-signature copy correctly disclaims as "platform record of consent." Only material truthfulness gap is **under-claim on Starter** (C1).

## J. Final recommendation

**Launch ready after Phase 1 fixes.** After the 4 Phase-1 items, projected score is **9.2 / 10**, comfortably above the 9.0 launch bar.

---

If you approve this plan, I'll implement Phase 1 (C1, C3, C2-subset, D4) in the next message — no other changes will be touched.