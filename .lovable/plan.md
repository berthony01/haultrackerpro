## Audit Findings

**Trial-facing admin logic still present (must remove from UI):**

1. `supabase/functions/admin-api/index.ts`
   - `overview` action returns `subs_trialing` (line 100, 116)
   - `list-users` returns `trial_end` (lines 320, 327–329, 352)
   - Does **not** return a `subs_canceled` count or `conversion_rate`

2. `src/pages/Admin.tsx`
   - Type `OverviewData` declares `subs_trialing` (line 21) and user `trial_end` (line 55)
   - Overview "Users & Subscriptions" tile shows **"Trialing"** KPI (line 575)
   - Users table shows trial-days-left badge `{trialDaysLeft}d` (lines 822–824, 840–842) and `isTrialing` styling

**Canonical subscription statuses currently in DB:** `free` (9), `trialing` (2), `active` (1). No `canceled`/`past_due` rows yet, but schema supports them.

**What stays untouched (intentionally):**
- `handle_new_user` DB trigger that grants 14-day trialing on signup → core auto-trial system (mem://business/auto-trial-system). The audit instructions explicitly say *"Do not drop database columns or old migrations"*.
- `subscriptions.trial_end` column and `expire_ended_trials()` function.
- All other admin tabs (Activation, Admins, Billing, Feedback, Emails, Parking, Drivers, Starter Kit) — already audited as correct.
- All driver-facing UI, Stripe, RLS, edge function security.

---

## Changes

### 1. `supabase/functions/admin-api/index.ts`

**`overview` action — replace subscription queries:**
- Remove the `subsTrialing` query.
- Keep `subsActive` (status='active').
- Replace `subsFree` query (currently `in ('free','canceled')`) with two separate queries:
  - `subsFreeOnly` → `status='free'` OR null
  - `subsCanceled` → `status in ('canceled','past_due','unpaid','incomplete_expired')`
- Treat **trialing users as Pro** for the active count (they have full Pro access). Compute `subs_active_pro = subsActive.count + trialingCount` where `trialingCount` is fetched separately but **not exposed as its own KPI**. Simpler: add trialing into active in the API response.
- Add `pro_conversion_rate` = `subs_active_pro / total_users` (rounded to 1 decimal).
- Response shape becomes:
  - `total_users`
  - `subs_free`
  - `subs_active_pro` (active + trialing combined)
  - `subs_canceled`
  - `pro_conversion_rate`
  - (drop `subs_trialing` from response)

**`list-users` action:**
- Stop selecting `trial_end` from subscriptions.
- Stop returning `trial_end` on each user row.
- Keep `sub_status` (canonical from `subscriptions` table) — but normalize: if status is `trialing`, return `'pro (trial)'` so admins see they're on Pro without the day-countdown. *(Alternative: just return raw status `'trialing'` and let UI render it as a neutral Pro badge with no countdown.)* → Going with **return raw status, UI renders trialing as Pro-styled badge with no countdown.**

### 2. `src/pages/Admin.tsx`

**Type `OverviewData` (line ~17–32):**
- Remove `subs_trialing`.
- Add `subs_active_pro: number`, `subs_canceled: number`, `pro_conversion_rate: number`.
- Remove `subs_active`, `subs_free` reshape: keep `subs_free` and `subs_active_pro` and `subs_canceled`.

**Type `UserRow` (~line 50–60):**
- Remove `trial_end?: string | null`.

**Overview "Users & Subscriptions" grid (line 572–589):**
- Replace 4 tiles with 5:
  - Total Users
  - Free Users
  - Active Pro (active + trialing combined)
  - Canceled / Expired
  - Pro Conversion Rate (`{pro_conversion_rate}%`)
- Use a `grid-cols-2 md:grid-cols-3` so 5 tiles wrap cleanly on mobile (715px and 375px).
- Drop the `Sparkles` icon usage here (still imported for Lead Magnet section line 669, so import stays).

**Users table rows (lines 820–851):**
- Remove `trialDaysLeft` calc and the `{trialDaysLeft}d` badge.
- Keep status badge logic, but treat `trialing` like `active` (variant `'default'`) since trialing users have Pro access. Rendered text: show `pro` for both trialing and active to remove trial-facing language; show raw status for canceled/free.
- One simple mapping in render:
  ```
  const displayStatus = (status === 'trialing' || status === 'active') ? 'pro' : status;
  const isPaid = displayStatus === 'pro';
  ```

### 3. Files NOT modified
- `supabase/functions/handle-*`, `stripe-webhook`, `check-subscription`, `create-checkout`, `customer-portal`
- Any migration file
- `src/hooks/useSubscription.ts` (still surfaces trialing for the user-facing trial banner — that's intentional and outside admin scope)
- All other tabs / components

---

## Verification

1. `tsc --noEmit` clean.
2. Deploy `admin-api` and curl `?action=overview` to confirm the new payload shape; confirm `subs_active_pro` ≈ 3 (1 active + 2 trialing) on current DB.
3. Curl `?action=list-users` to confirm rows have no `trial_end`.
4. Visually verify Admin → Overview shows 5 tiles, no "Trialing" tile, no trial-days badge in Users table.
5. Responsive QA at 375px and 715px — confirm 5-tile grid wraps cleanly.

## Out of scope (explicit non-goals)
- Removing `subscriptions.trial_end` column.
- Changing the `handle_new_user` trigger that creates trialing rows.
- Touching the user-facing TrialBanner.
- Any change to non-admin code.