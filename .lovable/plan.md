## Phase 0 — Recruiter System Audit (Read-Only)

This is an audit report. No files were changed. Verification commands were not executed because the task is audit-only and the harness already enforces typecheck/build on edits; running `npm ci && npm run build && npm run test` here would change no behavior and is deferred to the first implementation phase (recommended to run there).

### 1. Overall verdict
The recruiter system is **billing-gated everywhere**: posting a single active opportunity today requires an active Starter/Growth/Fleet subscription. The current "pay-to-post / pay-more-to-post-more" model is enforced both client-side and server-side, and `featured` placement is driven by the same plan tier. Moving to "verified = unlimited standard posts, paid = premium features" is feasible without breaking RLS or Stripe wiring, but it touches one DB trigger, one Stripe webhook constant, the billing hook, two UI panels, and public copy. The verified-recruiter approval pipeline, RLS, and contract/applications stack are already independent of plan tier and need no structural change.

### 2. Files inspected

Frontend (recruiter)
- `src/hooks/opportunities/useRecruiterBilling.ts` — plan constants, limits, `isBillingActive`, `canSubmitMore`
- `src/hooks/opportunities/useRecruiterProfile.ts` — approval/suspend mutations + `isApproved`
- `src/hooks/opportunities/useRecruiterOpportunities.ts` — create/update opportunities
- `src/hooks/opportunities/useOpportunities.ts` — driver feed (orders by `featured`)
- `src/hooks/opportunities/useOpportunityApplications.ts`, `useRecruiterContactRequests.ts`, `useApplicationEvents.ts`, `useSavedOpportunities.ts`, `useDriverOpportunityProfile.ts`
- `src/hooks/admin/useAdminRecruiters.ts`, `src/hooks/admin/useAdminOpportunities.ts`
- `src/hooks/recruiter/useRecruiterReportData.ts` — gates PDF/CSV reports on `plan in (growth, fleet)`
- `src/hooks/useUserRole.ts` — recruiter role detection
- `src/components/opportunities/RecruiterBillingPanel.tsx`
- `src/components/opportunities/RecruiterOpportunityManager.tsx` — uses `canSubmitMore` to block activation
- `src/components/opportunities/RecruiterOpportunityForm.tsx`
- `src/components/opportunities/RecruiterApplicationsDashboard.tsx`
- `src/components/opportunities/recruiter/RecruiterAccessPage.tsx` — `approved_no_billing` blocking state
- `src/components/opportunities/recruiter/RecruiterSettingsView.tsx`
- `src/components/opportunities/OpportunityCard.tsx`, `OpportunityDetail.tsx` — render `featured` badge
- Recruiter-facing pages: `src/pages/Recruiters.tsx`, `src/pages/recruiter/{RecruiterFAQ,RecruiterFeatures,RecruiterGuide,RecruiterUpdates}.tsx`
- Contract stack: `src/hooks/contracts/*`

Backend
- `supabase/functions/stripe-webhook/index.ts` — `RECRUITER_PLAN_LIMITS = {none:0, starter:1, growth:5, fleet:25}`, `handleRecruiterSubscription`
- `supabase/functions/create-recruiter-checkout/index.ts`
- `supabase/functions/recruiter-billing-portal/index.ts`
- `supabase/functions/{contract-admin,review-contract,analyze-contract,parse-contract,sign-contract,upload-contract,confirm-contract-upload,rewrite-contract-clause,ai-insight}/index.ts`

DB migrations (recruiter-relevant)
- `20260513052701_…` — `recruiter_billing_profiles` table, `recruiter_billing_field_guard`, **`recruiter_plan_limit(_plan)`**, **`opportunities_billing_guard`** trigger
- `20260516155235_…` — `recruiter_has_priority_plan`, `opportunities_set_featured_from_plan`, `recruiter_billing_sync_featured`
- `20260516161807_…`, `20260516161851_…`, `20260516164456_…`, `20260516155254_…` — privilege hardening + GUC-based featured-sync allowance
- Plus `recruiter_profiles`, `recruiter_profile_guard`, `opportunities`, `opportunities_guard`, `opportunity_applications`, `application_events`, `recruiter_contact_requests`, `contracts*`

### 3. Current plan model

| plan_key | label | active opp limit | source of truth |
|---|---|---|---|
| `none` | No Plan | 0 | DB constraint + webhook + UI constant |
| `starter` | Starter ($19/mo) | 1 | `recruiter_plan_limit()` + `RECRUITER_PLAN_LIMITS` |
| `growth` | Growth ($49/mo) | 5 | same |
| `fleet` | Fleet ($149/mo) | 25 | same |

