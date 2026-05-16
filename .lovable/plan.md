
# Phase 3 & 4 Plan — Recruiter Legal + Dual-Audience Landing

## Phase 3 — Terms of Service & Privacy Policy Refresh

### Files touched
- `src/pages/Terms.tsx` (edit only)
- `src/pages/Privacy.tsx` (edit only)

No DB, routing, or component-structure changes. Same `SEOHead`, same layout shell — content sections only.

### Terms.tsx additions
Insert a new top-level section **"Recruiter & Carrier Accounts"** after the existing driver/user terms, plus minor edits to the Eligibility and Account sections to acknowledge the second audience.

New subsections:
1. **Eligibility & Verification** — Must hold an active USDOT/MC, provide truthful company info, and consent to verification. HaulTrackerPro may reject, suspend, or revoke recruiter access at its discretion.
2. **Truthful Postings** — All opportunity details (pay, lanes, equipment, home-time, benefits) must be accurate at time of posting. Misleading or bait-and-switch postings are grounds for immediate termination.
3. **Driver Contact & Anti-Harassment** — Recruiters may only contact drivers who opt in via the platform. No scraping, no off-platform solicitation of platform-sourced leads, no SMS/calls outside stated hours.
4. **Billing & Subscription** — Plan tiers, monthly/annual billing through Stripe, auto-renewal, refund policy (pro-rated only for platform fault), failed-payment grace period, and downgrade behavior (active posts above new limit are paused, not deleted).
5. **Contract Protection / Direct-Hire Window** — If a driver is hired within 90 days of a verified platform introduction, the recruiter agrees the hire is attributable to HaulTrackerPro and subject to the plan's terms.
6. **Anti-Scam & Fraud** — Prohibition on fake DOT numbers, shell carriers, advance-fee schemes, and impersonation. Right to share fraud signals with industry partners.
7. **Termination** — Grounds and effect on active posts, applicants, and billing.

Bump the **Last Updated** date and add a one-line callout at the top: "Updated to cover recruiter and carrier accounts."

### Privacy.tsx additions
New section **"Recruiter & Carrier Data"** plus extensions to existing sections:

1. **What we collect from recruiters** — Company legal name, DOT/MC, company + recruiter phone, business address, hiring states, equipment types, billing details (handled by Stripe; we store only customer ID + last4/brand).
2. **How we use it** — Verification, fraud prevention, displaying opportunities to drivers, billing, support, and aggregate analytics.
3. **What drivers see** — Public recruiter fields (company name, verified badge, hiring states, equipment, contact via platform). Internal fields (admin notes, raw verification docs) are never shown.
4. **Stripe / payment processors** — Subprocessor disclosure; we don't store full card data.
5. **Driver ↔ recruiter data sharing** — Only opt-in driver profile fields are shared when a driver applies; we never sell driver data.
6. **Retention** — Recruiter accounts retained while active + 24 months for tax/audit; deletion request flow.

Bump **Last Updated** and add the same one-line callout.

### Acceptance
- Both pages render with the new sections in the existing TOC/anchor pattern (if present).
- No driver-facing terms regressed.
- Last-updated dates match.

---

## Phase 4 — Dual-Audience Landing Page

### Goal
One landing page at `/` that clearly serves **two audiences** — owner-operators/drivers and recruiters/carriers — without diluting either message.

### Approach: hard audience toggle
A sticky segmented control at the top of the hero: **For Drivers | For Recruiters**. Selecting one swaps the in-page content (hero copy, feature grid, how-it-works, pricing, testimonials, CTAs). Shared chrome (nav, footer, trust band, FAQ accordion) stays mounted.

- Persist selection in `localStorage` (`landing.audience`).
- Pre-select from `?for=driver` or `?for=recruiter` query param (overrides storage).
- Default = `driver` (existing primary audience).
- Update `<title>` and meta description per audience via `react-helmet-async` (`SEOHead` already in use).

