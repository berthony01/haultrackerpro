# Phase 18E — 12-Week SEO/AEO Content Calendar (Completed)

Goal: give the admin/owner a structured 12-week planning surface for SEO
and AI Answer Engine (AEO) resource articles, feeding the Phase 18D
Article Draft Approval System. Planning only — no auto-publish, no
seeding of `resource_articles`, no public route exposure.

## What shipped

### Calendar data (`src/lib/contentCalendar.ts`)
- 24 planned articles across 11 topic clusters (profit, RPM, fuel,
  taxes, contracts, expenses, parking, referrals, recruiter, bookkeeping,
  cost-per-mile).
- Each entry: `id`, `week`, `recommended_publish_day`, `topic_cluster`,
  `priority`, `disclaimer_required`, `title`, `slug`, primary +
  secondary keywords, target audience, `search_intent`, `content_angle`,
  outline sections, suggested FAQs, suggested internal links,
  `recommended_cta`.
- `CALENDAR_SUMMARY` (total weeks, articles, per-week, main clusters).
- `buildDraftPrompt(article)` — generates a safety-bounded brief
  (no invented stats, no guarantees, disclaimer rules) for paste into
  the Article Manager.

### Admin Calendar UI (`src/pages/admin/ContentCalendarAdmin.tsx`)
- Route: `/admin/content-calendar`, lazy-loaded and wrapped in
  `AdminRoute` in `src/App.tsx` (admin-only; non-admins redirect via
  `useAdmin`).
- Week-by-week list grouped by `week`, with cluster filter.
- Summary cards (weeks, planned articles, per week, clusters, manual
  approval).
- **Content Safety Rules** panel (no AI auto-publish, no invented
  stats/quotes, no guaranteed results, disclaimers for tax/legal/
  financial topics, manual sitemap + llms.txt updates).
- Per-article card with copy-to-clipboard AI draft prompt and a link
  to `/admin/resource-articles` (Article Manager).
- `<SEOHead noindex>` to prevent indexing.

### Navigation
- "Content Calendar" link added to admin-only sidebar footer in
  `src/components/admin/AdminSidebar.tsx`, alongside the existing
  "Resource Articles" link.

### Public exposure
- `/admin/*` is already blocked in `public/robots.txt`
  (`Disallow: /admin`).
- Not added to `public/sitemap.xml` or `public/llms.txt`. Confirmed
  via grep — only `Disallow: /admin` mentions admin.

## Verification (final pass)

- `npm install` — already installed, no-op.
- `npm run build` — ✅ built in ~18s, no errors. Bundle includes
  `ContentCalendarAdmin-*.js` (~33 kB).
- `npm run test` (vitest) — ✅ 279/279 passed across 26 files.
- `npm run seo:audit` — ✅ sitemap audit passed; no admin routes
  present.
- Route gating: `<Route path="/admin/content-calendar"
  element={<AdminRoute><ContentCalendarAdmin/></AdminRoute>} />` plus
  `useAdmin()` redirect inside the page (defense-in-depth).
- Sidebar link present in admin sidebar; Article Manager link in the
  page header points at `/admin/resource-articles`.

## Out of scope (not touched)

Billing, Stripe, Supabase RLS, calculations, reports, loads, expenses,
fuel, parking, contracts, recruiter dashboards, driver dashboards,
notifications, public SEO pages, pricing logic, auth.

## Next phases (suggested)

- Phase 18F — Testimonials / Trust Proof.
- Phase 18G — Dynamic sitemap generation from `resource_articles` so
  published drafts auto-appear in `sitemap.xml` / `llms.txt`.
- Phase 18H — First article draft batch generated through the approval
  flow.
