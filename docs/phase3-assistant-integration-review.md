# Phase 3B Assistant Integration — Review Evidence and Release Packet

Status: UNPUBLISHED SOURCE + PREVIEW UI CHECKPOINT. No SQL applied, no function deployed, no AI enabled, no model requests, no real accounts/history touched, no billing/secret/config/package changes. Not a Phase 3 production PASS.

Start: `4630d1ec195b1cca5e9d7771291d7136d2c92061` (clean). Platform commits the result.

## 1. What exists vs what runs

| Piece | Source state | Preview/runtime |
|---|---|---|
| `/ai-assistant` page + `AiAssistantProvider` | Built | Renders; backend call fails, so it shows "AI assistant is not enabled in this environment yet", Send disabled, Find Work + Conversations links kept |
| Sidebar + mobile More "AI assistant" (driver, recruiter) | Built | `href` items, so the acting-assistant nav filter still hides them; DA-1 allowlist unchanged |
| `/assistant` human helper + `/agency` header links | Built | Link only; the AI route has its own server scope gate |
| SQL candidate extension | Built, local tests | NOT applied; no live schema |
| `supabase/function-candidates/assistant-chat` | Built, handler tested | NOT under `supabase/functions`, never deployed |

## 2. Server-side rules (candidate SQL)

- Session freshness (`_assistant_session_valid`): `auth.uid()` + `auth.jwt()->>'session_id'` must match an `auth.sessions` row for that user with `not_after` null or future. Missing/malformed/mismatched/deleted/expired fails closed. No writes, no client grant on `auth.sessions`. Applied inside `assistant_scope_authorized` (so RLS reads, create, append, context, reserve) and in delete/clear (which need a valid session but no paid/scope permission).
- Context discovery `assistant_list_contexts(limit≤50, offset)` with `has_more`: actor-owned driver self, active direct/agency delegations, owned/active-member recruiter and agency workspaces. Per context each domain is checked individually, then the combined set is revalidated (one relationship must carry all; no union). Labels: `profiles.display_name` only after authorization, `recruiter_profiles.company_name`, `agency_profiles.name`.
- `assistant_start_thread` derives permissions server-side. Thread scope, actor, 720h expiry remain immutable.
- Read-only projections `assistant_thread_context` (own live thread, explicit target predicate on every query):
  - Driver: newest 20 loads `id,load_date,status,payment_status,estimated_pay,actual_pay_received` if thread has manage_loads OR view_dashboard OR view_reports; newest 20 expenses `id,expense_date,category,amount,expense_type` if manage_expenses OR view_dashboard OR view_reports. Notes/broker/reference/location never selected. No totals.
  - Recruiter: newest 20 opportunities `id,title,status,route_type,updated_at` (opportunities_view); application counts by status (applications_view); human conversation counts by status (conversations_view). No driver identity, contact, snapshot or message bodies; no reply capability.
  - Agency: newest 20 packages `id,name,price_display_text,billing_frequency_display_text,is_active` (packages_view); work-item counts (work_items_view_all); client-request counts (client_requests_view).
  - Envelope: `as_of`, `limit`, `has_more`, "most recent" labelling.
- Usage ledger `assistant_usage` (bodyless): actor → profiles(user_id) CASCADE, thread → SET NULL, request UUID, session UUID (no auth FK), server timestamps, pending/completed/failed, random lease, 60s lease deadline. No client grants/policies; trigger forces server timestamps/lease and immutability.
- `assistant_reserve_turn`: per-actor `pg_advisory_xact_lock`, then idempotency (same actor+request: same thread/body → pending/completed/failed state, never a second reservation; changed body/context or deleted thread → 22023), then limits, then create-if-needed + append via existing authorizer, then reserve. All atomic.
- Candidate protective limits (NOT pricing/plan changes): 20 admitted attempts/actor/rolling 24h, 5/rolling minute, 1 live pending lease. Failed provider attempts count. Clearing history does not reset counts.
- `assistant_finalize_turn` (service_role only): reservation + lease required; derives actor/session/thread from the ledger; sets `request.jwt.claim.sub` and `request.jwt.claims` transaction-locally, rechecks session + thread + full scope, restores both on success and exception. Duplicate completion returns `already_*`; expired lease, deleted thread, revoked access → failed, no reply written. Source keys must be in the fixed registry and allowed by the thread's domains.
- `assistant_purge_expired` (service only) also deletes usage rows older than 24h. No scheduler configured.
- Pagination: `assistant_list_threads` / `assistant_list_messages` are SECURITY INVOKER (RLS applies) with explicit `actor_user_id=auth.uid()`; keyset cursors, ≤50/page, `limit+1` for has-more.

