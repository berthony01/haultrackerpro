This plan is approved. Please run it as a surgical cleanup only.

Add these safeguards:

1. For the priority trigger verification, do not touch a random production opportunity. Use a known test opportunity or run the manual trigger test in preview/staging first. Confirm the no-op update does not create unwanted updated_at changes, audit logs, notifications, or analytics events.

2. Before revoking EXECUTE on the three recruiter priority SQL functions, confirm they are only used by triggers and are not called directly from frontend code, RPC calls, or edge functions under authenticated user context.

3. Keep this pass strictly scoped:

- no billing flow changes

- no Stripe edge function changes

- no driver report changes

- no role switcher changes

- no contract signing changes

- no unrelated Supabase linter cleanup

4. After implementation, verify:

- recruiter Reports sidebar item opens the recruiter report panel

- driver Reports still opens the driver report

- Growth/Fleet pricing copy matches recruiter landing copy

- empty report ranges disable Generate

- Priority placement badge still only appears when the opportunity is truly priority

- Verified Recruiter badge still only appears for approved and non-suspended recruiters

- featured values match Growth/Fleet plan eligibility

- build passes with no TypeScript errors

## Scope

Six surgical changes, no unrelated areas touched. Behavior stays the same; UX and copy get sharper and the migration cleans up linter noise.

---

### 1. Recruiter Reports panel — loading / empty / error states

File: `src/components/recruiter/RecruiterReportsPanel.tsx`

- Add an `aggregateRecruiterReport(data)` `useMemo` in the eligible branch and derive `isEmpty = aggregate.totals.applications === 0 && aggregate.totals.opportunities === 0 && aggregate.totals.contactRequests === 0 && aggregate.totals.contracts === 0` for the selected range.
- Replace the current `isError`-only banner with a stacked status area:
  - `isLoading` → skeleton (3 muted bars) under the date controls.
  - `isError` → existing destructive banner with a "Retry" button that calls `refetch`.
  - `!isLoading && !isError && isEmpty` → neutral muted banner: "No recruiter activity in this range. Pick a wider range or post your first opportunity," with a "Last 30 days" preset shortcut.
- Disable Generate when `isLoading || isError || isEmpty || busy`.
- Show the date range echo ("Showing data for MM/DD/YYYY – MM/DD/YYYY") under the CardDescription so the user always sees what was queried.
- Pull `refetch` from `useRecruiterReportData` (already returned) for the Retry button.

### 2. Pricing & recruiter landing bullets

Files: `src/pages/Pricing.tsx`, `src/components/landing/RecruiterLanding.tsx`

- Growth bullets → add `"Recruiter Activity & Pipeline reports (PDF + CSV)"` after the priority placement line.
- Fleet bullets → replace `"Recruiting snapshot dashboard"` with `"Recruiter Activity & Pipeline reports (PDF + CSV)"` (and keep Priority placement + Priority support).
- Starter bullets unchanged. No promise of seats, multi-user, or chat.
- Mirror the same wording in `RecruiterLanding.tsx` `plans` array for Growth and Fleet.

### 3. Recruiter sidebar + route wiring for Reports

Files: `src/components/premium/AppSidebar.tsx`, `src/pages/Index.tsx`, `src/components/opportunities/recruiter/RecruiterAccessRoute.tsx`

- Sidebar: add `{ id: 'recruiter-access:reports', label: 'Reports', icon: BarChart3 }` to `recruiterItems` just above `contracts`.
- `RecruiterAccessRoute`: extend `RecruiterView` to include `'reports'`. Lazy-import `RecruiterReportsPanel`. When `view === 'reports'` render it with `onBack={() => setView('hub')}` and an `onUpgrade` that calls `onBack` then navigates `/pricing`.
- `Index.tsx`:
  - Widen `recruiterView` state type to include `'reports'`.
  - In `handleNavigate`, map `sub === 'reports'` → `setRecruiterView('reports')`.
  - In `navKey` / `navLabel` derivation, add a `recruiter-access:reports` → `"Reports"` case with subtitle "Activity and Pipeline reports for your recruiting".
- No changes to driver navigation; driver `Reports` stays untouched.

### 4. OpportunityCard polish (presentation only)

File: `src/components/opportunities/OpportunityCard.tsx`

- Rename existing `"Priority"` badge label to `"Priority placement"` (clearer and matches pricing copy). Keep tone/colors.
- Add a subtle `title`/`aria-label` on the Priority badge: "Priority placement — Growth or Fleet plan".
- Guard the recruiter join shape so a missing `recruiter` object renders no badge instead of crashing (defensive only — feature stays gated to `verification_status === 'approved' && status !== 'suspended'`).
- No data-fetching changes. The opportunities list hook already handles loading/error; this card stays purely presentational.

### 5. Supabase linter pass

New migration. Two issue classes are in scope (the linter currently shows 87 warnings, most pre-existing). We target the ones introduced/owned by recent recruiter work, leaving unrelated tables alone:

- Functions added in `20260516155235_*` and `20260516155254_*` (`recruiter_has_priority_plan`, `opportunities_set_featured_from_plan`, `recruiter_billing_sync_featured`):
  - Re-declare with `SET search_path = public, pg_temp` (covers the "Function Search Path Mutable" warnings for these three).
  - `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;` and `GRANT EXECUTE ... TO service_role;` so they only run from triggers / service contexts. Triggers continue to run because trigger execution is not gated by EXECUTE on the function for `SECURITY DEFINER` invoked from a trigger.
- Storage / RLS / older functions outside this feature are explicitly out of scope; we note remaining warnings in the migration description so the user knows they exist.

### 6. Verify Priority = active Growth/Fleet plan

Read-only verification step (no schema change beyond #5):

- Run `supabase--read_query` to confirm:
  - All `opportunities.featured = true` rows belong to a recruiter whose `recruiter_billing_profiles` has `plan IN ('growth','fleet') AND status IN ('active','trialing')`.
  - All `opportunities.featured = false` rows do NOT meet that condition.
- Run a manual touch (`UPDATE opportunities SET recruiter_id = recruiter_id WHERE id = <sample>`) to confirm the BEFORE trigger recomputes `featured`. If the verify shows drift, re-run the existing backfill statement from migration `20260516155235`.

---

## QA checklist

1. Recruiter Reports panel: pick a range with zero data → empty banner appears, Generate is disabled, Retry only appears on error.
2. Loading state shows skeleton, not a blank card.
3. Pricing page Growth + Fleet rows show the new "Recruiter Activity & Pipeline reports (PDF + CSV)" bullet.
4. Recruiter landing page Growth + Fleet plan cards show the same bullet.
5. Recruiter sidebar shows a Reports item; clicking it opens `RecruiterReportsPanel` with the proper back button.
6. Driver sidebar Reports item still routes to the driver report.
7. Opportunity card badge reads "Priority placement"; "Verified Recruiter" badge still only shows for approved + non-suspended recruiters.
8. SQL verification confirms `featured` matches plan eligibility for every row.
9. Supabase linter shows fewer warnings (the three new functions are gone from the list).
10. Build passes, no TypeScript or console errors.

## Out of scope

Billing flows, Stripe edge functions, driver pages, landing redesign, role switcher, contract signing logic, and any storage bucket changes unrelated to the three new functions.