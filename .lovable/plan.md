

## Test the lifecycle email sequence on real users

You want to manually trigger the Day 0 / Day 2 / Day 7 emails to your existing inactive signups so you can confirm deliverability, copy, and the unsubscribe flow before the daily cron does it automatically.

### What I'll build

**1. Admin "Send Test Email" panel** (Admin → Emails tab)

A new card at the top of the Emails tab with:
- **Recipient picker** — dropdown of all users (excludes the 3 test accounts by default, but with a "show test accounts" toggle so you can send to yourself first)
- **Template picker** — `welcome`, `lifecycle-day2`, `lifecycle-day7`
- **Send button** — fires one email immediately
- **"Send to all inactive users" button** (separate, with confirm dialog) — runs the same eligibility logic as the cron (verified, opted-in, 0 loads, not a test account) but ignores the day-2/day-7 age windows so you can send right now

Results land in the existing email log table below so you can watch status flip from `pending` → `sent`.

**2. New admin-api action: `send-lifecycle-test`**

Backend handler that:
- Verifies caller is admin (existing pattern)
- Accepts `{ templateName, recipientUserId }` for single send, or `{ templateName, mode: 'all-inactive' }` for bulk
- For bulk mode: reuses the exact eligibility logic from `send-lifecycle-emails` (verified email, no recent email change, opted-in, zero loads, not in TEST_ACCOUNTS) — but skips the age window check
- Invokes `send-transactional-email` with idempotency key `<template>-test-<userId>-<yyyymmdd>` so you can re-send on a different day if needed
- Returns per-user result (sent / skipped + reason)

**3. Safety rails**

- Test accounts (`berthonyxyz@`, `peejayslifestyle@`, `wysdomaniac@`) excluded from bulk mode unless you flip the toggle
- Idempotency key includes today's date → prevents accidental double-sends within the same day
- Bulk send shows a confirm dialog with the exact recipient count before firing
- All sends logged to `email_send_log` and visible in the existing table

### Recommended test flow (after I ship this)

1. Send `welcome` to your own account → confirm it arrives, looks right, unsubscribe link works
2. Send `lifecycle-day2` to one real inactive user → check inbox + log status
3. If good, use "Send to all inactive users" with `lifecycle-day2` to hit the remaining ~10 users
4. Wait a day, repeat with `lifecycle-day7`

### Files

- `supabase/functions/admin-api/index.ts` — add `send-lifecycle-test` action
- `src/pages/Admin.tsx` — add the test panel to the Emails tab
- Redeploy `admin-api`

No new tables, no migrations, no changes to the daily cron.

