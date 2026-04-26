# Starter Kit Funnel — Clean Event Tracking

## Phase 1 — Audit (done)

**Existing analytics**: `src/lib/analytics.ts` is a thin, type-safe `gtag` wrapper for GA4 (`G-VTDZSSY5Q6`). Safe-fail design (no-ops if GA missing). Naming convention is `snake_case` event names. **We extend this file — no new system.**

**Current Starter Kit tracking** (already wired, but using legacy names):
| Funnel step | Current helper | Current event name | Status |
|---|---|---|---|
| Page view (`/starter-kit`) | `trackLeadMagnetView('starter-kit')` | `lead_magnet_view` | ✅ fires (useEffect) |
| CTA click (Landing/Pricing/Footer → `/starter-kit`) | — | — | ❌ **missing** |
| Form submit | `trackLeadMagnetSubmit()` | `lead_magnet_submit` | ✅ fires after success |
| Download click | `trackLeadMagnetDownload()` | `lead_magnet_download` | ✅ fires |
| Signup click (Thanks page) | `trackLeadMagnetSignupClick()` | `lead_magnet_signup_click` | ✅ fires |

**Gap**: event names don't match the spec (`starter_kit_*`), and no CTA-click event exists.

## Phase 2 — Add 5 standardized helpers in `src/lib/analytics.ts`

Add these alongside (not replacing) the existing `lead_magnet_*` helpers, so any other call sites or saved GA reports keep working during transition:

```ts
export function trackStarterKitViewed(source?: string) {
  gtag('event', 'starter_kit_page_viewed', { source });
}
export function trackStarterKitCTAClicked(source: 'landing' | 'pricing' | 'footer' | string) {
  gtag('event', 'starter_kit_cta_clicked', { source });
}
export function trackStarterKitFormSubmitted() {
  gtag('event', 'starter_kit_form_submitted');
}
export function trackStarterKitDownloadClicked(source?: 'starter_kit' | 'thanks') {
  gtag('event', 'starter_kit_download_clicked', { source });
}
export function trackStarterKitSignupClicked() {
  gtag('event', 'starter_kit_signup_clicked');
}
```

No new deps. No new providers. Optional `source` param only — UTM params are already captured by GA4 automatically, so we don't re-send them.

## Phase 3 — Page view (`src/pages/StarterKit.tsx`)

In the existing `useEffect` (line 37–40), call `trackStarterKitViewed('starter-kit')` alongside the existing `trackLeadMagnetView` call. The effect only depends on `user?.email` and runs once on mount in practice — fine for our needs.

## Phase 4 — CTA-click tracking (3 surfaces)

- **`src/pages/Landing.tsx` line 562**: wrap the `onClick` to also call `trackStarterKitCTAClicked('landing')` before navigating.
- **`src/pages/Pricing.tsx` line 310**: same, with `'pricing'`.
- **Landing footer link (line 662)**: this is currently a plain `<a href>`. Either (a) attach an `onClick` that fires the event without `preventDefault` so navigation continues, or (b) leave the footer untracked since clicks land on `/starter-kit` which already fires the page view. **Recommendation**: attach the lightweight onClick handler with `'footer'` source — non-blocking, safe.

Pricing.tsx and Landing.tsx have no other `/starter-kit` CTAs (verified via rg). Navigation behavior unchanged.

## Phase 5 — Form submit (`src/pages/StarterKit.tsx`)

In the `handleSubmit` try-block (line 51–53), after `submitLeadMagnet` resolves and before `navigate(...)`, add `trackStarterKitFormSubmitted()` next to the existing `trackLeadMagnetSubmit()`. Already gated on successful validation + DB insert — won't fire on errors.

## Phase 6 — Download click

- **`src/pages/StarterKitThanks.tsx` `handleDownload` (line 31)**: add `trackStarterKitDownloadClicked('thanks')` before `window.open`.
- **`src/pages/StarterKit.tsx` `directDownload` (line 63)**: add `trackStarterKitDownloadClicked('starter_kit')` for the "Already signed in — download now" shortcut.

Fires synchronously before the new tab opens — no duplicate (button fires once per click).

## Phase 7 — Signup click (`src/pages/StarterKitThanks.tsx`)

In `handleSignup` (line 36), add `trackStarterKitSignupClicked()` next to existing `trackLeadMagnetSignupClick()`. Navigation unchanged.

## Phase 8 — QA

- `bunx tsc --noEmit` — type-check.
- `bunx vitest run` — confirm the 20 existing tests still pass (no test changes).
- Spot-check via `rg` that all 5 helpers have at least one call site and no helper is duplicated.

## Phase 9 — Final report

Files modified (5):
1. `src/lib/analytics.ts` — add 5 helpers
2. `src/pages/StarterKit.tsx` — page view + form submit + direct download
3. `src/pages/StarterKitThanks.tsx` — download click + signup click
4. `src/pages/Landing.tsx` — CTA click (hero + footer)
5. `src/pages/Pricing.tsx` — CTA click

## Safety guarantees

- **Auth/Stripe/Supabase**: untouched.
- **Routing**: every `navigate(...)` call preserved; new tracking calls run *before* navigation, synchronously.
- **No new system**: extends existing `gtag` wrapper. Legacy `trackLeadMagnet*` helpers remain (zero risk of regressing other call sites or breaking historical GA reports). They can be removed in a later cleanup once GA dashboards are migrated to the new event names.
- **No PII in events**: only `source` strings, no email/user_id.
- **No re-renders**: helpers are plain functions, not hooks.

## Open question

Should I **also delete** the legacy `trackLeadMagnet*` helpers and their call sites in this same change, or keep them in parallel for one release cycle so any in-flight GA dashboards/funnels keep working? Default in this plan: **keep both**, document for later removal. Let me know if you'd prefer a hard cutover.