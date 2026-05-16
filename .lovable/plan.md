This plan is approved, but apply these safeguards before deployment.

1. Verify real recruiter_billing_profiles values before writing the priority migration.

Confirm the actual plan values and status values used in production.

The helper function should only use values that really exist in the database.

Expected logic:

- Growth and Fleet plans get priority

- Starter does not

- Active or trialing gets priority

- canceled, past_due, inactive, or unpaid should not

2. Confirm the Supabase relationship join works.

The useOpportunities query:

recruiter:recruiter_profiles!inner(verification_status, status)

must be tested against the real schema.

If the relationship alias or FK name is different, fix the select before shipping.

3. Confirm the business rule for featured.

This plan makes featured fully plan-derived.

That means admin manual featured toggles will be overwritten.

That is acceptable only if we want Priority Placement to be strictly tied to Growth/Fleet.

If we need admin promotional overrides later, add a separate admin_featured_override field in a future phase. Do not add it in this phase unless required.

4. Keep the Starter copy truthful.

Replace "In-app messaging" with "Driver contact requests" everywhere recruiter pricing appears.

5. Keep Fleet copy truthful.

Do not claim multi-seat team access or advanced analytics dashboard until those features are truly built.

Use:

- 25 active opportunities

- Priority placement

- Recruiting snapshot dashboard

- Priority support

6. QA must verify:

- Starter opportunity = featured false

- Growth opportunity = featured true

- Fleet opportunity = featured true

- Downgrading Growth to Starter flips featured back to false

- Canceling or inactive billing removes priority

- Driver listings show Growth/Fleet above Starter

- Verified Recruiter badge only appears for approved and non-suspended recruiters

- Pricing and recruiter landing copy match

- Build passes with no TypeScript errors

# Recruiter Pricing Truth Audit & Feature Hardening

Make every recruiter marketing claim match real platform behavior, and turn Priority Placement into a deterministic plan-driven feature.

## A. Driver-facing badge: "Approved" → "Verified Recruiter"

**File:** `src/components/opportunities/OpportunityCard.tsx`

- Change badge text from `Approved` to `Verified Recruiter`.
- Today the listing already filters opportunities to `status='active' AND admin_review_status='approved'`, but recruiter verification is a separate field. Extend `useOpportunities` to also join recruiter verification so we only render the badge when the recruiter profile itself is approved/active (not pending/rejected/suspended).
- If join shows the recruiter is not verified, hide the badge entirely (the opportunity already shouldn't be live, but this is a defensive UI guard).

**File:** `src/hooks/opportunities/useOpportunities.ts`

- Change `.select('*')` to `.select('*, recruiter:recruiter_profiles!inner(verification_status, status)')` and filter `verification_status='approved'` and `status<>'suspended'`. Pass `recruiter` down to the card so it can decide whether to render the verified badge.

## B. Starter copy truth fix

**File:** `src/components/landing/RecruiterLanding.tsx` (line 48)

- Replace `'In-app messaging'` with `'Driver contact requests'`.
- Keep `'Applicant pipeline'` and `'Verified badge'`.

**File:** `src/pages/recruiter/RecruiterFAQ.tsx` — keep the existing honest note ("In-app messaging is on the roadmap"); no change required.

## C. Priority Placement — make it real and deterministic

**Approach:** server-side sync (option 2 from the audit). Keep `opportunities.featured` as the single sort key the listing already uses, but stop relying on manual toggling. A DB trigger and a billing-change trigger will set it automatically from the recruiter's active plan.

**Migration:**

1. Add helper SQL function `recruiter_has_priority_plan(recruiter_id uuid) returns boolean` — true if the recruiter's `recruiter_billing_profiles.plan IN ('growth','fleet')` AND `status IN ('active','trialing')`.
2. Add trigger on `opportunities` (BEFORE INSERT OR UPDATE): set `NEW.featured = recruiter_has_priority_plan(NEW.recruiter_id)`. This locks `featured` to the plan — recruiters can't manually mark themselves featured.
3. Add trigger on `recruiter_billing_profiles` (AFTER INSERT OR UPDATE OF plan, status): UPDATE all `opportunities` for that recruiter to recompute `featured` from `recruiter_has_priority_plan`.
4. One-time backfill: `UPDATE opportunities SET featured = recruiter_has_priority_plan(recruiter_id)`.

**Sort rule** (already in `useOpportunities`): `featured DESC, published_at DESC NULLS LAST`. Match-score is computed client-side per card and does **not** reorder the list, so paid priority is never buried. Keep it that way (no change).

## D. Featured/Priority badge

**File:** `src/components/opportunities/OpportunityCard.tsx`

- Existing "Featured" badge stays, gated on `o.featured === true` (which is now always plan-driven). Rename label from `Featured` to `Priority` for clarity. Already hidden when `featured=false`.

## E. Fleet claims cleanup

**File:** `src/components/landing/RecruiterLanding.tsx` (line 50)

- Replace `['Everything in Growth', 'Multi-seat team access', 'Analytics dashboard']` with `['Everything in Growth', '25 active opportunities', 'Recruiting snapshot dashboard', 'Priority support']`.

**File:** `src/pages/Pricing.tsx` — current Fleet bullets are already vague ("High-volume recruiting capacity", "Priority ecosystem access"). Tighten to: `'25 active opportunities'`, `'Priority placement'`, `'Recruiting snapshot dashboard'`, `'Priority support'`. Also update Growth bullets to explicitly include `'Priority placement'`.

**File:** `src/lib/recruiterFeatureList.ts` — audit for "multi-seat", "team", "analytics dashboard". Current file has none (verified by search). No change required.

**Files:** `src/pages/recruiter/RecruiterFAQ.tsx`, `src/pages/recruiter/RecruiterGuide.tsx` — no offending claims found; no change.

## F. Out of scope

- No new chat/messaging system.
- No multi-seat / team management implementation.
- No new analytics page.
- No changes to RLS, auth, contracts workflow, or billing edge functions.

## Technical notes

- Migration is the only DB change. `featured` becomes derived; existing admin tooling that flips `featured` manually will be overridden by the trigger — this is intentional (deterministic + auditable).
- `useOpportunities` query key stays the same; the embedded recruiter join is filtered with `!inner` so unverified recruiters' rows drop out as a second safety net.
- `OpportunityCard` props extend with optional `verifiedRecruiter: boolean` (default false) so the badge is opt-in and won't appear on stale/cached data.

## QA checklist

1. Seed a Starter recruiter → opportunity row has `featured=false` after insert.
2. Upgrade same recruiter to Growth → all their opportunities flip to `featured=true` via billing trigger.
3. Driver listing shows Growth/Fleet opportunities above Starter; refresh preserves order.
4. Verified Recruiter badge renders only for approved + non-suspended recruiters.
5. Pricing page Starter shows "Driver contact requests" (no "In-app messaging").
6. Pricing page Fleet shows no "Multi-seat" or "Analytics dashboard" claims.
7. RecruiterLanding tier table matches Pricing page.
8. Build passes with no TS errors.