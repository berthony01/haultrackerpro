Phase 3 plan approved.

Please execute Phase 3 exactly as scoped:

- audit-first

- no new features

- no redesigns

- no billing/Stripe rewrites

- no RLS/contracts/reports/routing rewrites unless a launch-blocking issue is found

- surgical fixes only

Add these small requirements to the final deliverable:

1. Include proof screenshots for key passing areas, not only issues:

- mobile driver dashboard

- mobile recruiter dashboard

- recruiter Reports panel

- contract page

- pricing page

2. Include a claim-to-feature truth table:

For each major public claim, list:

- claim

- where it appears

- feature backing it

- plan gating

- pass/fail

Include at minimum:

- Verified Recruiter badge

- Driver contact requests

- Contract Protection

- Priority Placement

- Recruiter Activity & Pipeline reports

- Driver premium reports

- In-app approval/signature record

- No DocuSign/signed PDF claim

- No in-app chat claim

- No multi-seat claim

3. Include a final go/no-go checklist:

- launch now

- launch after fixes

- do not launch

4. For remaining Supabase warnings, clearly separate:

- must fix before launch

- safe to defer

- needs owner/manual review

5. If any fix touches more than 30 lines or could affect billing, auth, RLS, contracts, reports, or routing, stop and report it instead of implementing automatically.

Proceed with Phase 3 in order and return the final launch-readiness report.

# Phase 3 — Final Launch Readiness

Scope: audit-first, surgical fixes only. No new features, no redesigns, no billing/RLS/contracts/reports/routing rewrites. Target ≥ 9.5/10.

## 1. Performance pass

- Run production `vite build` and inventory chunk sizes. Compare against `vendor-react / vendor-data / vendor-ui / vendor-pdf / vendor-ocr` splits already in `vite.config.ts`.
- Identify chunks > 200 KB gz still loading on first paint of: `/`, `/pricing`, `/dashboard` (driver), `/dashboard` (recruiter), reports, contracts, opportunities.
- Verify already-deferred heavy modules stay deferred:
  - `jspdf` + `jspdf-autotable` (recruiter + driver report PDFs)
  - `tesseract.js` (receipt OCR)
  - `recharts` (only on dashboard / reports)
  - `html2canvas` / `dompurify` (contracts)
- Safe optimizations only:
  - Convert any top-level import of `recharts`, `jspdf`, `tesseract.js`, `html2canvas`, `dompurify` found outside their feature surface into a dynamic `import()`.
  - Add `loading="lazy"` + explicit `width`/`height` to any below-the-fold landing images missing them.
  - Confirm `<link rel="preload" as="image">` on the LCP image of `/` (skip if no clear LCP image).
- Out of scope: route-level code splitting refactors, new lazy boundaries, Suspense rework.

## 2. Final manual QA walkthrough

Use `browser--navigate_to_sandbox` and the existing `ViewModeSwitch` (admin-only) to exercise five personas. Capture screenshots only when an issue is found.

Personas:

1. Driver (no admin)
2. Recruiter Starter
3. Recruiter Growth/Fleet
4. Admin in Driver View
5. Admin in Recruiter View

For each, verify: login, role switcher (admin only), correct bottom nav, correct sidebar nav, mobile nav, direct-URL guards on `/dashboard?page=recruiter-access*`, driver Reports, recruiter Reports panel, contract workflow surface loads, opportunity post form gating, priority placement reflects plan, pricing CTA gating.

Record results in a Markdown table; only fix issues that are launch-blockers and < 30 LOC.

## 3. Supabase linter triage

Run `supabase--linter`, then classify each remaining warning into one of:


| Bucket                 | Action                                                     |
| ---------------------- | ---------------------------------------------------------- |
| Must fix before launch | Apply migration this phase                                 |
| Safe to defer          | Document in `docs/MANUAL_QA_CHECKLIST.md` post-launch list |
| Needs manual review    | Note + owner                                               |


Specifically review:

- `rls_disabled_in_public` / always-true `USING (true)` policies → confirm each is intentional (public lookup tables, marketing surfaces) or fix.
- `policy_exists_rls_disabled`
- Public storage buckets — verify only `avatars` / marketing assets are public.
- `security_definer_function` warnings — confirm each is callable only via RPC with internal authz checks (e.g. `withdraw_opportunity_application`, `respond_to_contact_request`). If any is overly broad, restrict `GRANT EXECUTE`.

