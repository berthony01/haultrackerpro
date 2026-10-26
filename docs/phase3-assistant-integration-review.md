# Phase 3B Assistant Integration: Review Evidence and Release Packet

Status: UNPUBLISHED SOURCE + PREVIEW UI CHECKPOINT. No SQL applied, no function deployed, no AI enabled, no model requests, no real accounts/history touched, no billing/secret/config/package changes. Not a Phase 3 production PASS.

Start: `4630d1ec195b1cca5e9d7771291d7136d2c92061` (clean). Independent-review corrections start: `1041da33f7cece1ed7fa17c16a3672256416a190` (clean). Platform commits the result.

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
  - Loads/expenses rank rows once by (date, created_at, id) descending, keep ranks 1 to 20, and strip `created_at`/rank from the output (previously inner and outer orderings differed and could drop the wrong row).
- Usage ledger `assistant_usage` (bodyless): actor, then profiles(user_id) CASCADE, thread, then SET NULL, request UUID, session UUID (no auth FK), server timestamps, pending/completed/failed, random lease, 60s lease deadline. No client grants/policies; trigger forces server timestamps/lease and immutability.
- `assistant_reserve_turn`: per-actor `pg_advisory_xact_lock`, then idempotency, then limits, then create-if-needed + append via existing authorizer, then reserve. All atomic.
  - Idempotency survives the 24h ledger purge: the retained 30-day transcript is searched for an actor-owned user message with the same request UUID across all of the actor's threads (covers new-thread retries without a thread id). Exact body, thread or scope/target and current authorization (`assistant_thread_live`) are required. Ledger present: pending returns pending, completed returns the stored reply id, failed stays failed. Ledger purged: matching assistant reply returns completed with zero model calls; no reply returns failed. A retained request is never re-admitted. Changed body/context, more than one match, or deleted thread: 22023. Expired or revoked thread: 42501, never revived.
  - Expired pending lease (checked with `clock_timestamp()`) is moved to failed on replay; no new model call; a new request id is required.
- Candidate protective limits (NOT pricing/plan changes): 20 admitted attempts/actor/rolling 24h, 5/rolling minute, 1 live pending lease. Failed provider attempts count. Clearing history does not reset counts.
- Lock order: every path that touches a thread takes the thread row lock BEFORE the usage row and before message inserts, matching `DELETE thread` (thread, then cascade messages, then SET NULL usage). Reserve reads immutable pointers unlocked, locks the thread, then the ledger row, and revalidates the pointer. Finalize reads `thread_id` unlocked, locks the thread, then the ledger row; a deleted/changed pointer fails without resurrection. New-turn append (`assistant_add_user_message`) locks the thread before the usage insert. Purge deletes threads before usage rows.
- `assistant_get_reply(thread, message)`: SECURITY INVOKER exact lookup (RLS plus explicit actor, thread, id and assistant role). Replaces the newest-51 scan used to read back replies.
- `assistant_finalize_turn` (service_role only): reservation + lease required; lease rechecked with `clock_timestamp()` after locks; session/scope recheck runs immediately before the INSERT; derives actor/session/thread from the ledger; sets `request.jwt.claim.sub` and `request.jwt.claims` transaction-locally, rechecks session + thread + full scope, restores both on success and exception. Duplicate completion returns `already_*`; expired lease, deleted thread, revoked access, then failed, no reply written. Source keys must be in the fixed registry and allowed by the thread's domains.
- `assistant_purge_expired` (service only) also deletes usage rows older than 24h. No scheduler configured.
- Pagination: `assistant_list_threads` / `assistant_list_messages` are SECURITY INVOKER (RLS applies) with explicit `actor_user_id=auth.uid()`; keyset cursors, ≤50/page, `limit+1` for has-more.

Retention: transcripts 30 days fixed from creation (or sooner by user deletion). Usage metadata: rolling 24h, bodyless, kept through transcript deletion, removed with the account.

