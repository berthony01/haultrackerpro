

## Admin Dashboard (Safe V1) — Implementation Plan

### Step 1 — Database: Create `admin_users` and `admin_audit_log` tables

Migration SQL:
- `admin_users` table: `id uuid PK`, `user_id uuid unique not null`, `email text not null`, `role text not null default 'admin'` (constrained to 'admin'/'super_admin'), `created_at timestamptz default now()`
- `admin_audit_log` table: `id uuid PK`, `admin_user_id uuid not null`, `action text not null`, `target_user_id uuid`, `metadata jsonb`, `created_at timestamptz default now()`
- Enable RLS on both tables
- Create `is_admin` and `is_super_admin` security definer functions that query `admin_users`
- RLS policies:
  - `admin_users` SELECT: only if caller is in `admin_users`
  - `admin_users` INSERT/DELETE: only if caller has `super_admin` role
  - `admin_audit_log` INSERT: only if caller is admin
  - `admin_audit_log` SELECT: only if caller is admin
- Seed row: `INSERT INTO admin_users (user_id, email, role) SELECT id, email, 'super_admin' FROM auth.users WHERE email = 'berthonyxyz@gmail.com' ON CONFLICT DO NOTHING`

### Step 2 — Edge function: `admin-api`

New file: `supabase/functions/admin-api/index.ts`

Single edge function with action-based routing. Uses service role key to read across all users. Validates caller is admin before any action.

Actions:
- `overview`: Count total users, pro users, total loads, loads last 7 days, total expenses from respective tables
- `search-users`: Query `profiles` + count loads/expenses by user_id, filter by email substring
- `get-user-detail`: Full profile + load/expense counts for a specific user
- `set-plan-override`: Update `profiles.subscription_status` for a target user (super_admin only). Log to `admin_audit_log`
- `list-admins`: Select all from `admin_users`
- `add-admin`: Insert into `admin_users` by email lookup (super_admin only). Log to audit
- `remove-admin`: Delete from `admin_users` (super_admin only, cannot remove self). Log to audit
- `billing-status`: Read `profiles` Stripe fields for a given user

Auth check: Extract JWT → verify user exists in `admin_users` → check role for privileged actions.

Add to `supabase/config.toml`: `[functions.admin-api]` with `verify_jwt = false` (handles auth internally).

### Step 3 — Admin hook: `useAdmin`

New file: `src/hooks/useAdmin.ts`

- On mount (when user is available), query `admin_users` table for current `user_id`
- Returns `{ isAdmin, role, isLoading }`
- Uses direct Supabase client query (RLS will handle access — non-admins get empty result)

### Step 4 — Admin Dashboard page

New file: `src/pages/Admin.tsx`

- Uses existing UI components (Card, Tabs, Button, Input, Table, Badge, Dialog)
- Same dark theme, same fonts, same spacing
- 4 tabs: Overview, Users, Admins, Billing Sync

**Overview tab**: StatCards showing total users, pro users, total loads, loads (7d), total expenses. Fetches from `admin-api?action=overview`.

**Users tab**: Search input by email. Results table: email, created_at, plan status, loads count, expenses count. Click row → detail panel with "Set Plan Override" button (super_admin only, with confirmation AlertDialog). Calls `admin-api?action=set-plan-override`.

**Admins tab**: List of admins in a table. "Add Admin" button (super_admin only) with email input dialog. "Remove" button per row (super_admin only, self-removal requires confirmation).

**Billing Sync tab**: Read-only display of Stripe fields from profiles for a searched user. No "Force Sync" button (no existing sync endpoint).

### Step 5 — Route & navigation

- Add `/admin` route in `App.tsx` as a protected route that also checks admin status
- Create `AdminRoute` wrapper component that uses `useAdmin` hook, redirects non-admins to `/`
- In `SettingsView.tsx`: Add an "Admin Dashboard" button in the Support section, conditionally rendered only when `useAdmin().isAdmin` is true. Links to `/admin` via `navigate('/admin')`.

### Files created
- `supabase/functions/admin-api/index.ts`
- `src/hooks/useAdmin.ts`
- `src/pages/Admin.tsx`

### Files modified (minimal)
- `src/App.tsx` — add `/admin` route + `AdminRoute` wrapper
- `src/components/SettingsView.tsx` — add conditional Admin link (~5 lines)
- `supabase/config.toml` — add `[functions.admin-api]`

### No changes to
- Load/expense logic, calculations, Pro gating, Stripe flows, theme, existing components