Fix only launch-blockers via a single migration if needed.

## 4. SEO + stale-claim sweep

Audit pages: Landing, Pricing, RecruiterLanding, RecruiterFAQ, RecruiterGuide, RecruiterFeatures, Privacy, Terms, Features, FAQ, all contract SEO pages (`AiContractReviewForTruckers`, `OwnerOperatorContractReview`, `TruckingContractReview`, `LeasePurchaseContractRedFlags`, `TenNinetyNineTruckDriverContractProtection`, `TruckingEscrowAgreementReview`), driver SEO/long-tail pages.

For each page check:

- `<title>` < 60 chars, unique, keyword-led
- `<meta description>` < 160 chars, unique
- Single `<h1>`
- `<link rel="canonical">` set to `https://haultrackerpro.com{path}`
- JSON-LD (Article / FAQPage / Product) where applicable, valid JSON
- OG/Twitter tags present

Stale-claim grep against full source tree (case-insensitive):

- `free trial`, `14[- ]day`, `trialing` (already covered by `noTrialLanguage.test.ts` — re-run)
- `in[- ]app chat`, `chat with drivers`, `message drivers directly`
- `DocuSign`, `e[- ]signature platform`, `legally binding signature`
- `signed PDF`, `download signed contract`
- `multi[- ]seat`, `team seats`, `invite teammates`
- `advanced analytics`, `analytics dashboard` (unless backed by real feature)
- `AI[- ]assisted` claims → confirm matches actual contract review surface

Update wording in-place where stale. Update `public/sitemap.xml` if any indexable route is missing or any listed route 404s. Re-verify `public/robots.txt` disallow list still matches private routes.

## 5. Legal / copy final pass

Read `src/pages/Terms.tsx` and `src/pages/Privacy.tsx` end-to-end and confirm sections explicitly cover:

- Driver data (loads, expenses, fuel, profit, tax)
- Recruiter data (opportunities, applications, contact requests)
- Contract uploads (storage, retention, deletion)
- AI-assisted contract review (not legal advice disclaimer)
- In-app signature record (electronic record, not e-sign certification)
- Recruiter reports (scope, recruiter-owned data only)
- Report exports (PDF/CSV, user responsibility)
- "No legal/tax/accounting advice" boilerplate present and visible

Add minimal targeted paragraphs only if a gap is found.

## 6. Mobile QA (375×812)

`browser--set_viewport_size 375 812`, then walk: Landing, Pricing, Driver Dashboard, Driver Reports, Driver Contracts, Driver Opportunities, Recruiter Dashboard, Recruiter Reports, Recruiter Contracts, Recruiter Applications, Settings.

Per page confirm: no horizontal scroll, tap targets ≥ 40px, bottom nav visible + functional, "More" sheet opens, report range/date controls usable, contract panels scroll cleanly, modals don't clip viewport.

Fix only `whitespace-nowrap`, overflow-x, or `clamp()` regressions surgically.

## 7. Publish dry-run

Sequence:

1. `bunx vitest run` — all green (including `noTrialLanguage`, `featuredSync`)
2. Production `vite build` — no errors, chunk sizes captured
3. Re-run `supabase--linter` post-migration → confirm warning count
4. `bunx tsx scripts/audit-sitemap.ts` if it exists and is wired
5. Visual smoke on preview URL: landing, pricing, /dashboard logged out → /auth, /dashboard logged in

## 8. Phase 3 launch report (final deliverable)

Markdown report with:

- Per-section findings + severity
- Files changed (expected ≤ 6)
- Final score
- Launch / no-launch recommendation
- Remaining post-launch backlog

## Technical notes

- Files likely touched (surgical only): possibly 1 Supabase migration, possibly 1–3 SEO/copy tweaks in marketing pages, possibly 1 mobile-overflow fix. If everything passes audit, **zero files change** and the deliverable is the report.
- All Phase 3 work runs read-only first; any change is gated on a specific finding.
- Risk: Lighthouse-style perf in-browser is approximate; we will rely on real bundle sizes + dev tools profile rather than synthetic scores.

## Approval

On approval I will execute Phase 3 in order 1 → 7, then deliver the Phase 3 launch report (§8). No billing / Stripe / RLS contract / routing rewrites.