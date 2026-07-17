## Phase 1F-A.1 — Recruiter Posting Authorization and Driver Visibility Correction

### Difficulty / Risk
**High complexity, high importance.** Touches: RLS on `opportunities`, three trigger functions, four SECURITY DEFINER driver/recruiter RPCs, one narrow schema change on `recruiter_profiles`, onboarding form, eligibility helper, and a real-RLS PGlite runtime harness. Live data risk: **low** (1 recruiter profile, already approved; 0 active opps under unverified recruiters). Blast radius contained if migration is scoped strictly.

### Pre-Edit Live Map (recorded)
- HEAD: `0bc7d51...` (baseline).
- `recruiter_profiles`: 1 row (verification=approved, status=active). Complete under new rule: 1.
- `opportunities`: 4 total (1 active/approved, 3 closed/pending). 0 active opps owned by unverified recruiters. 0 orphaned.
- **Defects confirmed:**
  1. `list_driver_visible_opportunities` still filters `rp.verification_status='approved'`.
  2. `create_driver_referral_safe` still filters `rp.verification_status='approved'`.
  3. `request_driver_contact` still requires `rp.verification_status='approved'`.
  4. `recruiter_can_post(uuid)` has `EXECUTE` for `anon` — anonymous eligibility enumeration.
  5. Opportunity INSERT/UPDATE policies use `is_recruiter_owner` (owner + not-suspended only) — no completeness check, no verification-suspended check.
  6. `opportunities_billing_guard` only fires on transition to active; incomplete recruiter can still insert drafts.
  7. Completeness rule missing DOT/MC and agreement persistence.
  8. `list_recruiter_applications_safe` already permits unverified (checks only both-suspension) — OK.

