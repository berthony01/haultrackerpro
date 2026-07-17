## Phase 1F-A — Recruiter Immediate Standard Posting Authorization

### Difficulty & risk
Medium-high. Server-authoritative permission change touching triggers + RLS-adjacent guards. Narrow scope: one migration, four client files, tests. No billing, no schema redesign, no data rewrite.

### Starting state (verified)
- HEAD: `c2bc1fb2` (Phase 1E), clean tree.
- Baseline: 872/872 passing (per prior turn).
- `recruiter_profiles.verification_status` domain: `pending|approved|rejected|suspended` (default `pending`).
- Onboarding form (`RecruiterOnboarding.tsx`) required fields: `recruiter_name`, `company_name`, `recruiter_email`. All others optional.
- Server gates found requiring `verification_status='approved'`:
  1. `public.opportunities_guard()` — sets `admin_review_status='pending'` unless approved, blocking public visibility.
  2. `public.opportunities_billing_guard()` — raises `42501` on active insert/update unless approved.
- Client gates: `useRecruiterOpportunities.requireApproved`, `describeRecruiterBlock` (pending/rejected → block), `RecruiterAccessPage` state machine (`pending`/`rejected` treated as pre-post gates).
- Live data: 1 recruiter (already approved/active), 1 active/approved opportunity, 3 closed/pending. No incomplete or suspended rows — safe.

### Canonical rule (server + client)
A recruiter may create/edit/publish/pause/reactivate/close standard opportunities when:
- `recruiter_profiles` row exists for `auth.uid()`
- `recruiter_name`, `company_name`, `recruiter_email` are non-empty (matches onboarding required fields)
- `status <> 'suspended'` AND `verification_status <> 'suspended'`

Verification `approved` no longer gates posting — it only awards the Verified badge.

### Changes

**1. Migration** (one, narrow)
- Add SECURITY DEFINER helper `public.recruiter_can_post(_user_id uuid) returns boolean` with pinned `search_path=public`. Encodes the rule above.
- `CREATE OR REPLACE` `public.opportunities_guard()`:
  - Eligibility becomes `recruiter_can_post(auth.uid())` on the row's owner.
  - INSERT: `admin_review_status := 'approved'` when eligible + owner match; `published_at := now()` when active + eligible. Ineligible insert falls through with `pending` (billing_guard will still reject active).
  - UPDATE: unchanged rejection→pending re-review path.
- `CREATE OR REPLACE` `public.opportunities_billing_guard()`:
  - Replace the approved-verification requirement with `recruiter_can_post(auth.uid())` scoped to owner.
  - Error message updated: "Complete your recruiter profile to publish opportunities." (removed "verified").
- No RLS policy edits needed (ownership + suspension already covered via existing `is_recruiter_owner` + `recruiter_profile_guard`).
- No data rewrite. No column changes.

**2. Client**
- `src/lib/opportunities/recruiterEligibility.ts` (NEW): pure helper `describeRecruiterEligibility(profile, {intentRecruiter})` returning `{ state: 'missing_profile'|'incomplete_profile'|'suspended'|'active_unverified'|'verified', canPost, isVerified, title, body, cta? }`.
- `src/lib/opportunities/describeRecruiterBlock.ts`: reuse the new helper; drop "approved unlocks posting" / "one business day" copy; pending & rejected now return `reason: 'ok'` (non-blocking) with badge omitted.
- `src/hooks/opportunities/useRecruiterProfile.ts`: expose `canPost` and `isVerified` in addition to `isApproved` (kept for back-compat with badge-only readers).
- `src/hooks/opportunities/useRecruiterOpportunities.ts`: `requireApproved` → `requireCanPost` using new helper; error text updated.
- `src/components/opportunities/RecruiterOpportunityManager.tsx`: uses `canPost` gate; block copy from helper.
- `src/components/opportunities/recruiter/RecruiterAccessPage.tsx`: state machine collapses `pending`/`rejected` (non-suspended, completed) into `active_unverified`. Verified badge only for `verified`. Removes "Approval is required to post" copy.

**3. Tests**
- `src/test/phase1fRecruiterEligibility.test.ts` (~15 cases): pure helper matrix (missing/incomplete/pending/rejected/approved/suspended/status-suspended/verification-suspended, badge logic, copy scanner for forbidden phrases like "approved profiles unlock posting", "must be approved", "one business day").
- `src/test/phase1fRecruiterPostingRuntime.test.ts` (PGlite, ~10 cases): boots exact migration + prior recruiter_profiles/opportunities DDL, sets `request.jwt.claim.sub`, asserts:
  - pending recruiter INSERT active → succeeds, `admin_review_status='approved'`.
  - rejected (not suspended) recruiter INSERT active → succeeds, `admin_review_status='approved'`.
  - approved recruiter → succeeds.
  - suspended (via status OR verification_status) → billing_guard raises.
  - incomplete profile (empty company_name) → billing_guard raises.
  - missing profile → RLS/ownership blocks.
  - recruiter A cannot INSERT/UPDATE recruiter B's opportunity.
  - client-set `featured=true` on INSERT is overwritten to false unless admin.
  - UPDATE by suspended recruiter → billing_guard raises on reactivation.
  - Admin update to `admin_review_status='rejected'` still works.

### Files touched (expected diff)
```
supabase/migrations/<timestamp>_phase1f_recruiter_posting.sql   (NEW)
src/lib/opportunities/recruiterEligibility.ts                    (NEW)
src/lib/opportunities/describeRecruiterBlock.ts                  (edit)
src/hooks/opportunities/useRecruiterProfile.ts                   (edit)
src/hooks/opportunities/useRecruiterOpportunities.ts             (edit)
src/components/opportunities/RecruiterOpportunityManager.tsx     (edit)
src/components/opportunities/recruiter/RecruiterAccessPage.tsx   (edit)
src/test/phase1fRecruiterEligibility.test.ts                     (NEW)
src/test/phase1fRecruiterPostingRuntime.test.ts                  (NEW)
.lovable/plan.md                                                 (edit)
```
Not touched: any Stripe/billing/webhook/checkout/email/Dispatcher/Driver/Agency/Assistant file, package.json, lockfiles, unrelated RLS.

### Verification
`bunx tsc -p tsconfig.app.json --noEmit`, `bunx tsc -p tsconfig.node.json --noEmit`, targeted vitest, full vitest, `bun run build`. DEF-04 and DEF-23 regression tests must remain green. Baseline 872 → 872 + ~25 new.

### Stop conditions honored
No schema redesign, no data rewrite, no billing changes, no form redesign, no dependency changes.
