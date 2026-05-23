# Phase 10 — Referral Admin Oversight

Goal: give admins a platform-wide view of referral activity, adoption, and operational risk. Tracking only — no payment, payout, or tax logic.

## Audit findings

- Admin shell pattern: `src/pages/Admin.tsx` uses `AdminShell` + `Tabs` driven by `ADMIN_NAV` in `src/components/admin/AdminSidebar.tsx`. New admin sections are added by appending a nav item and a matching `<TabsContent value="...">`.
- Admin gating: `AdminRoute` in `src/App.tsx` + `useAdmin` hook (DB `admin_users` row, with `berthonyxyz@gmail.com` UI fallback). Server still enforces via `is_admin(auth.uid())`.
- Referral RLS already includes `Admins view all referrals` on `driver_referrals` — no migration required for reads. Admins can also read `recruiter_profiles`, `opportunities`, and (per existing admin patterns) `recruiter_referral_settings` / `referral_status_events` via existing admin policies. No RLS change is planned; if a missing admin SELECT policy is discovered during build, add only the narrowest `USING (is_admin(auth.uid()))` policy.
- Status labels: reuse `REFERRAL_STATUS_LABELS` / `referralStatusLabel` from `src/lib/opportunities/referralStatus.ts`.
- Recruiter-side analytics pattern to mirror: `useRecruiterReferralAnalytics` + `RecruiterReferralAnalyticsCard` (safe date helpers, fallbacks, no payout math).

## What ships

### Navigation

- Add `{ value: 'referrals', label: 'Referral Oversight', icon: Share2 (or Network) }` to `ADMIN_NAV` in `AdminSidebar.tsx`, placed after `recruiters`.
- Add a matching `<TabsContent value="referrals">` block in `src/pages/Admin.tsx` that renders the new panel. No route changes.

### New files

- `src/hooks/admin/useAdminReferralOversight.ts` — admin-scoped data hook.
- `src/components/admin/referrals/AdminReferralOversightPanel.tsx` — top-level panel with disclaimer, filter, and sections.
- `src/components/admin/referrals/AdminReferralKpiCards.tsx` — Section 1 KPIs.
- `src/components/admin/referrals/AdminReferralStatusBreakdown.tsx` — Section 2.
- `src/components/admin/referrals/AdminRecruiterReferralTable.tsx` — Section 3.
- `src/components/admin/referrals/AdminTopReferringDriversTable.tsx` — Section 4.
- `src/components/admin/referrals/AdminOpportunityReferralTable.tsx` — Section 5.
- `src/components/admin/referrals/AdminRecentReferralActivity.tsx` — Section 6.
- `src/components/admin/referrals/AdminReferralWatchlist.tsx` — Section 7.

### Hook behavior (`useAdminReferralOversight`)

- Single React Query key `['admin-referral-oversight', timeframe]`.
- Parallel queries (client uses anon key + admin RLS — no service role):
  1. `driver_referrals` select all rows.
  2. `opportunities` select `id, title, recruiter_id`.
  3. `recruiter_profiles` select `id, user_id, company_name, contact_email` (fields limited to what admin panels already show).
  4. `recruiter_referral_settings` select all (for "missing terms" signal).
- Join client-side into shape: `{ referrals, byRecruiter, byDriver, byOpportunity, statusCounts, kpis, watchlist }`.
- Safe date helper (`safeTime` mirrored from `useRecruiterReferralAnalytics`).
- Loading / empty / error states returned explicitly.

### Sections (per spec)

1. **KPIs**: total, open (not `closed_not_hired`/`marked_paid_externally`), hired, eligible based on recruiter terms, marked paid externally, referral-to-hire rate (`hired/total*100`, 0 when total=0).
2. **Status breakdown**: counts per status using friendly labels.
3. **Recruiter performance table** grouped by `recruiter_id` (company name fallback "Company unavailable").
4. **Top referring drivers** grouped by `referring_driver_id`. Display "Driver · #xxxxxxxx" (first 8 chars of UUID). No email shown.
5. **Opportunity performance** grouped by `opportunity_id` (title fallback "Untitled opportunity").
6. **Recent activity** — last 25 referrals sorted by `last_status_at` (fallback `created_at`), with safe date label.
7. **Watchlist signals** (neutral copy):
  - "High closed count" — recruiter with `closed_not_hired >= 5`.
  - "High externally marked count" — recruiter with `marked_paid_externally >= 5`.
  - "Stale referral activity" — referral with no status change in 30+ days and not terminal.
  - "Missing terms" — recruiter with referrals but no `recruiter_referral_settings` row or blank bonus terms.
  - "No recent movement" — recruiter with 3+ referrals all still `referral_sent`.

### Filter

- Timeframe pills: All time, Last 30 days, Last 90 days, This month. Helper text: *"Timeframes are based on referral creation date."* Status / recruiter search filters deferred (kept out of this phase).

### Disclaimer (top of panel)

> Referral oversight is for platform monitoring only. Referral bonuses, if offered, are paid externally by recruiters. Haul Tracker Pro does not process, verify, guarantee, or enforce referral payments.

### Copy safety

No payout / commission / amount-owed / 1099 wording anywhere. Only neutral progress labels and the approved phrases ("marked paid externally", "eligible based on recruiter terms", "referral-to-hire rate", etc.).

## Tests

- `src/test/adminReferralOversight.test.ts` — pure unit tests against an aggregator helper extracted from the hook:
  - empty input → all zeros, hire rate 0, no NaN.
  - mixed statuses → correct counts + grouping by recruiter / driver / opportunity.
  - stale + missing-terms + high-closed signals fire on the expected fixtures.
  - invalid/missing `last_status_at` does not crash sort.

## Out of scope (explicitly not touched)

Stripe / payouts / billing, recruiter posting rules, contract workflow, driver dashboard / loads / expenses / fuel / tax / reports / parking / streaks, public/legal/pricing pages, recruiter analytics, driver referral UI, notifications, RLS for non-admin roles.

## Verification

- `npm run build` and `npm run test` run automatically by the harness.
- Manual: sign in as admin → Admin → Referral Oversight loads with metrics; sign in as non-admin driver/recruiter → `AdminRoute` redirects to `/dashboard`; toggle timeframe pills; with zero referrals empty state renders without NaN.

## Risks

- If `recruiter_referral_settings` lacks an explicit admin SELECT policy, the "Missing terms" signal will silently show all recruiters as missing terms. Mitigation: during build, verify with a quick `supabase--read_query` as admin; if blocked, add a single narrow policy `USING (is_admin(auth.uid()))` in a small migration before shipping. No other RLS changes.

Do not expose referred driver email or phone in the admin oversight dashboard unless existing admin referral tools already display it. Use a safe referred-driver summary by default.