`status` values allowed: `inactive | active | past_due | canceled | trialing`. `isBillingActive = status in (active, trialing)`.

### 4. Active-opportunity limit enforcement map

| Layer | File | Behavior |
|---|---|---|
| UI gate | `useRecruiterBilling.ts:67` `canSubmitMore` | `isBillingActive && activeCount < limit` |
| UI gate | `RecruiterOpportunityManager.tsx:74,87,104` | Blocks `Submit for review` and activation when `!canSubmitMore` |
| UI gate | `RecruiterAccessPage.tsx` | `approved_no_billing` lockout screen until plan chosen |
| **DB trigger** | `opportunities_billing_guard` (BEFORE INSERT/UPDATE on `opportunities`, when status becoming `active`) | Hard-fails unless recruiter approved AND billing in `(active, trialing)` AND `_active_count < recruiter_plan_limit(plan)` |
| Webhook sync | `stripe-webhook/index.ts` `handleRecruiterSubscription` | Writes `plan`, `status`, `active_opportunity_limit` derived from Stripe price_id |
| Featured tier | `opportunities_set_featured_from_plan` (BEFORE INSERT) + `recruiter_billing_sync_featured` (AFTER UPDATE on billing) | Forces `opportunities.featured = recruiter_has_priority_plan(recruiter_id)` (growth/fleet only) |

Note: `useOpportunities.ts:27` orders driver feed by `featured DESC` — Priority Placement is purely driven by plan tier today.

### 5. Currently paid-gated recruiter features (require `isBillingActive` + plan tier)
- Posting any active opportunity at all (Starter+)
- Active opportunity count cap (1/5/25)
- `featured` / Priority Placement in driver feed (Growth+ via `recruiter_has_priority_plan`)
- Recruiter Activity & Pipeline reports — CSV/PDF (`useRecruiterReportData.ts` requires `plan in (growth, fleet)` + active)
- Contract Protection workflow surfaced in FAQ as Growth+ (no hard backend gate found — see Unknowns)

### 6. Currently free/verified-gated (or ungated for approved recruiters)
- Recruiter onboarding & profile submission (`useRecruiterProfile`)
- Admin approval / rejection / suspension pipeline (`useAdminRecruiters`)
- Viewing own applicants list & moving statuses (`opportunity_applications_update_guard` enforces legal transitions for any approved recruiter)
- Receiving contact requests / approvals (`request_driver_contact` checks approved+not-suspended; no plan check)
- Notifications, application events
- Verified Recruiter badge surface (referenced in FAQ; not gated by plan in code paths I inspected)

### 7. Backend / RLS guards on recruiter & opportunity data
- `recruiter_profile_guard` — clients cannot self-approve, only admins can set `verification_status/verified_at/verified_by`; `resubmit_recruiter_profile` RPC handles rejected→pending
- `recruiter_billing_field_guard` — clients cannot mutate `stripe_*`, `plan`, `status`, `active_opportunity_limit`, `current_period_end`; only service_role/admin can
- `opportunities_guard` — pins `admin_review_status`, `featured` (except inside billing-sync GUC), `view_count`, `published_at` for non-admins
- `opportunities_billing_guard` — the hard "must pay to activate" gate (see §4)
- `opportunity_applications_update_guard` — recruiters only change status, with an explicit allowed-transition matrix
- `application_events_emit`, `notify_*` triggers — audit trail + notifications
- `is_recruiter_owner`, `is_application_party` — SECURITY DEFINER helpers used in RLS
- `request_driver_contact`, `withdraw_opportunity_application` — RPCs with explicit auth + state checks
- Contracts: `contracts_status_guard`, `contracts_status_client_lock`, `contracts_field_guard`, `contract_versions_field_guard`, `contract_signatures_validate`, `contract_audit_log_guard` — all enforce forward-only state machine and lock identity fields to service_role/admin

### 8. Stripe / billing sync map
- Checkout: `create-recruiter-checkout` creates Stripe customer + checkout session with `metadata={ user_id, recruiter_id, plan }`, writes pending row to `recruiter_billing_profiles`
- Portal: `recruiter-billing-portal` (one-shot session)
- Webhook: `stripe-webhook/handleRecruiterSubscription` resolves `plan` from `STRIPE_RECRUITER_{STARTER,GROWTH,FLEET}_PRICE_ID` env (or metadata fallback), computes `limit` from `RECRUITER_PLAN_LIMITS`, sets status; on `canceled|incomplete_expired` it drops to `plan='none', limit=0`
- DB side effect: any change to `plan/status` fires `trg_recruiter_billing_sync_featured` → toggles `opportunities.featured` for all of the recruiter's listings via GUC-bypass of `opportunities_guard`