## 3. Handler (`handler.ts`, runtime-neutral)

Actions: bootstrap (`offset`), threads (`cursor`), messages (`threadId`, `cursor`), send (`requestId`, `content`, and exactly one of `threadId` or `scope`+`targetId`), delete (`threadId`), clear (`confirm: true`). Exact per-action key allowlist and types; unknown keys (for example `actor`, `isPro`), arrays, extra cursor keys and conflicting thread+scope are 400. Bootstrap `offset` is an integer 0 to 10000. Bearer token verified by `auth.getUser` only.

- Request body is read as a stream bounded at 16000 UTF-8 bytes; the reader is cancelled as soon as the bound is exceeded (413). Invalid UTF-8 or non-object JSON is 400. The provider response is read as a stream bounded at 200000 bytes and cancelled/aborted on overflow; no unbounded `.text()`.
- Outer exception boundary: thrown token verification, user RPC, service finalize or read failures return generic 503 `unavailable`. Admitted turns make a best-effort failure finalization; a throwing cleanup never escapes. No raw exception, provider body, token or prompt is returned.
- Model context text, including the `as_of` envelope, newlines and omission markers, is at most 10000 characters. Sections are whole or omitted; an omission marker is added only if it fits.
- History excludes only the just-appended user message, by the `user_message_id` returned from reserve.
- Bootstrap returns `contextsTruncated` and `nextOffset` (50 per page). User-token client for every RPC; service client used only for `assistant_finalize_turn`. Errors are generic (401/403/409/413/429/503); no SQL/provider text returned; logs carry event names and status codes only.

Send order: verify token, enabled flag, reserve (session + scope + idempotency + budget + append), then bounded context + ≤10/6000-char history, then `assistant_thread_live` + identity recheck, then exactly one model call (`google/gemini-3-flash-preview`, `max_tokens` 768, non-streamed, 30s abort), then service finalize with rechecks, then read stored reply back through the user's RLS. Provider status/JSON/content size validated; no retry, no fallback. Prompt keeps rules in system and wraps data/history/user text in `<untrusted_*>` blocks. Source cards come from a fixed registry of existing routes.

`index.ts` CORS allows the same headers as the existing `ai-insight` endpoint (authorization, x-client-info, apikey, content-type, x-supabase-client-platform, -platform-version, -runtime, -runtime-version) plus methods POST, OPTIONS. Not executed in Deno here.

`ASSISTANT_CHAT_ENABLED` defaults off (also off when `LOVABLE_API_KEY` is absent). When off, history/delete/clear still work; send returns 503 `disabled` before any reservation.

## 4. Evidence (corrections checkpoint)

Provider/UI corrections:
- Identity is user id + JWT `session_id` (decoded only as a validated cache-isolation hint, never authorization) + pinned target. Missing/malformed session id fails closed. A token refresh in the same session keeps state; a different session resets all epochs and state and drops delayed responses.
- `isActingAsAssistant` is read: acting with an unresolved target, or while managed drivers load, fails closed with no personal fallback.
- Draft clears on explicit context switch, New conversation and opening another thread; it survives route navigation in the same view. View changes clear `messagesLoading`.
- Delete/clear reset sending, draft, notices and view flags and invalidate late completions and in-flight history loads. Deleting a thread that is no longer open does not touch the current conversation. Failures (including `deleted: false`) show a safe notice; success is never reported.
- Request ids: `crypto.randomUUID`, else an RFC 4122 v4 id from `crypto.getRandomValues`; with neither, Send fails closed with no request.
- Load older keeps the reader's viewport; new messages, replies and the thinking line still scroll to the bottom. Concurrent older fetches are guarded.
- Workspace pagination: "Load more workspaces" appends pages and hides when complete. While acting, each operation searches at most 20 pages (up to 1000 workspaces) sequentially for the exact managed target. If more remain, the provider retains the continuation offset and shows an incomplete-search state with explicit "Continue searching"; each continuation has the same 20-page bound. A failed page retains its offset for explicit retry. Only exhausted discovery may show "not available for this driver". Personal/other-driver contexts never become a fallback, and identity epochs discard delayed continuation results.
- Clear history is available to an identity-ready authenticated actor when the backend is ready, even with no eligible contexts or visible history after paid/scope loss. The existing explicit all-account confirmation and server valid-session/actor boundary remain; generation stays disabled when unavailable or off.

