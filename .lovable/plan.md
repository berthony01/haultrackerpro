## Goal

Run a strict end-to-end audit of the recruiter posting + driver application flow, then patch only the confirmed blockers that stopped the recruiter from posting. No redesign, no new features, no pricing/role changes beyond what's required to unblock the flow.

## Phase 1 — Audit (read-only, in build mode)

I will inspect each layer and produce a PASS/FAIL line for every scenario A–K with file references and concrete evidence (not guesses).

1. **Auth + role intent** (Scenarios A, B, C)
   - `src/pages/Auth.tsx`, `src/hooks/useAuth.tsx`, `src/hooks/useRoleIntentReconciler.ts`, `src/hooks/useUserRole.ts`, `src/pages/Index.tsx`, `src/App.tsx`.
   - Confirm: email signup writes `intended_role=recruiter`; Google signup triggers `apply_recruiter_intent` RPC and survives reload; no driver-dashboard flash; recruiter lands in `RecruiterAccessRoute`.
   - Check the `apply_recruiter_intent` eligibility gate against a recruiter who immediately signs in on a second device (created_at > 30 min). If that's a real blocker for the user who complained, flag it.

2. **Recruiter posting path** (Scenarios D, E, F, G)
   - `src/components/opportunities/RecruiterAccessRoute.tsx`, `RecruiterOpportunityManager.tsx`, `RecruiterOpportunityForm.tsx`, `RecruiterQuickPostForm.tsx`, `PasteOpportunityDialog.tsx`, `RecruiterOnboarding.tsx`.
   - `src/hooks/opportunities/useRecruiterOpportunities.ts` (insert payload, required cols, cache invalidation).
   - DB: `opportunities` columns vs form payload, `opportunities_guard` + `opportunities_billing_guard` triggers (verification gate), `admin_review_status` default, `status` default, RLS insert/select policies, `recruiter_profiles.verification_status='approved'` requirement.
   - Edge functions used by paste/PDF/image (if any). Verify deployed name + AI gateway secret.

3. **Feed visibility** (Scenario H)
   - `src/components/opportunities/OpportunitiesPage.tsx`, `useOpportunities.ts`, RLS SELECT policy on `opportunities`.
   - Confirm what driver feed filters by (`status='active'`, `admin_review_status='approved'`, recruiter not suspended). If brand-new posts sit at `pending` review forever with no admin in the loop, the recruiter sees "posted but invisible" — flag as a real blocker and propose either auto-approve for verified recruiters or a clear "pending review" status surface.

4. **Driver application** (Scenarios I, J)
   - `OpportunityDetail.tsx`, `useOpportunityApplications.ts`, `application_events_emit` trigger, RLS on `opportunity_applications`, contact-snapshot guard.
   - Storage buckets for application uploads (resume/CDL): exists? policies?

5. **Error handling + mobile** (Scenarios K + failure-type sweep)
   - Toast messages, swallowed catches, disabled submits, sticky-FAB blocking submit on mobile, file-type mismatch (frontend vs storage).

6. **Supabase audit**
   - `supabase--read_query` on `pg_policies` for `opportunities`, `opportunity_applications`, `recruiter_profiles`, `profiles`; storage buckets + their policies; recent failed inserts via logs.
   - `supabase--edge_function_logs` on any AI/parse function used by paste/PDF/image.

Output of Phase 1 = the strict report in the requested 10-section format.

## Phase 2 — Minimal patches (only confirmed blockers)

Patches will be scoped to whichever of these the audit actually proves are broken. Likely candidates based on prior context, but I will not patch any item that audit shows as already working:

- **Verification gate UX**: if a fresh recruiter signs up and immediately tries to post, `opportunities_billing_guard` throws because `verification_status<>'approved'`. If the form surfaces this as a generic toast or silent failure, replace with a clear blocking banner + "Apply for verification" CTA inside `RecruiterOpportunityManager`/`RecruiterAccessRoute`. No policy loosening.
- **Admin review invisibility**: if posts land at `admin_review_status='pending'` and never show in the driver feed with no recruiter-side surface, add a "Pending admin review" badge on the recruiter's posted-opportunities list (UI only, no policy change) so the recruiter understands "submitted ≠ live".
- **Cache invalidation gap**: if `createOpportunity` mutation doesn't invalidate recruiter-list + driver-feed query keys, add the invalidations.
- **Payload defaults**: ensure insert payload provides every NOT NULL column the trigger doesn't backfill (`recruiter_id`, `status`, etc.) and that enum values match DB constraints.
- **Paste / PDF / image extractors**: for each, verify wired end-to-end. If not wired or crashing, either fix the obvious bug (try/catch + toast + safe fallback to manual entry) or hide the entry-point button behind a feature flag with a "Manual entry only" note. No half-working buttons.
- **Driver application submit**: if RLS/insert payload/contact-snapshot guard rejects, fix the payload — do not weaken RLS.
- **Storage buckets**: if a referenced bucket is missing, create it with least-privilege policies in a single migration.
- **Silent error swallowing**: replace bare `catch {}` around critical inserts with `toast.error(err.message)` so failures stop being invisible.

Every DB change goes through `supabase--migration` with the exact policy SQL spelled out.

## Phase 3 — Verification

- `tsgo` typecheck clean.
- Drive Playwright via shell against localhost:8080 for: recruiter Google-intent restore, recruiter post submit, driver feed shows the new post (or shows pending state with correct messaging), driver opens detail + submits application, recruiter sees application row. Screenshot each step.
- Re-run `security--run_security_scan` if any RLS/storage policy was touched.

## What I will not touch

Pricing, plans, landing copy, recruiter monetization, referral system, dashboard redesign, new AI assistants, unrelated tables, driver-only features, or the existing recruiter intent architecture beyond bug fixes.

## Deliverable

Single response with the 10-section strict report, list of files changed, migrations applied, scenarios re-tested with PASS/FAIL, and remaining risks.

Approve to start in build mode.