### File plan
- `src/pages/Landing.tsx` — refactor into a shell that renders `<AudienceToggle/>` + `<DriverLanding/>` or `<RecruiterLanding/>`.
- `src/components/landing/AudienceToggle.tsx` — new sticky segmented control.
- `src/components/landing/DriverLanding.tsx` — extract current driver landing sections here (no copy changes beyond minor headline tightening).
- `src/components/landing/RecruiterLanding.tsx` — new, mirrors driver structure with recruiter copy.
- `src/hooks/useLandingAudience.ts` — new hook (query param → state → localStorage sync).

Existing landing subcomponents (hero, feature card, pricing card, testimonial, FAQ, footer CTA) are reused where possible; recruiter variants are thin wrappers passing different props/content.

### Recruiter landing sections (parallel to driver)
1. **Hero** — "Hire qualified, verified drivers — faster." Dual CTAs: *Post an Opportunity* (→ `/auth?role=recruiter`) and *See How It Works*. Trust badges: verified carriers, DOT-checked, contract protection.
2. **The problem we solve** — Empty trucks, ghost applicants, fake leads, no-shows, paying for clicks. Three short pain cards.
3. **How HaulTrackerPro solves it** — Verified driver profiles, in-app pipeline, contract-protection window, transparent pricing, anti-scam screening. 4–6 feature cards using existing card style.
4. **How it works** — 4 steps: Verify your DOT → Post opportunity → Review verified applicants → Hire with contract protection.
5. **Pricing** — Reuse pricing card primitive; show recruiter plans (Starter / Growth / Scale) with active-opportunity limits, applicant access, and contract-protection terms. Link to full pricing.
6. **Social proof / placeholder testimonials** — 2–3 recruiter quotes (placeholder copy, marked as such in code comment so the user can swap).
7. **FAQ** — 5–6 recruiter-specific Qs (verification time, refund policy, what counts as a hire, can we post multiple lanes, do drivers see our contact info, etc.).
8. **Final CTA band** — "Start posting verified opportunities" → `/auth?role=recruiter`.

### Driver landing
Preserved as-is, extracted into `DriverLanding.tsx`. Only change: hero subhead gets one sentence acknowledging recruiters exist on the other tab ("Recruiters welcome too — switch tabs above.").

### SEO
- Single canonical `https://haultrackerpro.com/`.
- `SEOHead` title/description switch by audience:
  - driver: existing copy
  - recruiter: "Hire verified truck drivers faster | HaulTrackerPro"
- Both audience views render in the same DOM tree so crawlers see all content (recruiter section hidden via CSS when driver tab active, not unmounted) — improves SEO without hurting UX.
  - Implementation: render both, toggle `hidden` attr + `aria-hidden`. Confirm performance cost is negligible (static markup, no heavy effects).

### Out of scope
- No changes to `/auth` flow beyond honoring `?role=recruiter` (already supported per prior work).
- No new images generated; reuse existing assets. Hero illustration for recruiter side = existing brand mark + text-only layout.
- No DB or edge-function work.

### Acceptance
- `/` defaults to driver view, identical to today's landing visually.
- `/?for=recruiter` loads with recruiter tab active.
- Toggle swaps content without route change, persists across reloads.
- Both views pass mobile (375px) and desktop (1280px) visual check.
- Lighthouse SEO ≥ existing score.

---

## Sequencing
1. Phase 3 first (small, isolated text edits — low risk).
2. Phase 4 second (landing refactor — bigger blast radius, easier to QA on a stable legal base).

Phase 5 (QA matrix, smoke tests, memory entry, sitemap) remains queued for after Phase 4 lands.

## Open question
For the recruiter pricing section in Phase 4 — should I show the **same Starter/Growth/Scale tiers** that the seeded billing profile implies (`growth` plan, 5 active opportunities), or do you want different tier names/limits? If unsure, I'll use Starter (2 active) / Growth (5 active) / Scale (15 active) as placeholders clearly marked for your review.