| Suite | Result |
|---|---|
| phase3AssistantHistoryPostgres (original 133 + 6 session invariants) | 139/139 |
| phase3AssistantIntegration (previous 42 + 28 review regressions) | 70/70 |
| aiAssistantUi (previous 13 + 13 review regressions) | 26/26 |
| workConversationContinuity | 22/22 |
| authenticatedWorkChat | 68/68 |
| recruiterAssistantCapabilityDashboards | 1 failure, PRE-EXISTING ("Go to my Dashboard" text assertion); not changed |

The architect's five adversarial reproductions are now regression cases: purge-then-replay (model calls stay 1), replay after 60 later messages (200, same reply), expired lease (503 failed, model 0), 100 x 2000-byte streamed body (413, at most 12 pulls, reader cancelled), throwing `verifyToken` (generic 503, model 0). Navigation suites were not rerun because no navigation files changed in this correction.

Negative controls (in-memory candidate edits only, files unchanged), over history + integration (209 tests): session guard removed: 9 failed; daily budget raised: 1 failed; finalize lease check removed: 1 failed; actor filter removed: 3 failed; scope check removed: 21 failed.

`git diff --check` clean; automatic build. No manual build/typecheck.

### Final bounded repair (builder and independent evidence separated)

- Authorized repair start: `38f735bf26b56047597e76e691b524bc3dbaf176`, exact HEAD verified with a clean working tree. Prior run completion (`agentFinished=true`) was confirmed by the architect, not rediscovered or rerun here.
- Independent architect evidence at `1d4c503f0aa9b2ef7d46660a3a6fa6d86faa9f31`: history 139 + actual handler/SQL integration 70 + actual provider/page UI 26 = **235/235**; five separate backend adversarial checks + four separate UI regressions = **9/9**. Independent in-memory actor/scope/session/budget/complete controls each failed their intended test with final bytes unchanged. These are architect-reported results, not builder runs in this repair.
- Independent architect evidence at partial `38f735bf`: existing UI **26/26** plus three temporary external provider/page continuation cases **3/3**. The separate no-context/no-history Clear regression failed there; this repair removes that UI obstruction without changing SQL or privileges.
- Persisted four meaningful actual provider/page cases: page-21 target reached only by explicit continuation after 20 requests; failed continuation retries the same offset and remains incomplete; identity change drops the old continuation and prevents late history loading; empty eligible contexts/history with generation off still permits explicit own clear without send/delete-message activity.
- Builder changes: `src/pages/AiAssistant.tsx`, `src/test/aiAssistantUi.test.tsx`, `supabase/function-candidates/assistant-chat/handler.ts`, and this review document. `src/hooks/useAiAssistant.tsx` was inspected but unchanged: its independently verified continuation implementation was reused. Handler changes are exactly the two type-equivalent `'reason' in raw` checks; streaming limits/cancellation/errors are unchanged. Secure RNG fallback uses the bound real `getRandomValues` signature, with randomUUID absent and all 50-unique-ID/fail-closed assertions retained.
- Builder first targeted run: **188 passed / 2 failed** because two new tests awaited initial discovery inside `act`, preventing the initial asynchronous render from settling. Moving discovery before the click's `act` fixed test scheduling without changing production continuation logic or weakening assertions.
- Builder final command: `bunx vitest run src/test/aiAssistantUi.test.tsx src/test/workConversationContinuity.test.tsx src/test/authenticatedWorkChat.test.tsx src/test/phase3AssistantIntegration.test.ts` — **190/190**, four suites passed (UI **30**, continuity **22**, authenticated work chat **68**, handler/SQL integration **70**). Run started **2026-10-26 21:12:53 UTC**, duration **23.96s**. Original 139 history tests/canonical helpers/SQL unchanged and not rerun; navigation unchanged and not rerun. Known pre-existing recruiterAssistantCapabilityDashboards stale-label failure remains untouched and was not rerun.
- Automatic build evidence: prior **2026-10-26T21:11:31Z** failed on the RNG signature and two bounded-read union checks. Fresh source-fix builds **2026-10-26T21:12:03Z** and newest inspected **2026-10-26T21:12:47Z** both report **build OK**. No manual build/typecheck. Result SHA and final repository status are reported separately after the platform checkpoint; no manually created commit.
- Cost: only the four targeted local suites were rerun (two attempts); no model requests, service activation, package installation or hosted checks. Exact Lovable credit charge was not measured, so no numerical cost claim is made.
- Source + preview checkpoint only, not production PASS. No SQL application, deployment, publication, generation enablement, secrets/billing/config changes or real-account/history activity. Browser/runtime QA remains for independent review.

