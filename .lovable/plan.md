
# Recruiter Signup → Post Opportunity: Read-Only Diagnostic Audit

## 1. Executive conclusion
**PARTIALLY WORKING.** The wiring is intact end-to-end and does succeed for an approved recruiter (1 approved recruiter, 1 active/approved opportunity + 3 closed/pending live). But live data shows **2 users with `profiles.intended_role='recruiter'` and only 1 has a matching `recruiter_profiles` row** — exactly one stuck account with signup intent that never became a recruiter profile. That user cannot see or use the posting form (UI gate + RLS insert both fail-closed). This matches the reported symptom.

No P0 code defects were confirmed. The most likely user-visible cause is an onboarding path that did not create the `recruiter_profiles` row for at least one user (OAuth reconciliation or unfinished onboarding submission). Secondary risk: even after a recruiter_profiles row exists, `verification_status` starts as `pending` and posting is blocked until an admin approves.

## 2. Baseline
- HEAD: `f50f133e7baffe498c48d44e4f264f0015edc528` ("Fixed PGlite import path"). Working tree clean.
- No changes since Phase 1C-3 / final gate review.
- Build & deployment status: last verified PASS in prior gate review; no code changed this turn.

## 3. Signup → posting flow (verified against current code + DB)

```
Email signup / OAuth
  → handle_new_user trigger (public schema) creates profiles row,
     persists auth metadata.intended_role → profiles.intended_role
  → useRoleIntentReconciler (client)  ─── if intended_role='recruiter'
     → RPC public.apply_recruiter_intent() (SECURITY DEFINER, authenticated only)
        (eligibility-gated version, migration 20260619173227) upserts
        recruiter_profiles row when eligible
  → useUserRole / useRecruiterProfile picks up new profile
  → RecruiterAccessRoute renders RecruiterAccessPage (hub)
  → RecruiterOnboarding form (recruiter_profiles upsert)  ─── RLS:
     "Recruiter inserts own profile" WITH CHECK (auth.uid()=user_id)
  → BEFORE INSERT/UPDATE trigger recruiter_profile_guard()
     locks verification_status/verified_at/verified_by/status to admins
     (non-admin edits pinned; safe self-resubmit rejected→pending only)
  → Admin review flips verification_status='approved', status='active'
  → RecruiterOpportunityManager gates UI on
     verification_status==='approved' && status==='active' (client)
  → RecruiterQuickPostForm.buildPayload() → useRecruiterOpportunities
     .createOpportunity → insert into public.opportunities
       RLS "Recruiter inserts own opportunities":
         WITH CHECK is_recruiter_owner(auth.uid(), recruiter_id)
       BEFORE INSERT trigger trg_opportunities_guard:
         forces admin_review_status = approved iff owner is approved,
         else 'pending'; view_count=0; published_at conditional
       BEFORE INSERT trigger trg_opportunities_billing_guard:
         if NEW.status='active' AND not admin,
         requires recruiter_profiles row with verification_status='approved'
         AND status<>'suspended' — else RAISE 42501
         "Recruiter must be verified and active to post opportunities."
```

## 4. Posting eligibility rules (server-authoritative)
- Row-level: `is_recruiter_owner(auth.uid(), recruiter_id)` — recruiter row must exist, belong to caller, not suspended.
- Trigger `opportunities_billing_guard`: only blocks when `NEW.status='active'`. Quick Post form sends `status:'active'`, so pending recruiters are always blocked at active-post time.
- Trigger `opportunities_guard`: overrides `admin_review_status` server-side (never trusts client); recruiters cannot self-approve.
- `opportunities` CHECK constraints: `status ∈ {draft,active,paused,closed,removed}`, `admin_review_status ∈ {pending,approved,rejected,flagged}`, `pay_model ∈ {cpm,percentage,flat_weekly,salary,mixed,other}`.
- NOT NULL: `recruiter_id`, `title`, `company_name`, `hiring_states` (default `{}`), plus `status`/`admin_review_status`/`featured`/`view_count`.
- Client-side gates in `RecruiterOpportunityManager` block the form UI unless `profile.verification_status==='approved'` and `profile.status==='active'`. Suspended/rejected/pending each render their own gate page.
- No plan/billing/trial condition affects standard posting — capability layer only gates premium tools (`useRecruiterBilling.capabilities`).

