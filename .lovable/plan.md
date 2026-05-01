# Fix: Recurring Expenses Not Generating

## Full Analysis Summary

I traced the entire recurring expenses pipeline and found one clear bug plus a missing-data side-effect.

### What's working ✅
- The `recurring_expense_templates` table has your active "Daily Meals" template ($80/mo, status=active, is_active=true).
- Your account has Pro access (active subscription + admin row), so the edge function would generate the expense.
- The `generate-recurring-expenses` edge function is deployed correctly with `verify_jwt = false`.
- The UI (RecurringExpensesView, HomeTimeDashboardCard, useRecurringExpenses hook) is fine — pause/resume/Home Time logic is sound.
- A daily cron job `generate-recurring-expenses` exists and runs every day at 06:00 UTC.

### What's broken ❌
**The cron job has failed every single run since it was created.** Looking at `cron.job_run_details`, every invocation from Apr 22 through May 1 returned:

```
ERROR: function extensions.http_post(url => unknown, headers => jsonb, body => jsonb) does not exist
```

The cron was registered with `extensions.http_post(...)`, but in this project the HTTP function lives in the `net` schema (the `pg_net` extension). Every other working cron job in the project (e.g. `expire-ended-trials-hourly`, `send-lifecycle-emails-daily`) uses `net.http_post(...)`.

**Result**: the edge function has never actually been called by the scheduler, so no `[Recurring: Daily Meals]` row was ever inserted into `expenses` — confirmed by my query (0 rows match `notes ILIKE '%[Recurring:%'`).

## Fix Plan

### 1. Recreate the cron job with the correct function (`net.http_post`)

Run a non-migration SQL insert (per Lovable rules for cron jobs containing project-specific URLs/keys):

```sql
SELECT cron.unschedule('generate-recurring-expenses');

SELECT cron.schedule(
  'generate-recurring-expenses',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://pngptztxwbtozwxrtbwo.supabase.co/functions/v1/generate-recurring-expenses',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <anon-key>"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

Including the `Authorization: Bearer <anon-key>` header to match the project's other cron jobs (defensive — even though `verify_jwt=false`, it keeps things consistent).

### 2. Manually trigger one run now to backfill April

After fixing the cron, invoke the edge function once so the template's April expense gets generated immediately (instead of waiting until tomorrow 06:00 UTC). The function's logic:
- Inserts an $80 Meals expense dated `2026-04-20` (the template's start_date, since it falls in the current month).
- Updates `last_generated_date` so May's run creates the May 1 expense and doesn't duplicate April's.

### 3. Verify

- Re-query `expenses` for `notes ILIKE '%[Recurring: Daily Meals%'` → should show one row.
- Re-query `recurring_expense_templates` → `last_generated_date` should be set.
- Check `cron.job_run_details` after the next 06:00 UTC run → should be `succeeded`.

## Technical Notes

- **No code changes needed** in `supabase/functions/generate-recurring-expenses/index.ts` — the function itself is correct (filters by `is_active=true AND status='active'`, gates on Pro/admin, skips paused templates, doesn't backfill skipped months). The `is_active`/`status` sync trigger is already in place.
- **No frontend changes needed** — the UI was reading directly from the templates table, so the "1 active · 0 paused" counts you see are accurate; they just never produced expenses because the cron never reached the function.
- **No config.toml changes** — `verify_jwt = false` is already set.

## Files / Resources Touched

- Cron job `generate-recurring-expenses` (database, via SQL insert tool, not migration).
- One-time HTTP call to the edge function to backfill April for your template.
- No source files modified.
