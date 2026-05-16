# Recruiter Parity + Dual-Audience Landing — Phased Plan

Goal: give recruiters a fully separate experience (settings, help/docs, what's new) that mirrors the driver side without leaking driver-only features, refresh the legal pages to match, and rebuild the landing page so it converts both audiences clearly.

We'll ship in 5 phases so each piece is verifiable before the next starts. Nothing on the driver side changes behaviorally — driver routes, Settings, FAQ, Features, How-To, What's New, and BottomNav stay exactly as they are today.

---

## Phase 1 — Recruiter Settings page

A dedicated settings surface for recruiter accounts. Driver `SettingsView.tsx` is untouched.

New: `src/components/opportunities/recruiter/RecruiterSettingsView.tsx`, routed via `Index.tsx` as `page === 'recruiter-settings'` and reached from the recruiter sidebar/bottom nav "Settings" entry (driver settings stays at its current page key).

Sections (all backed by existing tables — no schema changes):
- **Company profile** — company name, DOT, MC, address, hiring states, equipment types, contact phones (edits `recruiter_profiles`, reuses validation from `RecruiterOnboarding`).
- **Recruiter contact** — display name, recruiter phone, public-facing email.
- **Verification status** — read-only badge (pending / approved / rejected) + admin notes.
- **Billing & plan** — current plan, period end, active opportunity limit, "Manage billing" → `recruiter-billing-portal` edge function, "Upgrade/Change plan" → `create-recruiter-checkout`. Reuses `useRecruiterBilling`.
- **Notifications** — toggles for new-application emails and weekly recruiter digest (stored on `recruiter_profiles` as nullable bool columns added later if needed; Phase 1 ships UI + local state stubs only if columns don't exist yet — confirm before adding columns).
- **Account** — change password, sign out, delete account (reuses existing modals).

Hide every driver-only setting (pay model, CPM, week start, tax planner, fuel/expense defaults, home-time, lifecycle emails about loads).

## Phase 2 — Recruiter Help Center (FAQ + Features + User Guide + What's New)

Four new routes, recruiter-scoped, with the same visual system as the driver pages.

| New route | Mirrors | Content focus |
|---|---|---|
| `/recruiter/faq` | `src/pages/FAQ.tsx` | Posting opportunities, verification, billing/Stripe, applicant contact, moderation, refunds, contract protection from recruiter POV |
| `/recruiter/features` | `src/pages/Features.tsx` | Driven from a new `recruiterFeatureList.ts` (mirrors `featureList.ts`): opportunity posting, applicant pipeline, contract protection, verified badge, billing portal, analytics |
| `/recruiter/guide` | `src/pages/HowToUseHaulTrackerPro.tsx` | Step-by-step: get approved → set up billing → post first opportunity → manage applicants → use contract protection |
| `/recruiter/updates` | `src/pages/Updates.tsx` | New `recruiterReleaseNotes.ts` with recruiter-relevant entries only |

Wiring:
- Add the 4 routes in `App.tsx`.
- Add a "Help & resources" group in recruiter sidebar / settings linking to all four.
- `WhatsNewModal` / `useReleaseNotesSeen` get a role-aware source: drivers see `releaseNotes.ts`, recruiters see `recruiterReleaseNotes.ts`.
- SEO: each page gets its own `SEOHead` (title, description, canonical, noindex off so they're crawlable for recruiter acquisition).

## Phase 3 — Terms of Service & Privacy Policy refresh

Edit `src/pages/Terms.tsx` and `src/pages/Privacy.tsx` only (no new routes). Add explicit recruiter-side clauses that match what we actually do today:

Terms additions:
- Recruiter eligibility (must be authorized to hire for a registered carrier; DOT/MC required).
- Truthfulness of opportunity postings; prohibited content.
- Verification, suspension, and removal rights.
- Billing terms (Stripe, plan limits, proration, cancellation, refund policy).
- Contact-sharing model (driver consent → recruiter receives snapshot).
- Contract Protection responsibilities (recruiter is the contract author; AI output is informational).
- Acceptable use & anti-scam clauses.

Privacy additions (extend existing sections, don't duplicate):
- Recruiter data we collect (company, DOT/MC, verification docs, billing IDs).
- Public visibility of approved recruiter profiles vs private fields.
- How driver contact snapshots flow to recruiters and retention rules.
- Stripe data handling for recruiter billing.

Both pages get a bumped "Last updated" date driven by a constant (not `new Date()` — current code uses today's date which is misleading).

## Phase 4 — Dual-audience landing page

Rebuild `src/pages/Landing.tsx` so a first-time visitor of either type can self-identify and see a value prop within one scroll.

Structure:
```text
[ Nav: Logo | Drivers | Recruiters | Pricing | Sign in | Get started ]
[ Hero ]
  Headline: "The trucking platform that protects drivers and connects recruiters."
  Sub: one sentence per audience.
  Dual CTA: "I'm a driver" → /auth?intent=driver
            "I'm a recruiter" → /auth?intent=recruiter
[ Audience tabs / toggle ] (sticky, switches the next 3 sections in place)
  ── Drivers view ──            ── Recruiters view ──
  Problem → Solution            Problem → Solution
  3-up feature grid             3-up feature grid
  Screenshot/mockup             Screenshot/mockup
  Driver testimonial slot       Recruiter testimonial slot
[ Shared trust strip ] verified carriers, contract protection, secure billing
[ How it works ] two parallel columns (Driver 1-2-3 / Recruiter 1-2-3)
[ Pricing teaser ] driver tiers + recruiter tiers side-by-side → /pricing
[ FAQ teaser ] 3 driver + 3 recruiter Qs, links to respective FAQs
[ Final CTA ] dual buttons again
[ Footer ] split into Drivers / Recruiters / Company / Legal columns
```

Implementation notes:
- Audience toggle is client-state only (no route change); persists choice in `localStorage` so returning visitors land on their last view.
- Pre-select audience from `?for=driver|recruiter` query param (used by ads).
- Reuse existing landing components where they map cleanly; add `RecruiterValueSection`, `RecruiterHowItWorks`, `RecruiterPricingTeaser`.
- Keep all existing driver SEO copy — recruiter copy lives in new sections so we don't lose driver keyword coverage.
- Analytics: fire `landing_audience_selected` + `landing_cta_clicked` with the audience label.

## Phase 5 — QA, polish, publish

- Manual QA matrix (driver-only account, recruiter-only account, owner/admin with both):
  - Driver account sees no recruiter settings / help / updates entries.
  - Recruiter account sees no driver settings, no driver FAQ/Features/Guide/Updates in nav.
  - Owner (`berthonyxyz@gmail.com`) can toggle via "Open Recruiter Console" and switch back cleanly.
- Add 3 vitest smoke tests: role-gated routing for `/recruiter/*` pages, recruiter release-notes source selection, landing audience toggle default from query param.
- Update `docs/MANUAL_QA_CHECKLIST.md` with the new flows.
- Sitemap: add the 4 recruiter help routes; landing canonical stays `/`.
- Save a memory entry summarizing recruiter parity surfaces so future agents don't accidentally bolt recruiter UI onto driver pages.

---

## Out of scope (call out so we don't scope-creep)

- No changes to driver Settings / FAQ / Features / How-To / Updates content.
- No DB schema changes beyond optional notification toggles in Phase 1 (will confirm before adding columns).
- No new edge functions; reuses `create-recruiter-checkout` and `recruiter-billing-portal`.
- Pricing page redesign is a separate task — Phase 4 only links to it.

## Open questions before I start building

1. For Phase 1 notification toggles, OK to add two nullable bool columns to `recruiter_profiles` (`notify_new_applications`, `notify_weekly_digest`) or hold them out of v1?
2. For Phase 4, do you want a hard audience toggle (Drivers | Recruiters tabs) or a soft "smart default" where the page detects intent and shows both inline?
3. Any specific recruiter testimonials/logos you want featured, or should I leave placeholder slots?