### Canonical Server Eligibility Rule
A recruiter profile is eligible to manage standard opportunities iff:
- `recruiter_name`, `company_name`, `recruiter_email` all non-empty trimmed
- `recruiter_email` matches a stable server-side pattern (`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
- at least one of `dot_number` / `mc_number` non-empty
- `posting_terms_accepted_at IS NOT NULL` (or grandfathered via `legacy_terms_grandfathered_at`)
- `status <> 'suspended'` AND `verification_status <> 'suspended'`

### Consent Persistence Design
Add two narrow columns on `recruiter_profiles`:
- `posting_terms_accepted_at timestamptz NULL`
- `posting_terms_version text NULL` (client stamps `'2026-07-17.v1'`)

`recruiter_profile_guard` extended so:
- Non-admin **INSERT**: if `posting_terms_accepted_at` provided, it stays (server trusts the client's stamp because the row is theirs and the checkbox gate is enforced client-side + eligibility gate enforced server-side). Otherwise NULL.
- Non-admin **UPDATE**: only monotonic — cannot clear once set; version updates allowed.

### Legacy Grandfathering
Add `legacy_terms_grandfathered_at timestamptz NULL`. In the migration, backfill `legacy_terms_grandfathered_at = now()` **only** for rows created before the migration timestamp (`WHERE created_at < now()`). Live count affected: **1 row**. Future direct inserts get neither timestamp unless the client sets `posting_terms_accepted_at`, so no auto-consent leak.

### Eligibility Helpers
Add:
- `public.recruiter_profile_can_manage_opportunities(_recruiter_id uuid) → boolean` — SECURITY DEFINER, pinned search_path, checks the full canonical rule + accepted-or-grandfathered consent. `REVOKE ALL FROM PUBLIC`; `GRANT EXECUTE TO authenticated, service_role` (used by RLS `WITH CHECK`).
- `public.current_user_can_manage_recruiter_opportunities(_recruiter_id uuid) → boolean` — SECURITY DEFINER, uses `auth.uid()`, verifies profile ownership + eligibility. `GRANT EXECUTE TO authenticated, service_role`.
- Keep `is_recruiter_owner` (still used elsewhere) but stop relying on it for opportunity writes.
- **Lock down** `recruiter_can_post(uuid)`: `REVOKE ALL FROM PUBLIC, anon, authenticated`; keep for `service_role` only. All internal callers routed through the two new helpers.

### RLS Policy Changes on `public.opportunities`
Drop and recreate:
- `Recruiter inserts own opportunities` — `WITH CHECK current_user_can_manage_recruiter_opportunities(recruiter_id)`
- `Recruiter updates own opportunities` — `USING` and `WITH CHECK` both use `current_user_can_manage_recruiter_opportunities(recruiter_id)`
- `Recruiter views own opportunities` — unchanged (view is allowed for owned rows regardless of eligibility so recruiters see their own drafts even if consent lapses).

### Trigger Changes
- `opportunities_billing_guard`: now also blocks INSERT of a draft when caller is non-admin and not eligible (defense in depth alongside RLS). Message unchanged.
- `opportunities_guard`: retain moderation-field control. Continue to set `admin_review_status='approved'` for eligible non-admin INSERTs (marketplace visibility), `pending` otherwise. `featured` and `view_count` remain server-controlled. Rejected→edit → `pending` retained.
- `recruiter_profile_guard`: extended to allow non-admin to set/preserve `posting_terms_accepted_at`/`_version` monotonically; block clearing/backdating; admin unrestricted.

### Driver Visibility & Pipeline RPC Changes
- `list_driver_visible_opportunities`: drop `rp.verification_status='approved'`; replace with `public.recruiter_profile_can_manage_opportunities(rp.id)`. Keep `o.status='active' AND o.admin_review_status='approved'`. Filters/ordering unchanged.
- `create_driver_referral_safe`: replace `rp.verification_status='approved'` with the profile eligibility helper.
- `request_driver_contact`: replace `_rp.verification_status='approved'` with eligibility helper (still checks both-suspension). Contact-request consent flow (driver approves) unchanged.
- `list_recruiter_applications_safe`: unchanged (already permits unverified).
- `opportunity_applications` "Driver inserts own application" policy: unchanged (already checks only `o.status='active' AND o.admin_review_status='approved'`, which is now correctly gated by the trigger for eligible recruiters).

### Verified Badge
Untouched. `OpportunityCard`, `RecruiterAccessPage`, admin panels continue to key exclusively off `verification_status='approved'`. New `isVerified` in `useRecruiterProfile` unchanged.

### Client Changes
- **`RecruiterOnboarding.tsx`**: stamp `posting_terms_accepted_at=now().toISOString()` and `posting_terms_version='2026-07-17.v1'` in the upsert payload; do **not** auto-check agreements on load for legacy rows without consent (check only if `posting_terms_accepted_at` or `legacy_terms_grandfathered_at` is set); status copy: approved no longer says "will soon be able to create" — say "Verified Recruiter badge added. Standard posting is enabled." Pending: "Standard posting is enabled. A Verified Recruiter badge is added after admin review." Rejected: "Verification was not approved. Standard posting remains enabled unless suspended; update your info and resubmit for the badge."
- **`recruiterEligibility.ts`**: extend `isProfileComplete` to include DOT-or-MC + valid email + accepted-or-grandfathered consent. Single source of truth reused by `useRecruiterProfile.canPost`.
- **`useRecruiterProfile.ts`**: derive `canPost` via `describeRecruiterEligibility` to remove duplicated logic.
- **Types**: regenerated after migration.

### Files touched (diff control)
- **new migration**: `supabase/migrations/<ts>_phase1f_a1_recruiter_authorization.sql`
- `src/components/opportunities/RecruiterOnboarding.tsx`
- `src/lib/opportunities/recruiterEligibility.ts`
- `src/hooks/opportunities/useRecruiterProfile.ts`
- `src/integrations/supabase/types.ts` (auto-regenerated)
- `src/test/phase1fRecruiterEligibility.test.ts` (extend)
- `src/test/phase1fRecruiterPostingRuntime.test.ts` (rewrite to real RLS roles + real RPC)
- `src/test/phase1eRecruiterOnboardingContinuity.test.ts` (adjust copy assertions if any regress)
- `.lovable/plan.md`

### Runtime Test Harness (PGlite)
Applies the actual migration SQL after seeding a schema-faithful baseline: `anon`, `authenticated`, `service_role`, per-user JWT claims via `request.jwt.claims`, real `auth.uid()` from JWT, real `RLS`. Tests run under `SET LOCAL ROLE authenticated` with `SET LOCAL request.jwt.claims`. Cases 1–40 exactly as spec'd. Includes DEF-04 & DEF-23 regression files run untouched.

### Verification Commands (all mandatory)
`bun install --frozen-lockfile`, both `bunx tsc -p tsconfig.{app,node}.json --noEmit`, `bunx vitest run` (targeted then full), `bun run build`, DEF-04/DEF-23 test files.

### STOP Conditions Honored
Only these public functions change: `recruiter_can_post`, `opportunities_guard`, `opportunities_billing_guard`, `list_driver_visible_opportunities`, `create_driver_referral_safe`, `request_driver_contact`, `recruiter_profile_guard` (extension), plus the two new helpers. No Stripe, billing, checkout, webhook, email, account-deletion, dispatcher, agency, or assistant code touched. No package.json / lockfile change (PGlite already present from Phase 1C-3).

### Acceptance Path
All 40 runtime cases + client tests must pass; `verification_status` counts unchanged; opportunity counts unchanged; anon has no eligibility RPC; both tsc pass; full vitest green (expected 904 + new cases); build green.

Proceeding to implementation on approval.
