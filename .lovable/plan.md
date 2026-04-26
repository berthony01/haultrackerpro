## Goal

Reflect everything we've shipped recently inside `/admin` so you can monitor adoption and health from one place. **Surgical additions only** — no existing tab, action, layout, RLS, or auth flow changes.

---

## Phase 1 — Fix and expand Overview KPIs (`admin-api: overview` + `Admin.tsx`)

Replace the 5-card grid with a richer, accurate set. Switch subscription counts to the canonical `subscriptions` table.

**New `overview` payload** (single edge function action, parallel `Promise.all`):

- `total_users` (unchanged)
- `subs_trialing` — `subscriptions where status='trialing' and trial_end > now()`
- `subs_active` — `subscriptions where status='active'`
- `subs_free` — `subscriptions where status in ('free','canceled')` (or null status)
- `total_loads`, `loads_7d` (unchanged)
- `total_expenses`, `expenses_7d` (new)
- `total_fuel_logs`, `fuel_logs_7d` (new)
- `recurring_templates_active` — `recurring_expense_templates where is_active=true`
- `parking_locations_total`, `parking_reports_7d`, `parking_verifications_7d` (new)
- `driver_points_active_users` — `count(*) from driver_points where weekly_points > 0`
- `lead_magnet_signups_total`, `lead_magnet_signups_7d` (new)

UI: keep current 2-col card style; group into 4 collapsible sections — **Users & Subscriptions**, **Activity (7d)**, **Community / Parking**, **Lead Magnet**.

---

## Phase 2 — New "Parking" tab

A read-only operator view of the community parking system.

**New edge actions:**

- `parking-overview` → totals, last 7d reports, last 7d verifications, top 10 most-reported locations (join `parking_locations` ↔ count of `parking_reports`)
- `list-parking-reports?limit=50` → recent reports with location name, reporter masked handle, status, created_at
- `list-parking-locations?search=&page=` → paginated locations (name, city, state, type, total_reports, last_verified_at)

**UI:**

- Top: 4 KPI tiles (Locations, Reports 7d, Verifications 7d, Avg reports/location)
- Table: Top 10 hottest locations (sortable by report count)
- Table: Recent 50 reports (with status badge: available / limited / full)

No mutations from admin in v1 (read-only) to keep scope tight and avoid touching driver-facing RLS.

---

## Phase 3 — New "Drivers" (points/leaderboard) tab

Reuses the existing `get_weekly_driver_leaderboard` RPC.

**New edge actions:**

- `driver-points-overview` → total active drivers, total points awarded, distribution by tier (Bronze/Silver/Gold/Platinum), top streak
- `driver-leaderboard?limit=25` → calls the existing RPC server-side and returns rows

**UI:**

- 4 KPI tiles (Active drivers this week, Total points all-time, Top streak, Platinum count)
- Leaderboard table (rank, masked handle, weekly points, total points, parking points, load points, streak, tier)

---

## Phase 4 — New "Starter Kit" tab (Lead Magnet)

**New edge actions:**

- `lead-magnet-overview` → total signups, signups 7d / 30d, conversions to verified user (match `lead_magnet_signups.email` → `auth.users.email_confirmed_at`)
- `list-lead-magnet-signups?page=&search=` → paginated rows

**UI:**

- 4 KPI tiles (Total signups, 7d, 30d, Converted-to-account %)
- Table: email, source/utm if present, created_at, "→ has account" badge

---

## Phase 5 — Augment "Users" table

Add 3 columns to `list-users` response **without breaking the existing layout** (append columns):

- `subscription_status` from `subscriptions` table (trialing / active / free) — canonical, replacing the legacy `profiles.subscription_status` column shown today
- `trial_end` (only when trialing) — render as "Xd left" badge
- `fuel_logs_count`
- `driver_points_total`

Show the trial countdown badge in the existing user row. No row-action changes.

---

## Phase 6 — New "AI / Automation" mini-panel inside Overview

Small section (not a full tab) showing 3 counters from data we already collect:

- `parse_usage` count for last 7d (Paste Load + Scan + Voice combined, grouped by `feature`)
- `expense_automation_logs` count for last 7d
- `ai_insights` count for last 7d

This validates the "Pro Saved You Time" claim with real numbers.

---

## Phase 7 — Wiring + safety

- All new actions follow the **same pattern** as existing ones: admin gate via `admin_users` row, GET-only for reads, no super_admin requirement for read endpoints.
- Tabs grid expands from `grid-cols-7` → `grid-cols-10`. On mobile (current Admin already uses `max-w-4xl`), the TabsList wraps cleanly with `flex-wrap` fallback (small CSS tweak).
- No changes to: auth, Stripe, Supabase migrations, RLS, `useAdmin`, `useAuth`, `Index.tsx`, public pages, or any driver-facing component.
- TypeScript types for the new payloads added inline at the top of `Admin.tsx` matching the existing pattern.

---

## Files to modify

- `supabase/functions/admin-api/index.ts` — add 8 new actions + extend `overview`
- `src/pages/Admin.tsx` — add 3 tabs (Parking, Drivers, Starter Kit), expand Overview KPIs + AI mini-panel, append columns to Users table

## Files NOT touched

- Any auth, billing, Stripe, RLS, or driver-facing file
- `src/integrations/supabase/types.ts` (auto-generated)

## Verification after build

1. `tsc --noEmit` clean
2. Each new tab loads without errors for an admin account
3. Existing Overview / Activation / Users / Admins / Billing / Feedback / Emails behave identically
4. Mobile (375px) and current 715px viewport — tabs wrap, tables scroll horizontally as today

## What is intentionally NOT included

- No write actions on parking, points, or lead magnet rows (read-only v1)
- No CSV export from admin (can be a follow-up)
- No realtime subscriptions (polling on tab open, like existing tabs) Proceed with the admin dashboard update plan, but revise it before implementation:
  Remove all 14-day trial and trial-related admin logic.
  Do NOT add:
  - subs_trialing
  - trial_end
  - X days left badge
  - trial countdown
  - trial status cards
  - trial-based user table columns
  Replace with clean Free / Pro / Canceled subscription visibility:
  Overview KPIs should include:
  - total users
  - free users
  - active Pro users
  - canceled/expired users
  - Pro conversion rate
  - total loads
  - loads last 7 days
  - total expenses
  - expenses last 7 days
  - total fuel logs
  - fuel logs last 7 days
  - active recurring expense templates
  - parking locations total
  - parking reports last 7 days
  - parking verifications last 7 days
  - active driver points users
  - lead magnet signups total
  - lead magnet signups last 7 days
  In the Users table, append:
  - subscription_status from the canonical subscriptions table
  - fuel_logs_count
  - driver_points_total
  - lead_magnet_source if easily available
  Do not show trial_end or trial countdown.
  Add the new admin tabs exactly as planned:
  - Parking tab
  - Drivers / Leaderboard tab
  - Starter Kit tab
  Keep all three read-only for v1.
  Add the AI / Automation mini-panel inside Overview if the data tables already exist and can be queried safely.
  Do not modify auth, Stripe, RLS, Supabase migrations unrelated to this, dashboard, public pages, or driver-facing components.
  Implement in phases:
  1. audit existing Admin.tsx and admin-api
  2. update overview payload
  3. add Parking tab
  4. add Drivers tab
  5. add Starter Kit tab
  6. append Users table columns
  7. add AI/Automation mini-panel
  8. run TypeScript/build/mobile QA
  After implementation, provide a final report with files changed, edge actions added, tabs added, metrics added, and QA results.