## 5. Complete blocking-condition register
| # | Condition | Layer | Symptom |
|---|-----------|-------|---------|
| B1 | No `recruiter_profiles` row for caller | UI + RLS | UI shows "Recruiter Access Required"; direct API insert fails RLS |
| B2 | `verification_status='pending'` | UI + billing_guard | UI shows "Pending Review"; if bypassed, 42501 on active insert |
| B3 | `verification_status='rejected'` | UI | "Profile Needs Attention" gate |
| B4 | `status='suspended'` or `verification_status='suspended'` | UI + billing_guard + is_recruiter_owner | "Access Suspended" gate; RLS insert denied |
| B5 | Client sends `status:'active'` while unapproved | billing_guard | 42501 raised (currently unreachable behind UI gate but is the last line of defense) |
| B6 | `user_id` mismatch between recruiter row and caller | RLS insert + owner check | Silent RLS "new row violates row-level security policy" |
| B7 | `recruiter_id` malformed / stale from React Query | RLS + FK | RLS deny or FK violation |
| B8 | `hiring_states` accidentally set to null (client currently sends `[]` or `[state]`) | NOT NULL constraint | Insert fails |
| B9 | `pay_model` value outside enum (e.g. free-text) | CHECK | 23514 |
| B10 | Attempt to change `admin_review_status`/`featured`/`view_count`/`published_at` from client | opportunities_guard | Silently overwritten (not an error, but confuses tests) |
| B11 | Attempt by recruiter to update another recruiter's opportunity | RLS UPDATE | Denied |
| B12 | Onboarding form saved but `recruiter_profile_guard` rejected forbidden field change | trigger | Trigger error surfaced as toast |
| B13 | `apply_recruiter_intent` never invoked (OAuth path where reconciler didn't run) | client | No recruiter_profiles row → B1 |
| B14 | Stale `useRecruiterProfile` cache after admin approval | React Query | UI still shows pending until refetch/refresh |
| B15 | `createOpportunity.onError` surfaces raw Supabase error string — usable, but generic `Recruiter must be approved to manage opportunities.` from hook can mask the real cause when `isApproved` is false client-side | UI copy | Users don't know what to fix |

## 6. Live read-only findings (counts only, no PII)
- `recruiter_profiles` by state: **1 row — approved/active. Zero pending, zero rejected, zero suspended.**
- Recruiter profiles missing `company_name`: **0**.
- Recruiter profiles with empty `hiring_states`: **0**.
- `profiles.intended_role='recruiter'`: **2** users.
- Users with `intended_role='recruiter'` AND a matching `recruiter_profiles` row: **1**.
- **→ Delta: 1 user signed up as a recruiter but has no recruiter_profiles row.** This is the reproducible stuck-account signature.
- Opportunities by (status, admin_review_status): **active/approved: 1, closed/pending: 3.**
- Orphaned opportunities (no matching recruiter): **0**.
- Approved recruiters missing owner (`user_id`): **0**.
- Recruiter/customer/subscription integrity checks from prior Phase 1D preflight: still 0 collisions.
- Triggers active: `trg_opportunities_guard`, `trg_opportunities_billing_guard`, `trg_opportunities_set_featured`, `trg_opportunities_updated_at`, `trg_notify_opportunity_reviewed` on opportunities; `recruiter_profile_guard`, `trg_recruiter_profiles_guard`, `trg_recruiter_profiles_updated_at`, `trg_notify_recruiter_profile_status` on recruiter_profiles. RLS enabled on both tables; policies as reported in section 4.

No live inconsistency requiring repair. No auto-rewrite performed.

## 7. Reproduction / verification results (no writes)
| Scenario | Result | Evidence |
|---|---|---|
| 1. New recruiter signup | PASS (structural) | handle_new_user + apply_recruiter_intent wired; profile creation confirmed for 1 of 2 intended recruiters |
| 2. Recruiter onboarding | PARTIAL | 1 stuck user with intent but no recruiter_profiles row (see §6) — root cause is either OAuth reconciler not firing or user never submitted onboarding form |
| 3. Approved recruiter creates standard opportunity | PASS | 1 approved recruiter has active/approved opportunity live |
| 4. Approved recruiter publishes/activates | PASS | Same row is `status=active, admin_review_status=approved` |
| 5. Pending recruiter blocked message | PASS | UI `Gate` component renders "Pending Review" (RecruiterOpportunityManager.tsx L69) |
| 6. Suspended recruiter blocked | PASS | UI gate + `is_recruiter_owner` excludes suspended + billing_guard requires non-suspended |
| 7. Edit/pause own opportunity | PASS | RLS "Recruiter updates own opportunities" using + with-check on `is_recruiter_owner` |
| 8. Cannot modify another recruiter's opportunity | PASS | Same RLS |
| 9. Standard posting available free/verified | PASS | Verified via code (`useRecruiterBilling` capability layer gates only premium tools; posting is verified-access only) |
| 10. Errors explain corrective action | PARTIAL | `billing_guard` message is clear ("Recruiter must be verified and active…"); B15 client-side generic error can mislead |

No new tests added. No production writes made.

## 8. Root cause of the reported problem (ranked)
Because the exact reporter's account/email was not supplied, ranking by likelihood given live data + code:

1. **[Highest, matches live data] The reporter has `profiles.intended_role='recruiter'` but no `recruiter_profiles` row.** Either (a) they signed up via Google/OAuth and `useRoleIntentReconciler` never called `apply_recruiter_intent` in this session, or (b) they opened the onboarding form but never submitted it. UI shows "Recruiter Access Required" and Post Opportunity is not reachable. Confirmed by count delta (2 intended, 1 profile).
2. **[High] The reporter completed onboarding but is still `verification_status='pending'`.** Admin approval hasn't happened. UI shows "Pending Review" — no post path available. Not reproduced in current live data (0 pending) but the flow requires admin review as a hard gate.
3. **[Medium] Stale client cache** after admin approval: `useRecruiterProfile` React Query key `['recruiter_profile', user?.id]` may not refetch until sign-out/sign-in; the user could be approved server-side but blocked client-side.
4. **[Low] Silent RLS denial** from a user_id/recruiter_id mismatch caused by a manual admin patch (0 mismatches live — not currently occurring but the failure mode exists).

## 9. Defect register
| ID | Sev | Location | Evidence | Recommended narrow fix |
|---|---|---|---|---|
| D-01 | **P1** | Recruiter onboarding path (`apply_recruiter_intent` + `useRoleIntentReconciler`) | Live: 2 intended, 1 profile — 1 user stuck | (a) Ensure `apply_recruiter_intent` runs on every authenticated session start for `intended_role='recruiter'`, and (b) auto-navigate stuck users into RecruiterOnboarding when profile is missing but intent is set. Also surface a diagnostic on the hub: "Finish setting up your recruiter profile to post". No schema change. |
| D-02 | **P2** | Approval visibility | Admin approves in DB → recruiter UI does not immediately reflect it | Invalidate/refetch `['recruiter_profile']` on focus + on realtime `postgres_changes` for recruiter_profiles owned by user. Client-only. |
| D-03 | **P3** | `RecruiterOpportunityManager` gate copy | "Pending Review" doesn't state ETA or contact path | Add support-contact line and expected review window. UI copy only. |
| D-04 | **P3** | `useRecruiterOpportunities.requireApproved` throws generic string (B15) | Users see "Recruiter must be approved to manage opportunities." instead of specific reason (missing row vs pending vs suspended) | Route the client through a small `describeRecruiterBlock(profile)` helper. UI-only. |
| D-05 | **P3** | Client-side `RecruiterQuickPostForm.buildPayload` sends `status:'active'` unconditionally | If gates are ever bypassed by a code path we haven't audited, billing_guard fires 42501 which is fine, but a friendlier UI would draft first | Consider `status:'draft'` unless recruiter explicitly clicks "Publish". Non-blocking. |

No P0 defects. No migration required. All fixes are code-only.

## 10. Gate impact
- **Does NOT introduce new billing regression.** Phase 1C/1C-2/1D webhook + Recruiter checkout invariants are untouched.
- **Does affect** the final Driver/Recruiter production-readiness gate because Recruiter onboarding shows a real user-visible stuck state (D-01). Recommend the gate not be re-declared PASS until D-01 is remediated.
- **Dispatcher Pro:** remains blocked (unchanged); this audit does not affect that gate independently.

## 11. Recommended next remediation phase
**Phase 1E — Recruiter Onboarding Continuity (P1, code-only, no migration).** Scope:
1. Guarantee `apply_recruiter_intent` fires whenever an authenticated recruiter-intent session lands, including OAuth callback and cold-load.
2. `RecruiterAccessPage` shows an explicit "Finish recruiter setup" CTA whenever `profiles.intended_role='recruiter'` and no `recruiter_profiles` row exists.
3. `useRecruiterProfile` refetch on window focus + realtime channel on `recruiter_profiles` for the current user (D-02).
4. Small `describeRecruiterBlock()` helper for accurate blocked-state copy (D-03/D-04).
5. Executable tests: reconciler runs on OAuth-only session; missing-profile hub path shows CTA; stale approval refetches; unauthorized insert still fails RLS.

Files expected to change (in build mode, when approved):
- `src/hooks/useRoleIntentReconciler.ts`
- `src/hooks/opportunities/useRecruiterProfile.ts`
- `src/components/opportunities/recruiter/RecruiterAccessPage.tsx`
- `src/components/opportunities/RecruiterOpportunityManager.tsx` (copy only)
- `src/lib/opportunities/describeRecruiterBlock.ts` (new)
- `src/test/phase1eRecruiterOnboardingContinuity.test.ts` (new)

Out of scope: any DB schema change, RLS/trigger change, billing change, admin-review workflow change, capability change, Dispatcher Pro.

## 12. Verification-only actions completed this run
- Git HEAD confirmed clean at `f50f133e…`.
- Read-only SQL: schema, RLS policies, triggers, constraints, function bodies (`opportunities_guard`, `opportunities_billing_guard`, `is_recruiter_owner`), and count queries on `recruiter_profiles`, `opportunities`, `profiles`.
- File reads: `RecruiterOpportunityManager.tsx`, `RecruiterQuickPostForm.tsx`, `RecruiterAccessRoute.tsx`, `useRecruiterOpportunities.ts`, `useRecruiterProfile.ts`, `useRecruiterBilling.ts`.
- **No code, DB rows, migrations, Stripe objects, or configuration were changed.**

Approve to proceed with Phase 1E (or share the reporter's account email so root cause can be pinned to exact case 1 vs case 2 before we build).
