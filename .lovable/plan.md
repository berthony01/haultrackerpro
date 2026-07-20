
# Phase 1J-D1 — Pricing, Plan Entitlement, and Access-Gating Audit

**Verdict: PARTIAL — one critical false-advertising defect (Pro feature paywall enforced client-side only), several stale/inconsistent copy defects, and multiple items requiring deeper server-side trace before a final PASS/FAIL can be issued. No security-boundary-breaking data leak identified in Driver Pro gating (client bypass gives access only to the user's own data), but the pricing page's paywall promise is not backed by server enforcement for most Pro features.**

## A. Proof

- **HEAD:** `b0ba15a7d21ae967f09689eb5132db877938a612` (clean, no changes staged)
- **Method:** static trace of pricing → billing definitions → client hooks → components → edge functions → webhook → live DB references. No mutation, no deploy, no Stripe/Supabase changes.
- **Scope caveat:** an exhaustive server-side trace of every RLS policy, every RPC, every migration touching `subscriptions`, `recruiter_billing_profiles`, `agency_entitlements`, `parking_locations`, `opportunities`, and `opportunity_applications` was **not** completed in this audit turn. Items marked **CANNOT-CONFIRM** below require a second audit turn to trace live-DB privileges/policies before promotion to PASS or FAIL.

## B. Canonical plan matrix

**Driver** (`src/lib/billing/plans.ts`)

| Plan | Key | Price | Interval | Price ID | Status→Pro |
|---|---|---|---|---|---|
| Free | `free` | $0 | — | none | never |
| Pro Monthly | `pro_monthly` | $19.99 | month | `price_1TGMZ7I2TXbeuHi41ceyf1zP` | only `status='active'` |
| Pro Annual | `pro_yearly` | $14.99/mo ($179.88/yr) | year | `price_1TGMZ8I2TXbeuHi4VmSGUcRK` | only `status='active'` |

**Recruiter** (`src/lib/recruiterCapabilities.ts`, `create-recruiter-checkout`)

| Tier | Key | Capabilities |
|---|---|---|
| Free / Verified | `free_verified` | unlimited standard posts, basic applicant inbox |
| Starter | `starter` | + status history, basic referral tracking |
| Growth | `growth` | + priority placement, featured listings, exports, advanced reports, pipeline analytics, contract workflow, full referral |
| Fleet | `fleet` | + priority support only (team seats / bulk / custom profile / company dashboard are all **kept false** — coming-soon) |

**Assistant / Agency** (`src/lib/agencyPlans.ts`)

| Plan | Members | Clients | Packages | $/mo |
|---|---|---|---|---|
| Assistant Free | 1 | ∞ (per invite) | 0 | $0 |
| Agency Starter | 2 | 5 | 3 | $29 |
| Agency Team | 5 | 25 | 25 | $79 |
| Agency Growth | 15 | 100 | 100 | $149 |

## C. Advertised-feature enforcement matrix (excerpt — critical rows)

| Pricing claim | Real implementation | Client gate | Server gate | Test evidence | Verdict |
|---|---|---|---|---|---|
| Voice / receipt / rate-con AI (Pro) | edge fn(s) `parse-contract`, `ai-insight`, `parse-load-*` | `isPro` on component | **CANNOT-CONFIRM** — edge fns not read this turn; must trace for `check-pro-access` invocation or inline entitlement check | none surfaced | **REQUIRES TRACE** |
| Paste Load Parser 5/wk free / unlimited Pro | `parse_usage` table + client `PasteLoadParser` | `isPro` on component | **CANNOT-CONFIRM** — need to confirm server-side quota enforcement, not client counter | none surfaced | **REQUIRES TRACE** |
| Driver Scorecard (Pro) | `useDriverScorecard`, `DriverScorecard.tsx` computed client-side from user's own loads | `!isPro` early return | **NONE** (data is user's own via RLS) | — | **PARTIAL — hidden button** |
| Weekly Closeout (Pro) | `WeeklyCloseout.tsx` computed client-side | `!isPro` early return | **NONE** | — | **PARTIAL — hidden button** |
| Personal Intelligence / Smart Load Advisor / Weekly Pulse / Contribution Margin (Pro) | client components fed from user's own tables | `isPro` prop | **NONE** | — | **PARTIAL — hidden button** |
| PDF / CSV Pro reports | `ReportsView.tsx` builds locally | `disabled={!isPro}` on button | **NONE** — file is generated in browser | — | **PARTIAL — hidden button** |
| Real-time Parking Finder (Pro) | `parking_locations` + `parking_verifications` tables | `isPro` on `/parking` page and `AddParkingModal` | **CANNOT-CONFIRM** — RLS policies exist (4 on `parking_locations`, 3 on `parking_verifications`) but were not read this turn; unclear if free users can insert/verify directly via the client SDK | — | **REQUIRES TRACE** |
| Advanced smart alerts w/ dollar impact (Pro) | `AlertsView.tsx` filters by tier client-side | `isPro` prop | **NONE** (self-served) | — | **PARTIAL — hidden button** |
| Driver-to-driver referrals (Pro) | `ReferDriverDialog.tsx` + `driver_referrals` table | `isPro` on dialog | **CANNOT-CONFIRM** — 6 policies on `driver_referrals`; need to confirm plan/status is checked in INSERT policy or trigger | — | **REQUIRES TRACE** |
| Recruiter standard posting is free once profile is complete | `opportunities` INSERT / `opportunities_billing_guard` trigger | `RecruiterAccessPage` gates UI on approval | `opportunities_billing_guard` exists in migrations (found 5 refs) — this **is** server-authoritative | phase1f*/phase1g* tests | **PASS (pending re-read of latest guard text)** |
| Recruiter Growth/Fleet paid features (featured listings, exports, pipeline analytics, contract workflow) | Capability object returns booleans | Client gates only in UI | **CANNOT-CONFIRM** — need to trace whether featured/priority listing rendering, report export function, and contract workflow RPCs check `plan` server-side | recruiterCapabilities tests exist (pure) | **REQUIRES TRACE** |
| Recruiter Fleet: team seats, bulk tools, custom profile, company dashboard | Explicitly `false` in `recruiterCapabilities.ts` (coming-soon) | — | — | comment in code | **FALSE ADVERTISING if pricing page lists these as included Fleet features** — must diff pricing bullets against capability booleans |
| Agency limits (members / clients / packages) | `checkAgencyLimit` pure helper + `agency_entitlements` row | `AgencyPlanLimitsCard.tsx` shows usage | **CANNOT-CONFIRM** — need to trace whether `invite_member`, `activate_client`, `create_service_package` mutations are guarded server-side by triggers/RPCs on `agency_members`, `agency_client_requests`, `agency_service_packages`. Client-side check alone is bypassable. | phase7/phase8 tests exist | **REQUIRES TRACE** |