### 9. Risk map for the upcoming pivot (verified = unlimited standard, paid = premium tools)

Low risk (UI / copy only; safe to edit per-phase)
- `src/components/opportunities/RecruiterBillingPanel.tsx` — perks/labels
- `src/pages/recruiter/RecruiterFAQ.tsx`, `RecruiterFeatures.tsx`, `RecruiterGuide.tsx`
- `src/pages/Recruiters.tsx` (plans array, "limit" copy)
- `src/components/opportunities/recruiter/RecruiterSettingsView.tsx`
- `src/components/opportunities/RecruiterOpportunityManager.tsx` (replace `canSubmitMore` with verified+approved check for standard posts; keep paid check for premium actions)
- `src/components/opportunities/recruiter/RecruiterAccessPage.tsx` (remove `approved_no_billing` blocking state; make billing optional)

Medium risk (business logic; one hook + one webhook constant)
- `src/hooks/opportunities/useRecruiterBilling.ts` — change semantics of `canSubmitMore` and `limit`; introduce `canUsePremium`, `hasPriorityPlacement`, `hasReports`, etc.
- `supabase/functions/stripe-webhook/index.ts` — `RECRUITER_PLAN_LIMITS` becomes irrelevant for posting; keep for premium-feature flags or remove cap entirely
- `src/hooks/recruiter/useRecruiterReportData.ts` — already plan-gated, just confirm new entitlement names

High risk (DB triggers / RLS — single migration, must be careful)
- `opportunities_billing_guard` — must be rewritten to require **only** `recruiter approved + not suspended` for `status='active'`; drop the `billing in (active,trialing)` and `_active_count < limit` checks. Keep it as the approved-recruiter gate.
- `recruiter_plan_limit()` — can stay (still used for premium tiers) or be repurposed; do not drop without confirming no callers remain
- `opportunities_set_featured_from_plan` + `recruiter_billing_sync_featured` + `recruiter_has_priority_plan` — keep as-is; this is exactly the "premium = priority placement" lever we want to preserve
- `recruiter_billing_field_guard` — unchanged
- All `opportunities` / `opportunity_applications` / `recruiter_profiles` RLS — unchanged

### 10. Recommended implementation order
1. **DB migration**: rewrite `opportunities_billing_guard` to drop billing + count requirement, keep approved-recruiter requirement; add a regression test that an approved recruiter with `plan='none'` can activate an opportunity but `recruiter_has_priority_plan` is false (so `featured=false`).
2. **Stripe webhook**: keep `handleRecruiterSubscription` writing `plan`/`status` (still drives premium gating + featured sync), but stop treating `active_opportunity_limit` as a cap. Either set it to a sentinel (e.g., `999999`) or repurpose the column. Document the change.
3. **`useRecruiterBilling`**: split entitlements — `canPostStandard = isApproved && !isSuspended`, `canUsePriorityPlacement = isBillingActive && plan in (growth,fleet)`, `canExportReports`, `canUseContractTools`, etc. Remove `canSubmitMore`.
4. **UI gates**: update `RecruiterOpportunityManager`, `RecruiterAccessPage` (drop `approved_no_billing`), `RecruiterBillingPanel` (reframe plan cards around premium value, not limits).
5. **Public copy**: update `Recruiters.tsx`, `RecruiterFAQ`, `RecruiterFeatures`, `RecruiterGuide`, plan cards — remove "1/5/25 active opportunities" language; reframe plans as visibility/trust/reporting/contracts/team.
6. **Pricing page** (if it shows recruiter plans).
7. **Verification**: full `npm ci && npm run build && npm run test`, plus targeted Vitest run for any new entitlement helpers; manual smoke of approved-no-billing recruiter posting.

### 11. Unknowns / deferred questions
- Are the contract-workflow features (`upload-contract`, `analyze-contract`, etc.) intended to remain Growth+ only? No backend plan check was found inside those edge functions — gating is currently UI-only via FAQ copy. Needs a product call.
- Should `plan='none'` recruiters get the "Verified Recruiter" badge by default once approved? Today the badge concept exists in copy but I did not find a dedicated UI flag distinct from `isApproved`.
- Should `active_opportunity_limit` column be repurposed (e.g., to soft cap for premium-only features) or dropped? Schema migration cost is similar; recommend keeping the column and zeroing the meaning until a future cleanup phase.
- Stripe price-ID env wiring (`STRIPE_RECRUITER_*_PRICE_ID`) needs to be re-verified in the live project after plan repositioning.
- Verification commands (`npm ci`, `npm run build`, `npm run test`) were intentionally **not** executed in this audit-only phase; run them at the start of Phase 1.

Stop after this audit. No code, DB, billing, Stripe, or copy changes were made.