## 5. Not verified / limits

- PGlite is one serial connection: advisory-lock serialization, the thread-before-usage lock order (reserve/finalize/delete/purge), and lease races are NOT proven concurrently. A hosted Postgres concurrency test (concurrent delete vs finalize, delete vs reserve, purge vs finalize) remains a release gate.
- Timeout is tested as an immediate abort, not a real 30s wait.
- Hosted parity of `auth.sessions` / `auth.jwt()` behaviour, PostgREST claim shape, and Owner QA fixture-isolation filters on operational tables are not exercised.
- Deno adapter (`index.ts`) is not executed; only the handler is.
- Provider retention/training terms unconfirmed. No zero-retention claim.
- UNVERIFIED RELEASE GATE, AI app context logging: the official Lovable AI documentation (https://docs.lovable.dev/features/ai, checked by the architect on 2026-10-26) states that when AI app context logging is enabled, full requests and responses can be stored for 90 days (default on for Free/Pro, off for Business/Enterprise), separately from this feature's 30-day app history, and summary logging always occurs. This project's actual plan and setting were NOT inspected. Before enabling, inspect the actual setting and terms and choose an approved privacy configuration. Do not promise 30-day provider retention or no training. No setting was changed.
- Deno adapter and CORS preflight, hosted session/JWT claim parity and Owner QA operational fixture isolation remain unverified. Browser QA is handled independently by the architect.
- No real-browser/mobile visual QA in this run.

## 6. Activation packet (DO NOT run without separate authorization)

1. Only after independent review and explicit approval of the final reviewed candidate, promote it as one migration.
2. Read-only checks: functions/ACLs (`assistant_finalize_turn`, `assistant_purge_expired` service-only; check internal helpers individually, not a blanket `_assistant_*` service-only claim). Exact intentional exception: `_assistant_session_valid()` grants EXECUTE to authenticated + service_role and returns only the caller's own current-session boolean; it does not expose session rows or grant client access to `auth.sessions`. Preserve these ACLs. Verify RLS on `assistant_threads/messages/usage`, no anon/authenticated grant on `assistant_usage`, no client grant on `auth.sessions`.
3. Move `supabase/function-candidates/assistant-chat/` to `supabase/functions/assistant-chat/` and deploy. Config names: existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`; new `ASSISTANT_CHAT_ENABLED` (leave unset/false first).
4. With generation off: verify bootstrap per role family, history, delete, clear on test accounts.
5. Scheduler: service call to `public.assistant_purge_expired()` (e.g. hourly). Not configured.
6. Hosted concurrency test on reserve/finalize/delete/purge; Deno CORS preflight check; AI app context logging setting and provider terms reviewed and an approved configuration chosen; then, with separate authorization, set `ASSISTANT_CHAT_ENABLED=true`.