## D. Critical findings

### D1. Driver Pro paywall is client-only for most Pro features (HIGH — false advertising, not a data breach)
- `check-pro-access` edge function exists but has **zero callers** in the client bundle (`rg check-pro-access src` returns none).
- Every Pro-only feature that operates on the driver's own data (scorecard, weekly closeout, personal intelligence, smart load advisor, personal intelligence blocks, weekly pulse, advanced alerts, PDF/CSV exports, tax planner reminders, home time, fuel analytics, contribution margin) is gated **only** by an `isPro` prop passed from `DashboardView` down.
- A user who removes the client-side check (dev tools, forked build, MITM) sees full Pro output on their own data. This is not a data breach (RLS on user-owned tables still applies), but every bullet on `Pricing.tsx` currently promises a paid feature that any Free user can trivially unlock.
- **This is Mr Bert's exact "hidden button is not sufficient security" concern — confirmed.**

### D2. `check-pro-access` is dead code (MEDIUM)
- Defined, deployed, but never invoked. Either wire it into every Pro feature action, or delete it so it does not falsely imply server enforcement.
- Its allowlist (`scorecard`, `advanced_alerts`, `weekly_closeout`, `advanced_exports`, `unlimited_parser`) also does not match the current pricing page bullets.

### D3. Fleet "team seats / bulk / custom profile / company dashboard" — check pricing copy vs. reality (MEDIUM–HIGH)
- Capability layer keeps these `false` even on Fleet (explicit "coming-soon" comment).
- If `Pricing.tsx` recruiter/Fleet section lists any of these as Fleet-included (not planned/coming-soon), that is a **false pricing claim**. Full recruiter pricing section (lines 351–708 of `Pricing.tsx`) was not read this turn and must be re-read to confirm.

