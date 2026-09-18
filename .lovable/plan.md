# RB-3A Bot Menu — Read-Only Audit Report

No code, database, deployment, or publish action was taken. Findings only.

## Menu button wiring (source of truth: `supabase/functions/telegram-poll/index.ts`)

`RECRUITER_BUTTONS` (lines 819-824), shown for `menu_recruiter` and appended for `menu_multi_role`:

| Button | Binding | Nature |
| --- | --- | --- |
| ➕ Post Opportunity | `callbackData` = `composeQuickPostNewData()` -> literal `q1:n` | Telegram-native callback |
| 📋 My Opportunities | `url` = `https://haultrackerpro.com/dashboard?page=recruiter-access:manager` | Opens web app |
| 💬 Conversations | `url` = `https://haultrackerpro.com/dashboard?page=recruiter-access:applications` | Opens web app |
| 📊 Results | `url` = `https://haultrackerpro.com/dashboard?page=recruiter-access:reports` | Opens web app |

These are plain inline URL buttons (`APP_BASE_URL` = `https://haultrackerpro.com`, lines 799-806). There is **no Telegram WebApp (`web_app`) configuration** anywhere — no mini-app, no deep link scheme, no menu-button API registration. Opening the site is the intended, implemented behavior for those three, not a bug.

## Post Opportunity path — implemented and Telegram-native

- Tap emits `q1:n`. `classifyUpdate` (`_shared/telegram-poll-ingest.ts:705-718`) routes any `q1:` payload to `kind: "quick_post_action"`, kept strictly disjoint from RB-2B's `c1` Accept/Pass namespace.
- Processors: `processQuickPostCommandUpdate` -> `telegram_process_quick_post_command_update`; then source text -> `telegram_process_quick_post_source_update`; then `telegram_complete_quick_post_extraction`; then confirm/restart/cancel via `telegram_process_quick_post_action_update` (index.ts:377-540).
- Review card `composeQuickPostReview` with buttons ✅ Confirm (`q1:c:<draft>`), 🔄 Start Over (`q1:r:…`), ✖️ Cancel (`q1:x:…`) (index.ts:604-608).
- `/post` command branch also exists (`POST_COMMAND_PATTERN`, ingest:767).
- Ordinary private text is only treated as Quick Post source when the database says a live draft awaits input; conversation replies and slash commands keep precedence (ingest:770-790).
- Success follow-up reuses `OPPORTUNITIES_BUTTONS` (single web link, no opportunity id in chat).

So a conversational copy-paste posting path **is** fully implemented. The earlier "button did nothing" was the `min(uuid)` fault in `_telegram_quick_post_recruiter`, corrected by `20260922060000_phase_rb3a1_quick_post_recruiter_min_uuid_fix.sql`.

## What does NOT exist inside Telegram today

- No in-Telegram listing, editing, pausing, or closing of posted opportunities.
- No in-Telegram results/metrics view.
- No in-Telegram applicant/lead browsing. Only RB-2A/2B/2C conversation alerts, Accept/Pass callbacks, and reply-to-message bridging exist.

## Regression assessment

None found from the latest menu changes. The menu is additive: work buttons stayed URL-only, recruiter buttons gained exactly one callback. Symptoms 2 and 3 ("opened the web app") match the implemented design, not a regression.

## Smallest surgical next fix

Nothing is broken; the open item is a behavioral decision, not a defect. Options, cheapest first:

1. **Prove Quick Post end-to-end** (zero code): one fresh tap of ➕ Post Opportunity after the `min(uuid)` correction, then read the receipt/logs. This is still the only unproven link in RB-3A.
2. **If Telegram-native "My Opportunities" is wanted**: a read-only list processor reusing the existing `telegram_resolve_recruiter_actor` authorization and the existing receipt/lease pipeline — new terminal result code plus one service-role-only read RPC, no new table, no new bot, no new poller.
3. **If Telegram-native "Results" is wanted**: same shape, bounded counters only, reusing the recruiter report authorization already enforced server-side.

Recommend closing item 1 before authorizing 2 or 3. Awaiting instruction.
