# Audit Findings — Admin User Detail "free" vs "pro" mismatch

## Root cause (confirmed in DB + code)

The Users **table** and the User Detail **modal** read from two different sources:

| Surface | Field used | Source |
|---|---|---|
| Users table (`Plan` column) | `u.sub_status ?? u.subscription_status`, then maps `trialing`/`active` → `pro` | Canonical `subscriptions` table (correct) |
| User Detail modal (`Plan`, `Set Pro/Free` button) | `selectedUser.subscription_status` only | Legacy `profiles.subscription_status` (stale) |

DB confirms both flagged users:
- `andersontruckingra8@gmail.com` → `subscriptions.status = trialing`, `plan_key = pro_monthly`, `trial_end = 2026-05-04` — but `profiles.subscription_status = 'free'`.
- `againstalloddstransportllc@gmail.com` → `subscriptions.status = trialing`, `plan_key = pro_monthly`, `trial_end = 2026-04-30` — but `profiles.subscription_status = 'free'`.

So the **table is correct** (these users are on an active Pro trial via the auto-trial system) and the **modal is wrong** (reading the legacy profile column that was never updated by the trial trigger).

Total Pro right now per canonical table: **1 active + 2 trialing = 3 Pro users**, 9 free. No data is broken — only the modal display is.

## Fix (surgical, modal-only)

**File:** `src/pages/Admin.tsx` (User Detail dialog, lines ~886–910)

1. Compute the same normalized status the table uses:
   ```ts
   const rawStatus = selectedUser.sub_status ?? selectedUser.subscription_status;
   const displayStatus = (rawStatus === 'trialing' || rawStatus === 'active') ? 'pro' : rawStatus;
   ```
2. Render `{displayStatus}` in the Plan row instead of `selectedUser.subscription_status`.
3. Use `displayStatus === 'pro'` for the Set Pro/Free button's variant, label, and the new-status payload sent to `planOverrideConfirm`.
4. No edge-function changes required — `list-users` already returns `sub_status`/`sub_plan_key` from the canonical `subscriptions` table.

## Out of scope (per no-trial-admin-UI strategy already in place)

- Do NOT show `trial_end` or a countdown in the modal.
- Do NOT drop `profiles.subscription_status` (legacy field, separate cleanup).
- Do NOT change the Set Pro/Free flow itself or Stripe logic — only what the modal reads.

## Verification after fix

- Click `andersontruckingra8@gmail.com` → modal shows Plan: **pro**, button shows **Set Free**.
- Click a true free user (e.g. `theurpi@gmail.com`) → modal shows Plan: **free**, button shows **Set Pro**.
- Table and modal now agree; Overview KPIs (`Active Pro = 3`) remain correct.
- TypeScript check passes.