### D4. Pro-status definition inconsistency (MEDIUM)
- `isProStatus` (client) accepts **only** `'active'`.
- Webhook `applyEntitlement` also writes `plan_key` and calls it `isActive` on `active | trialing | past_due`.
- Effect: a `past_due` subscription keeps the driver's `subscriptions.plan_key` as `pro_monthly` but `isProStatus('past_due') === false` → the client immediately treats them as Free. This is **fail-closed** — acceptable — but the copy nowhere warns the user that a late payment revokes access instantly. Verify this is intentional.
- Also: `trialing` is a Stripe status the driver checkout blocks upfront (line 122 of `create-checkout`), so it should never appear for drivers; keep an eye on it.

### D5. Recruiter "canUseApplicantNotes" and "basic listing analytics" copy vs. reality (LOW–MEDIUM)
- `recruiterCapabilities.ts` explicitly keeps `canUseApplicantNotes: false` on Starter+ and notes "basic applicant pipeline analytics" is display-only. Pricing page must not list these as included features on Starter/Growth.

### D6. Agency limits — server enforcement unverified (HIGH if unenforced)
- `agency_members`, `agency_service_packages`, `agency_client_requests` have RLS policies (per the injected table list) but the specific check that the *count* does not exceed `effectiveLimits` was not traced. If enforcement is client-only via `checkAgencyLimit`, a Starter agency owner can bypass the 5-client / 3-package / 2-member caps directly via the Supabase JS client.
- **CANNOT-CONFIRM** without reading the relevant triggers or RPCs.

### D7. Parking + Referral entitlement — server enforcement unverified (HIGH if unenforced)
- Same pattern as D1/D6: client gate present, server gate not confirmed. Free users could `supabase.from('parking_locations').insert(...)` and `driver_referrals` if RLS is permissive to any authenticated user without a Pro check.

## E. False / stale pricing-page claims (confirmed and suspected)

- **Confirmed stale-risk:** Every Pro bullet on `Pricing.tsx` implies gating that is client-only (see D1).
- **Suspected (must diff after re-read of lines 351–708):** any Recruiter Fleet bullet claiming team seats / bulk tools / custom profile / company hiring dashboard as *available now* rather than *coming soon* is false (see D3).
- **Copy-only:** `Pricing.tsx` mentions "Contract history, downloads, version comparison, AI follow-ups — Planned Pro tools" — this is honest (row 87).

## F. Feature implemented but not advertised / advertised but not implemented

- **Advertised, not implemented server-side:** everything in D1.
- **Implemented, not surfaced:** `check-pro-access` edge function.
- **Full sweep pending** — this bullet list is preliminary until the deeper trace turn.

## G. Conflicting plan / price sources

- **Two plan-truth files** exist and both are canonical: `src/lib/billing/plans.ts` (driver) and `src/lib/agencyPlans.ts` (assistant/agency). Recruiter plans are enumerated in three places: `recruiterCapabilities.ts` (union type), `create-recruiter-checkout` (`PLAN_TO_ENV`), and `stripe-webhook` (`RECRUITER_PLAN_ENV` + `RECRUITER_PLAN_LEGACY_LIMITS`). These are consistent today but drift risk is high — no central `src/lib/billing/recruiterPlans.ts`.
- **Driver price IDs are hardcoded in the client** (`plans.ts` lines 31, 38) **and** read from env in edge functions. If Stripe rotates a price ID (already caused a prod fire per memory) the client and server can diverge silently.

## H. Status / downgrade / cancellation behavior matrix

| Stripe status | subscriptions.plan_key | isProStatus (client) | Effect |
|---|---|---|---|
| `active` | plan | true | Pro |
| `trialing` (driver) | plan (webhook) | false | fail-closed → Free (driver checkout also blocks trialing upfront) |
| `past_due` | plan (webhook still writes plan) | false | fail-closed → Free (silent revocation, no in-app banner) |
| `canceled` / `unpaid` / `incomplete` / `paused` | `free` (webhook revoke) | false | Free |
| Unknown | plan or `free` | false | fail-closed |

Fail-closed behavior is correct. Missing: user-facing communication when `past_due` silently revokes access.

## I. Recommended remediation phases (smallest safe order)

