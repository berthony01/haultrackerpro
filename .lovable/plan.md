# Unified Driver Identity + Opportunity Preferences Patch

UX/copy patch only. No DB schema, RLS, billing, Stripe, LoadForm, reports, parking, admin, or match-engine changes.

## 1. Copy rename (UI only)

Replace every driver-facing "Driver Opportunity Profile / Driver Profile / Create Profile / Set Up Profile" with **"Opportunity Preferences"** in:

- `src/components/opportunities/DriverOpportunityProfile.tsx` — header "Opportunity Preferences" + new subtitle.
- `src/components/opportunities/OpportunitiesPage.tsx` — entry card states (incomplete → "Complete Your Opportunity Preferences" + CTA "Set Preferences"; complete → "Your Opportunity Preferences Are Ready" + CTA "Edit Preferences"); error body; remove "Set Up Your Driver Opportunity Profile" / "Finish Your Driver Profile" / "Your Driver Profile Is Ready" titles.
- `src/components/opportunities/OpportunityDetail.tsx` — both "Complete your Driver Opportunity Profile" strings → "Add a few Opportunity Preferences…" copy from spec.
- `src/pages/Landing.tsx` line 831 — bullet → "Set Opportunity Preferences for accurate matches".
- `src/pages/Features.tsx` line 89 — "Opportunity Preferences for accurate matching".
- `src/pages/FAQ.tsx`, `src/pages/Pricing.tsx`, `src/pages/Terms.tsx`, `src/pages/Privacy.tsx` — replace profile wording with "Opportunity Preferences" (minimal edits on legal pages).
- Anywhere "verified recruiter" appears in driver-facing copy → "approved recruiter" (keep DB field names like `verification_status` untouched).

Database table, hook name, component file name, and TS types stay as-is.

## 2. Lazy-upsert (no auto-create on visit)

Keep current `useDriverOpportunityProfile`. No auto-INSERT on page visit (avoids unnecessary writes + RLS risk). Instead:

- Entry card never says "Create" — it says "Complete Your Opportunity Preferences" whether the row is missing or incomplete.
- On first save, existing `upsertProfile` mutation creates the row.

## 3. Prefill from account

In `DriverOpportunityProfile.tsx`, when initializing form state and `profile` is `null`:

- `email` ← `user.email`
- `full_name` ← `user.user_metadata.display_name ?? user.user_metadata.full_name ?? user.user_metadata.name`
- `phone` ← `user.user_metadata.phone` if present
- Defaults: `visibility='private'`, `contact_preference='in_app'`, `allow_verified_recruiter_contact=false`, `profile_completed=false`.

Never overwrite values already in a saved row — prefill only fills blanks.

## 4. Form structure

Reorganize `DriverOpportunityProfile.tsx` into 5 labeled sections (A–E per spec). Add small helper text under section A: "Pulled from your HaulTrackerPro account when available." Keep all existing fields and validation; only restructure + relabel.

## 5. Soften completion messaging

In the save handler / toast copy:

- Incomplete save → "Preferences saved. Add a few more details later to improve your match quality."
- Complete save → "Your Opportunity Preferences are ready."

Keep existing `profile_completed` boolean logic. Do not gate browse / Request Info / Save Opportunity (already ungated — verify in `OpportunityDetail.tsx` and `OpportunitiesPage.tsx`).

## 6. "Why preferences?" note

Small inline card on `OpportunitiesPage` (above or inside entry card): "Your main HaulTrackerPro account stays the same. These preferences only help us improve opportunity matches and show approved recruiters the information you choose to share when you request info."

## 7. Dashboard role card (`src/pages/Index.tsx` line 518)

Change static "Find Opportunities" label to dynamic:

- `hasCompletedDriverProfile === true` → label "Find Opportunities", route to list view.
- Else → label "Set Opportunity Preferences", route with `htp_opportunities_initial_view='driver-profile'` (already wired).

Keep "Recruit Drivers" untouched.

## 8. Out of scope

- DB migrations, RLS, type regen
- `driver_opportunity_profiles` table rename
- Match engine / Profit calc
- Recruiter billing, Stripe, admin moderation
- LoadForm, reports, parking
- Edge functions

## 9. Verification

- `npx tsc --noEmit` clean
- `bunx vitest run` passes
- Grep proves no remaining "Driver Opportunity Profile", "Create Driver Profile", "verified recruiter" in user-facing copy
- Manual: visit `/dashboard` → Find Opportunities card label flips based on completion; Opportunities entry card uses new copy; form prefills email/name for fresh user; save toast uses new wording; Request Info works without preferences.

## Files to edit (8)

1. `src/components/opportunities/DriverOpportunityProfile.tsx`
2. `src/components/opportunities/OpportunitiesPage.tsx`
3. `src/components/opportunities/OpportunityDetail.tsx`
4. `src/pages/Index.tsx`
5. `src/pages/Landing.tsx`
6. `src/pages/Features.tsx`
7. `src/pages/FAQ.tsx`, `src/pages/Pricing.tsx`
8. `src/pages/Terms.tsx`, `src/pages/Privacy.tsx`

Also verify that the word “profile” is still allowed only where it clearly refers to the main HaulTrackerPro account, recruiter/company profile, or internal code names. Do not remove legitimate recruiter/company profile wording.