Retention: transcripts 30 days fixed from creation (or sooner by user deletion). Usage metadata: rolling 24h, bodyless, kept through transcript deletion, removed with the account.

## 3. Handler (`handler.ts`, runtime-neutral)

Actions: bootstrap, threads, messages, send, delete, clear (`confirm: true`). Strict field validation, 16KB body cap, Bearer token verified by `auth.getUser` only. User-token client for every RPC; service client used only for `assistant_finalize_turn`. Errors are generic (401/403/409/413/429/503); no SQL/provider text returned; logs carry event names and status codes only.

Send order: verify token → enabled flag → reserve (session + scope + idempotency + budget + append) → bounded context + ≤10/6000-char history → `assistant_thread_live` + identity recheck → exactly one model call (`google/gemini-3-flash-preview`, `max_tokens` 768, non-streamed, 30s abort) → service finalize with rechecks → read stored reply back through the user's RLS. Provider status/JSON/content size validated; no retry, no fallback. Prompt keeps rules in system and wraps data/history/user text in `<untrusted_*>` blocks. Source cards come from a fixed registry of existing routes.

`ASSISTANT_CHAT_ENABLED` defaults off (also off when `LOVABLE_API_KEY` is absent). When off, history/delete/clear still work; send returns 503 `disabled` before any reservation.

## 4. Evidence (this checkpoint)

| Suite | Result |
|---|---|
| phase3AssistantHistoryPostgres (original 133 + 6 session invariants) | 139/139 |
| phase3AssistantIntegration (actual handler + actual SQL, stubbed auth/model only) | 42/42 |
| aiAssistantUi (actual provider/page/Router) | 13/13 |
| workConversationContinuity | 22/22 |
| authenticatedWorkChat | 68/68 |
| conversationNavigation, phase1jC2NavDiscoverability, phaseDA1 hardening + surface, pageNavSafety | 56, 13, 10, 36, 12 — all pass |
| recruiterAssistantCapabilityDashboards | 1 failure, PRE-EXISTING: asserts text "Go to my Dashboard" absent from AssistantDashboard at the start commit too; not changed |

Negative controls (in-memory candidate edits only, files unchanged), run over history + integration (181 tests): session guard removed → 8 failed; daily budget raised → 1 failed; finalize lease check removed → 1 failed; actor filter removed → 3 failed; scope check removed → 20 failed.

`git diff --check` clean; automatic build OK. No manual build/typecheck.

## 5. Not verified / limits

- PGlite is one serial connection: advisory-lock serialization and lease races are NOT proven concurrently. Hosted Postgres concurrency test remains a release gate.
- Timeout is tested as an immediate abort, not a real 30s wait.
- Hosted parity of `auth.sessions` / `auth.jwt()` behaviour, PostgREST claim shape, and Owner QA fixture-isolation filters on operational tables are not exercised.
- Deno adapter (`index.ts`) is not executed; only the handler is.
- Provider retention/training terms unconfirmed. No zero-retention claim.
- No real-browser/mobile visual QA in this run.

## 6. Activation packet (DO NOT run without separate authorization)

1. Apply `supabase/migration-candidates/20261026165204_phase3_assistant_history_foundation.sql` byte-for-byte as one migration.
2. Read-only checks: functions/ACLs (`assistant_finalize_turn`, `assistant_purge_expired`, `_assistant_*` service-only), RLS on `assistant_threads/messages/usage`, no anon/authenticated grant on `assistant_usage`, no client grant on `auth.sessions`.
3. Move `supabase/function-candidates/assistant-chat/` to `supabase/functions/assistant-chat/` and deploy. Config names: existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`; new `ASSISTANT_CHAT_ENABLED` (leave unset/false first).
4. With generation off: verify bootstrap per role family, history, delete, clear on test accounts.
5. Scheduler: service call to `public.assistant_purge_expired()` (e.g. hourly). Not configured.
6. Hosted concurrency test on reserve/finalize; provider terms review; then set `ASSISTANT_CHAT_ENABLED=true`.