The audit report above is the deliverable. **No file changes are proposed in this turn.** The following is the recommended sequencing for follow-up phases. Each is a separate authorization turn.

**Phase 1J-D2 — Deeper server-side trace (READ-ONLY, one more audit turn).** Authorized files: none (read-only). Read the remaining recruiter Pricing.tsx bullets (351–708), full `stripe-webhook` (417–744), `opportunities_billing_guard` migration, `parking_locations` / `parking_verifications` / `parking_reports` RLS, `driver_referrals` RLS, all agency limit-enforcement triggers/RPCs, `check-pro-access` callers (final confirmation of dead code), and every `parse-*` / `ai-insight` / `analyze-contract` / `rewrite-contract-clause` / `ai-insight` edge function for entitlement checks. Deliverable: convert every CANNOT-CONFIRM row above to PASS / FAIL / NOT IMPLEMENTED. Verification gate: report only. Stop if any RLS policy is found to grant an unauthenticated or Free user Pro-only mutation.

**Phase 1J-D3 — Copy correction phase (LOW RISK, marketing-only).** Authorized files: `src/pages/Pricing.tsx`, `src/pages/Features.tsx`, recruiter marketing pages, plus tests. Reconcile every bullet against the confirmed matrix from D2. Do not touch billing/entitlement code. Verification gate: rendered evidence tests asserting each corrected bullet is visible and each retired bullet is absent.

**Phase 1J-D4 — Server-side Pro enforcement.** Authorized files: `src/hooks/**`, `src/components/**` Pro-gated components; new SECURITY DEFINER RPCs `assert_driver_pro()` or extend `check-pro-access`. Every Pro action that today is `isPro ?` must additionally invoke a server check whose result cannot be forged from the client. Prefer collapsing per-feature guards into one `assert_driver_pro(_feature)` RPC returning `allowed | denied | not_authenticated`. Verification gates: real-PG test proving `plan_key='free'` cannot invoke each guarded action; real-PG test proving `status='past_due'` is denied; component test proving UI degrades gracefully on deny.

**Phase 1J-D5 — Recruiter paid-feature server enforcement.** Authorized files: opportunity/report/contract RPCs and RLS policies. Every capability that today only lives in `recruiterCapabilities.ts` (featured listings write, priority placement write, report export edge fn, contract workflow RPCs, full referral analytics) must be checked against `recruiter_billing_profiles.plan` + `status` server-side. Verification gate: real-PG matrix per plan × status.

**Phase 1J-D6 — Agency limit server enforcement.** Authorized files: `agency_members`, `agency_client_requests`, `agency_service_packages` INSERT triggers or RPCs. Enforce `checkAgencyLimit` on the server using `agency_entitlements` + `effectiveLimits`. Verification gate: real-PG proof that Starter agency can never store >5 active clients, >2 members, >3 packages regardless of client SDK call.

**Phase 1J-D7 — Central plan truth + drift guard.** Authorized files: new `src/lib/billing/recruiterPlans.ts`, minor updates to webhook/create-checkout imports. Move driver price IDs to a single module read by both client and edge fn (edge fn keeps env-var override for rotation, client reads from the same module). Add a source-guard test asserting client price IDs match `Deno.env` defaults.

**Phase 1J-D8 — Past-due UX.** Small banner + copy update when `status='past_due'` so a driver knows why access disappeared. Authorized files: subscription banner component, `useSubscription`.

## J. Overall verdict

**PARTIAL.** The pricing page is directionally truthful and the recruiter/agency capability model is well-structured. The billing identity guard in the Stripe webhook is genuinely robust. However:

- Driver Pro paywall for the majority of advertised features is **not server-enforced** (D1). This is a false advertising / trust defect, not a data-breach — it needs to be treated as a first-order remediation.
- Multiple high-risk items (agency limits, parking, referrals, recruiter paid-feature actions, AI edge functions) **cannot be graded** until a second read-only audit turn (D2) confirms whether server-side enforcement exists.
- One inconsistency risk (Fleet feature bullets vs. `coming-soon` booleans) must be diffed against the un-read section of `Pricing.tsx`.

The correct next step is **Phase 1J-D2 — deeper server-side trace**, still read-only, before any code changes are authorized.

_No file, database, billing, deployment, publish, or live-data change was performed in this audit turn._
