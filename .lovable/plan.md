
# Phase 1 — Opportunities Foundation

Foundation only. No marketplace UI, no recruiter billing, no Stripe changes, no edits to loads/expenses/fuel/reports/parking/admin/landing/SEO logic.

## 1. Database Migration

Single migration creating 6 tables, all with RLS enabled and `update_updated_at_column()` triggers (reuses existing function).

**Tables (exact columns/constraints as specified in request):**
- `driver_opportunity_profiles` — unique(user_id); CHECK on `visibility` (private|apply_only|verified_recruiters), `contact_preference` (in_app|phone|email)
- `recruiter_profiles` — unique(user_id); CHECK on `verification_status` (pending|approved|rejected|suspended), `status` (active|inactive|suspended)
- `opportunities` — FK→recruiter_profiles; CHECK on `status` (draft|active|paused|closed|removed), `admin_review_status` (pending|approved|rejected|flagged), `pay_model` (cpm|percentage|flat_weekly|salary|mixed|other)
- `saved_opportunities` — unique(user_id, opportunity_id)
- `opportunity_applications` — unique(opportunity_id, driver_user_id); CHECK on `application_type` (apply|request_info|callback), `status` (new|viewed|contacted|interviewing|hired|rejected|withdrawn)
- `opportunity_reports` — CHECK on `status` (open|reviewing|resolved|dismissed)

**Helper:** Reuse existing `public.is_admin(uuid)`. Add a new SECURITY DEFINER helper `public.is_recruiter_owner(_user_id uuid, _recruiter_id uuid)` to avoid recursive RLS when checking opportunity ownership.

**Triggers:** Reuse existing `public.update_updated_at_column()` for all tables with `updated_at`.

**Featured/approval guard:** Add a `BEFORE INSERT OR UPDATE` trigger on `opportunities` that resets `featured` and `admin_review_status` to safe values when caller is not admin (prevents non-admin self-approval / self-feature).

**Recruiter suspension guard:** RLS UPDATE policies on `recruiter_profiles` and `opportunities` check that the owning recruiter row's `status <> 'suspended'` via the helper.

## 2. RLS Policies (summary)

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| driver_opportunity_profiles | own + admin | own | own | own + admin |
| recruiter_profiles | own + admin; authenticated may read approved+active rows (id, name, company, verification_status, hiring_states, equipment_types only — enforced by limiting policy to non-sensitive scenarios via separate SELECT policy on approved+active) | own | own (only if not suspended) + admin | admin only |
| opportunities | authenticated: only `status='active' AND admin_review_status='approved'`; recruiter: own; admin: all | recruiter for their own recruiter_id (trigger forces draft/pending) | recruiter own (not suspended) + admin | admin |
| saved_opportunities | own + admin | own | — | own |
| opportunity_applications | driver own; recruiter for their opportunities; admin all | driver for self | recruiter (status only, own opps); admin | — |
| opportunity_reports | own + admin | own (reporter_user_id = auth.uid()) | admin | — |

## 3. TypeScript Hooks

New folder `src/hooks/opportunities/` with:
- `useDriverOpportunityProfile.ts` — get/upsert own profile
- `useRecruiterProfile.ts` — get/upsert own recruiter; expose `isApproved` derived from `verification_status === 'approved' && status === 'active'`
- `useOpportunities.ts` — list approved+active; simple optional filters: `state`, `driver_type`, `route_type`
- `useSavedOpportunities.ts` — list/save/unsave
- `useOpportunityApplications.ts` — driver create + list own; recruiter list (filtered server-side via RLS)

Style follows existing `useLoads`/`useExpenses` (React Query, supabase client, typed via regenerated `Database` types).

## 4. Placeholder UI

`src/components/opportunities/OpportunitiesPlaceholder.tsx` — premium dark Card layout using existing tokens: headline, subheadline, 5 feature bullets (verified recruiters, gross/net, RPM, deadhead/deductions, privacy), 2 disabled CTAs ("Driver Profile Coming Soon", "Recruiter Access Coming Soon"). Uses existing `Card`, `Button`, `Badge`.

## 5. Navigation Wiring

- `src/components/premium/AppSidebar.tsx`: add `Opportunities` (icon: `BriefcaseBusiness`) between Loads and Expenses.
- `src/components/BottomNav.tsx`: replace `expenses` slot with `opportunities` (icon: `BriefcaseBusiness`). Order: Dashboard, Loads, Add (FAB), Opportunities, Settings. Center FAB layout untouched.
- `src/pages/Index.tsx`: add `case 'opportunities'` rendering `<OpportunitiesPlaceholder />` and header title "Opportunities". No new route added.

## 6. Files Changed / Created

**Created:**
- `supabase/migrations/<timestamp>_opportunities_foundation.sql`
- `src/hooks/opportunities/useDriverOpportunityProfile.ts`
- `src/hooks/opportunities/useRecruiterProfile.ts`
- `src/hooks/opportunities/useOpportunities.ts`
- `src/hooks/opportunities/useSavedOpportunities.ts`
- `src/hooks/opportunities/useOpportunityApplications.ts`
- `src/components/opportunities/OpportunitiesPlaceholder.tsx`

**Edited (surgical, additive only):**
- `src/components/premium/AppSidebar.tsx` — add nav item
- `src/components/BottomNav.tsx` — swap expenses → opportunities
- `src/pages/Index.tsx` — add page case + title

**Untouched:** LoadForm, computeLoadPay, reportPdf/CSV, useSubscription, Stripe edge functions, admin-api, parking, Landing, all SEO pages, `src/integrations/supabase/{client,types}.ts` (types regenerate automatically).

## 7. QA Checklist

- [ ] Build passes, no TS errors (types regenerated post-migration)
- [ ] Dashboard, Loads, Expenses (via desktop nav), Fuel, Reports, Settings all still load
- [ ] Opportunities nav item opens placeholder on desktop and mobile
- [ ] Mobile FAB still centered, not overlapping
- [ ] Pro gating, admin access, Stripe flows unchanged
- [ ] RLS: cannot read/edit another user's driver/recruiter profile, saved items, or applications
- [ ] Non-admin INSERT into `opportunities` cannot set `featured=true` or `admin_review_status='approved'` (trigger forces safe values)
- [ ] Suspended recruiter cannot UPDATE their opportunities or recruiter profile
- [ ] Manual: confirm `is_admin()` helper exists and is reused (verified — exists in db functions)

## 8. Open Decision

Mobile nav swap: this plan removes **Expenses** from the bottom bar (per the spec's recommended order). Expenses remains reachable via dashboard quick-action grid and desktop sidebar. Confirm this trade-off is acceptable before implementation — if not, alternative is to drop **Settings** instead and keep Expenses.
