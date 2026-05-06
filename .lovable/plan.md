# Recurring Expense Fix Plan

## Root Cause (confirmed from your data)

Your template in the database:
- **Name:** "Daily Meals"
- **Amount:** $80
- **Start date:** 2026-04-20
- **Frequency:** `monthly` ← this is the bug
- **Last generated:** 2026-05-01
- **Status:** active

The recurring system is **hardcoded to monthly-only**, even though the column is called `frequency`:

1. `RecurringExpensesView.tsx` line 586 hard-codes `frequency: 'monthly'` on every insert — there is no UI to choose daily/weekly.
2. `generate-recurring-expenses` ignores `frequency` entirely. It only ever:
   - Runs once per day at 6:00 AM UTC (cron is correct).
   - Generates **one row per template per calendar month**, dated the 1st.
   - Sets `last_generated_date = first of current month`, then the `last_generated_date < currentMonthStart` filter blocks any further generation until next month.

So your "Daily Meals" template behaved correctly per the *current* code: April 20 (start month) → 1 row, May 1 → 1 row. June 1 will create the next one. Nothing crashed; the feature just doesn't support daily/weekly at all.

This also explains every other "missing date" — they were never supposed to be created under monthly mode.

## What to fix

### 1. Database
Add a small CHECK-equivalent validation (via trigger to stay flexible) so `frequency` is one of `daily`, `weekly`, `monthly`. No schema change needed — column already exists and defaults to `monthly`.

### 2. Edge function `generate-recurring-expenses`
Rewrite the generation loop to be frequency-aware and idempotent **per period**, using `last_generated_date` as the cursor:

- **monthly:** generate on the 1st of each month from `max(start_date, last_generated_date+1month)` up to current month. (Preserves today's behavior.)
- **weekly:** generate every 7 days from `start_date`, advancing the cursor by 7 days until `> today`.
- **daily:** generate one row per day from `max(start_date, last_generated_date+1)` through today (catch-up loop, capped at e.g. 366 rows per template per run as a safety net).

For each generated row:
- Insert into `expenses` with `expense_date` = that period's date.
- Update `last_generated_date` to that date.
- Respect `end_date` (stop if exceeded).
- Skip if template is paused or user is not Pro/admin (unchanged).

Date math will use explicit UTC construction (`Date.UTC(y, m, d)`) — no `new Date(string)` parsing — to avoid the timezone-shift bug pattern that bit us before.

### 3. UI — `RecurringExpensesView.tsx`
- Add a Frequency selector (Daily / Weekly / Monthly) to the add/edit form.
- Show frequency clearly on each template card (already partially shown via `template.frequency`).
- Default remains Monthly so existing flows are unchanged.

### 4. Backfill your existing "Daily Meals" template
Once the function is frequency-aware, change that template's `frequency` from `monthly` → `daily` (one-tap in the new UI, or I can do it via a one-off SQL update). The next 6 AM UTC run will then catch up all missing days from `last_generated_date` (May 1) through today, dated correctly. To avoid waiting until 6 AM UTC, I'll also call the function once after deploy to trigger an immediate catch-up.

### 5. Safety
- Keep the per-template safety cap (max ~366 inserts per run) so a wildly old `start_date` can't insert 10k rows by accident.
- Keep the existing Pro/admin gate and idempotency (no duplicate rows for the same date because `last_generated_date` always advances).
- Leave the cron schedule (`0 6 * * *`) as-is.

## Files to change

```text
supabase/functions/generate-recurring-expenses/index.ts   (frequency-aware generator)
src/components/RecurringExpensesView.tsx                  (add Frequency selector)
src/hooks/useRecurringExpenses.ts                         (allow frequency in insert payload)
supabase/migrations/<new>.sql                             (frequency CHECK trigger; safe default)
```

## Verification after deploy
1. Manually invoke the function once → confirm your "Daily Meals" template generates rows for every missing day from May 2 → today.
2. Confirm `last_generated_date` advances to today.
3. Re-invoke → confirm zero new rows (idempotent).
4. Add a test weekly template → confirm only one row per 7-day cycle.

Approve and I'll implement.