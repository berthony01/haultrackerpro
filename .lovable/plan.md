# Strict End-to-End Deep Audit Plan

A read-only audit pass across HaulTrackerPro. No code changes during the audit itself. Findings will be grouped as **Blockers** (fix immediately), **Warnings** (fix soon), and **Polish** (nice-to-have). After you approve, I'll execute and deliver a full report; any blocker fixes will be proposed as a separate scoped change.

## 1. Boot & runtime health
- Load `/`, `/auth`, `/dashboard`, `/pricing`, `/features`, `/faq`, `/terms`, `/privacy`, every Contract Protection SEO page, every finance/SEO pillar page, `/how-to-use-haultrackerpro`, `/install`, `/starter-kit`, `/updates`, `/recruiters`, `/admin`.
- For each: check console errors, network 4xx/5xx, infinite spinners, hydration mismatches, white-screen.
- Confirm the Vite chunking fix (Recharts TDZ) is fully resolved in current build.
- Verify lazy-load retry shim and `ErrorBoundary` behavior.

## 2. Landing page audit (`src/pages/Landing.tsx`)
- Hero copy + CTA targets.
- Feature sections: alignment with `featureList.ts` and the actual shipped product (Contract Protection / Clause Rewrite, Profit Check, Personal Intelligence, Weekly Pulse, Tax Planner, Fuel, Voice, Paste, Scan, Recurring Expenses, etc.).
- Pricing, trust, disclaimer, FAQ, footer links.
- Mobile (current 433px), tablet, desktop responsive review.
- A11y: heading order, alt text, contrast, focus states.
- Known console warning: `fetchPriority` casing on `<img>` — flag.

## 3. Legal pages
- `Terms.tsx`, `Privacy.tsx`: completeness, last-updated date, references to Contract Protection / AI disclaimers, Stripe billing, data retention, recruiter data, account deletion.
- Cross-links from footer, auth, pricing.

## 4. SEO audit
- `index.html` head (title, description, canonical, og, JSON-LD).
- Per-route `SEOHead` / `Helmet` usage on each public page: unique titles <60ch, descriptions <160ch, canonical to `haultrackerpro.com`, og fields.
- `public/sitemap.xml` and `scripts/audit-sitemap.ts` — confirm every public route is listed and no admin/internal route leaks.
- `public/robots.txt`, `public/llms.txt`.
- JSON-LD on Contract Protection SEO pages (FAQPage, BreadcrumbList).
- Run `seo_chat--list_findings` for outstanding scanner issues.

## 5. Features & feature copy
- Diff `src/lib/featureList.ts` vs `/features` page render vs Landing feature cards vs Pricing free/pro table vs FAQ vs HowTo.
- Confirm Pro-gated items are labeled Pro everywhere; free items not mislabeled.
- Confirm "planned/future" tools are clearly labeled and not implied as live.
- Contract Protection: Clause Rewrite is Pro and live; other Pro contract tools labeled correctly.

## 6. Core in-app flows (smoke pass)
- Auth: signup, login, reset password, Google OAuth presence.
- Dashboard load, ProfitCheck, PersonalIntelligenceBlocks, WeeklyPulse, SmartAlerts, TaxEstimate, ContributionMargin.
- Add Load (manual + Paste + Scan + Voice), Add Expense, Add Fuel, Recurring Expenses.
- Reports view + PDF/CSV export.
- Opportunities (driver + recruiter views), Contract upload + review + Clause Rewrite gating.
- Settings: cost profile, week-start, tax planner, quarterly reminders, delete account.
- Onboarding modal, milestone nudges, ProUpgradeModal trigger paths.

## 7. Billing & gating
- Free vs Pro vs recruiter-paid separation.
- `useSubscription` checks and `isPro === false` strictness.
- Stripe checkout / customer portal / recruiter checkout edge functions reachable; webhooks intact (no logic changes — just verify code paths exist).
- Auto-trial banner + countdown + cron expiration references.

## 8. Backend / RLS / security
- `supabase--linter` run.
- Spot-check RLS on contract, opportunity, billing, fuel, expense, load, profile, user_roles tables.
- Confirm `has_role` SECURITY DEFINER pattern still in use; no roles on profiles.
- Edge function auth headers + JWT verification config in `supabase/config.toml`.
- `security--get_scan_results` for outstanding items.

## 9. Mobile / responsive
- 360, 390, 433, 768, 1024, 1366 viewport snapshots of Landing, Pricing, Features, FAQ, Dashboard, Contract SEO page.
- Bottom nav, FAB, modals, tables (horizontal overflow), clamp() typography.

## 10. Performance & build hygiene
- Bundle size sanity (no regressed huge chunks after vite.config change).
- Check for orphaned imports, dead routes, duplicate components.
- TS: `npx tsc --noEmit`.
- Tests: `bunx vitest run`.
- Lint: `eslint` (existing config).

## 11. Deliverable
A single structured report:
1. Executive summary (Blockers / Warnings / Polish counts)
2. Per-section findings with file:line references
3. Reproduction notes for each blocker
4. Recommended fix order
5. Proposed next phase (scoped fix PR)

## Out of scope for this audit
- Schema migrations, RLS rewrites, edge function logic changes, AI prompt edits, Stripe product changes, design overhauls. Those would be separate phases proposed at the end.

Approve and I'll execute the audit and return the report.