# TG-2D — Pre-Implementation Connector Inspection (READ-ONLY REPORT)

## Start gate

| Check | Result |
| --- | --- |
| Git HEAD == `f4839457319a13917d263618bcd9df759474103a` | PASS (exact match) |
| Working tree clean | PASS (`git status --porcelain` empty) |
| Live DB has zero public `telegram_%` tables/functions | PASS (catalog query returned 0 rows) |

No files were edited. No connection was linked. No Telegram API call was made.

## 1. Supported gateway invocation pattern

The Telegram connector in this workspace is gateway-backed (`uses connector gateway: true`, `auth_type: api_key`). The supported server-side pattern is a plain HTTPS call from server code:

```text
POST/GET https://connector-gateway.lovable.dev/telegram/<botApiMethod>
Authorization:        Bearer ${LOVABLE_API_KEY}
X-Connection-Api-Key: ${TELEGRAM_API_KEY}
Content-Type:         application/json
```

`getUpdates`, `sendMessage`, and `answerCallbackQuery` are all reached that way (`/telegram/getUpdates`, `/telegram/sendMessage`, `/telegram/answerCallbackQuery`). The gateway injects the real bot token; `TELEGRAM_API_KEY` is a Lovable connection key, not the bot token, and no bot token ever enters the repository. Provider failures come back as either a non-2xx status or a 200 body with `{ "ok": false, "error": ... }` — both must be checked.

## 2. Is a Telegram connection linked to THIS project?

No. The workspace connection list shows `Token Shield AI (connector_id: telegram)` with `is linked to project: no`. It belongs to the other product. There is currently **no** Telegram connection linked to HaulTracker Pro, and no `TELEGRAM_API_KEY` present in this project's environment. Consequently no gateway call from this project can authenticate today.

This is a governance decision, not something to improvise: either the existing TokenShield connection gets linked to HaulTracker Pro, or a separate HaulTracker-owned Telegram connection/bot is created. Sharing one bot across two products would put HaulTracker dispatch traffic and TokenShield traffic on the same bot identity and the same connection key.

## 3. Can an Edge Function call the gateway with `LOVABLE_API_KEY`?

Yes, and that is the pattern this repository already uses. Evidence from HEAD:

- `supabase/functions/ai-insight/index.ts:247` — `Deno.env.get("LOVABLE_API_KEY")`
- `supabase/functions/analyze-contract/index.ts:131,258` — reads the key, sends `Authorization: Bearer ${LOVABLE_API_KEY}`
- `supabase/functions/rewrite-contract-clause/index.ts:81,166` — same shape
- `supabase/functions/generate-resource-article-draft/index.ts:142`

Those call the AI gateway, but the auth mechanism (managed `LOVABLE_API_KEY` read from `Deno.env` inside an Edge Function, never client-side) is identical to the connector gateway. The only addition for Telegram is the second header `X-Connection-Api-Key: ${TELEGRAM_API_KEY}`, which exists only after the connection is linked to this project.

## 4. Edge Function conventions safest to reuse

- `supabase/functions/ai-insight/index.ts` — canonical outbound-gateway function: `serve()` from `deno.land/std@0.190.0/http/server.ts`, explicit `corsHeaders`, tagged `log()` helper, `npm:@supabase/supabase-js@2.57.2` client.
- `supabase/functions/stripe-webhook/index.ts` + `supabase/functions/_shared/stripe-webhook-idempotency.ts` — the established idempotency contract: runtime-neutral orchestration module with a `LedgerClient` interface (`claim` / `complete` / `fail`) over three SECURITY DEFINER RPCs, so the Edge Function and Vitest drive the same code path. TG-2D's ingest ledger should mirror this exactly rather than invent a second style.
- `supabase/functions/generate-recurring-expenses/index.ts` — the existing cron-triggered, no-user-JWT function shape, which is what a poller is.
- `supabase/config.toml` — every function declares `verify_jwt`; a cron/service-invoked poller needs an explicit entry.
- `pg_cron` and `pg_net` are both installed live, so scheduled invocation needs no new infrastructure.

## 5. Minimum persistence model for polling correctness

Two concerns, deliberately separate:

**A. Poll cursor (progress).** One single-row-per-bot table, e.g. `telegram_poll_cursor(bot_scope text PRIMARY KEY, last_confirmed_update_id bigint NOT NULL DEFAULT 0, updated_at timestamptz)`. The poller reads it, calls `getUpdates(offset = last_confirmed_update_id + 1)`, and advances it **only after** every update in the batch is durably recorded. Advancing early loses updates; never advancing double-processes forever. The cursor row must be taken `FOR UPDATE` (or claimed via a lease column) so two overlapping cron ticks cannot both poll — Telegram invalidates the previous `getUpdates` for the same bot when a new one arrives with a higher offset, so concurrent pollers are a correctness bug, not just waste.

**B. Update ledger (replay protection).** `telegram_update_receipts(update_id bigint PRIMARY KEY, received_at, status, processed_at, error_code, raw jsonb)`. Insert-on-conflict-do-nothing keyed on `update_id` is the real enforcement; a zero-row insert means "already seen, skip". This is the webhook-door ledger discussed in TG-2A: it fires *before* any authorization, so it is not the same thing as `dispatch_command_receipts` (command-level, post-authorization) and must not be folded into it.

RPC surface, all SECURITY DEFINER with pinned `search_path`, `REVOKE` from PUBLIC/anon/authenticated, `GRANT EXECUTE` to `service_role` only, tables with zero client policies and zero client grants:

- `telegram_claim_poll_cursor(_scope text)` → current offset, with lease/lock
- `telegram_record_update(_update_id bigint, _raw jsonb)` → boolean `is_new`
- `telegram_complete_update(_update_id bigint, _status text, _error_code text)`
- `telegram_advance_poll_cursor(_scope text, _last_update_id bigint)` → monotonic, never decreases

Nothing is created in this phase.

## 6. Minimum supported update types for TG-2D

Only `message`. Request `allowed_updates: ["message"]` on `getUpdates`.

Within `message`, TG-2D handles exactly one command: `/start <64-hex-token>` in a **private** chat, routed to TG-2B `consume_telegram_link_token` (service-role, once TG-2B is live), replying success/failure via `sendMessage`. Every other message — group/supergroup messages, non-`/start` text, edited messages, callback queries, media — is recorded in the ledger, marked `ignored`, and dropped.

Explicitly out of scope for TG-2D: creating loads, updating load status, binding chats, and any call into the TG-2C wrappers. No `edited_message`, no `callback_query`, so no `answerCallbackQuery` yet.

## 7. Recommended smallest TG-2D allowlist (candidate-only)

Blocking prerequisites before any of this can run live, both outside TG-2D: (a) TG-2B must be applied live, since `/start` linking calls its RPC; (b) a Telegram connection must be linked to this project.

Files to add — candidate/no-deploy:

1. `supabase/migration-candidates/<ts>_phase_tg2d_telegram_update_ingest_ledger.sql` — the two tables and four RPCs from section 5. Staged only, not applied.
2. `supabase/functions/_shared/telegram-poll-ingest.ts` — runtime-neutral orchestration (cursor claim → `getUpdates` → record each update → classify → advance), modeled on `stripe-webhook-idempotency.ts`, with injected gateway and ledger interfaces so tests exercise the real path. No Deno globals.
3. `supabase/functions/telegram-poll/index.ts` — thin Deno shell: reads `LOVABLE_API_KEY` + `TELEGRAM_API_KEY`, fails closed if either is absent, calls the shared orchestrator. Written but not deployed.
4. `src/test/phaseTG2DTelegramUpdateIngest.test.ts` — SQL contract assertions (service-role-only grants, zero client policies, pinned `search_path`, monotonic cursor) plus orchestration tests: cold start offset, duplicate `update_id` skipped, cursor does not advance past an unrecorded update, non-`/start` ignored, group message ignored, gateway `ok:false` surfaced, no bot token or secret in source.

Not in the allowlist: `supabase/config.toml`, any live SQL, any deployment, any connector link, any secret, any publish, and any TG-1/TG-2B/TG-2C file.

## Stop

Read-only report complete. Awaiting the TG-2D execution contract, plus a ruling on the connection-ownership question in section 2.
