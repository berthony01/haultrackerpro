# Phase 3A: source-only assistant history foundation audit

## Status and execution boundary

SOURCE CANDIDATE ONLY, NOT DEPLOYED OR ACTIVATED. This checkpoint stages private history DDL and local PostgreSQL-WASM role/RLS evidence. It is not Phase 3 completion, a generalized AI assistant, durable history in the current app, or production acceptance.

Authoritative synchronized starting HEAD: `c8ca8aeec53acd1b378653f19493ddeb12fe284a`, clean. No concurrent test/agent process was observed at the start gate. Platform-managed commits record the resulting checkpoint; no stateful Git command was used.

Exactly five allowed files:

1. `supabase/migration-candidates/20261026165204_phase3_assistant_history_foundation.sql`
2. `src/test/fixtures/phase3AssistantCanonical.sql`
3. `src/test/phase3AssistantHistoryPostgres.test.ts`
4. `docs/phase3-assistant-history-audit.md`
5. `docs/phase3-assistant-foundation.md`

All runtime source, existing migrations/tests, generated types, functions, packages, configs, workflows and plans remain unchanged. No hosted access, production data mutation, real accounts/messages, browser, model call, Edge Function, Stripe, secret, deployment or publication activity occurred.

The first CLI gate stopped with zero project edits. The architect then authorized only a temporary pinned `supabase@2.122.0` install under `/tmp/phase3-cli`, with npm cache outside the repo. Version, main help and migration-new help were inspected. Telemetry was disabled using `telemetry disable` with an isolated temporary HOME. `migration new phase3_assistant_history_foundation --workdir /tmp/phase3-work` generated the exact filename above. Only its basename/empty file was copied into the candidate directory. No file was generated under this project's `supabase/migrations`; no login/link/cloud command was used. A second zero-edit ownership gate was resolved by the explicitly approved profile cascade, not by referencing managed auth in the candidate.

## Findings: evidence versus inference

The following live findings were supplied by ChatGPT's prior independent read-only catalog/function audit; this implementation did not repeat hosted inspection and does not establish deployed-source parity:

- `ai_insights` stores specialized insights, not general AI transcripts. Human `conversation_threads/messages` require driver/recruiter relationships, with `driver_user_id` and `recruiter_id` required and `sender_actor_type` constrained to driver/recruiter. The human authorization helper includes an admin view shortcut. They must not be repurposed for actor-private AI history.
- Source `src/lib/mcp` has `list_loads`, `list_expenses`, `profit_summary` and user-token `supabaseForUser`, but no explicit user-target filter. Live SELECT policies legitimately allow delegated rows for multiple drivers. Mixed-authorized-account results are therefore a code+policy inference, not an observed exploit. Existing MCP is not wired or changed here.
- `ai-insight` takes specialized caller-supplied context. Its status/admin Pro gate differs from canonical `driver_has_active_pro` (valid active plan and Owner QA behavior). `check-pro-access` allows unknown feature keys by default. Neither is this candidate's authorizer; existing gateways are unchanged.
- Live canonical capability, driver Pro, recruiter permissions/readiness/tier, assistant delegation, agency permissions/operational authority and effective-limit helpers exist. `driver_has_active_pro` and `effective_recruiter_tier` lack authenticated EXECUTE. The candidate calls them internally without widening their grants.
- Direct `assistant_has_permission` allows target-driver Pro or an approved operational agency delegation. Agency operations allow `manual_beta` and `past_due`; this new paid-AI feature adds strict actual-row known-plan/source and active/trialing checks without reducing existing operational access.
- Canonical business tier includes agency-owner recruiter premium and fails closed on dual-paid conflict. Recruiter staff seats derive from standalone billing only; agency inclusion does not manufacture staff seats. These behaviors are preserved by calling real helpers.
- `profiles_user_id_key` is UNIQUE(user_id); `profiles_user_id_fkey` cascades from auth deletion. Users have own SELECT/INSERT/UPDATE policies, no DELETE policy. Existing `finalize_my_account_data_deletion()` deletes the own profile within its authenticated cleanup transaction (architect-inspected line 108), then the edge adapter deletes auth last. The candidate cascades history at profile deletion, with auth deletion independently cascading through the profile. Missing profile creation fails closed; replacement begins empty. This is a claim only about new history, not unrelated retained records. No deletion/auth code changed; the entire deletion adapter was not executed in this run.
- Deployed Edge Function retrieval previously returned `INVALID_ARGUMENT`; do not infer source/deployed parity. Provider retention/training terms were not verified. Changelog retrieval had unsupported content type; no SDK change was required.

Repository helper bodies used for local tests match the authoritative accepted source paths listed in the suite. No discrepancy with the supplied live findings was found, but byte-for-byte live helper parity was not independently fetched in this run.

## Approved decisions and schema

- Future general AI is included in all existing paid Driver Pro, Recruiter and Agency plans, within existing role/data permissions. No new prices, products or permission enum values.
- History expires at creation plus exactly `720 hours` (2,592,000 seconds), or the user deletes sooner. Appending messages never extends expiry.
- Two new tables on the same existing backend: `assistant_threads` and `assistant_messages`. No external database or parallel ownership system.
- Threads: server UUID, `actor_user_id` FK to `public.profiles(user_id)` cascading, fixed scope kind/target/read domains, server timestamps, immutable creation context. Trigger validates nonempty/null-free/unique/known permissions and fixes creation/expiry even on privileged insertion. Actor/created and expiry indexes.
- Messages: server UUID, thread cascade FK, role user/assistant, trimmed nonempty content up to 8000 characters, request UUID, server default creation time, unique(thread,role,request), thread/created/id index. All bodies are untrusted, never authority.
- Both tables revoke PUBLIC/anon/authenticated privileges before explicit authenticated SELECT and service_role grants; RLS restricts SELECT to own actor, unexpired thread and current authority. Parent RLS gates message visibility. No authenticated INSERT/UPDATE/DELETE, no admin bypass or teammate sharing. A later DB read hides revoked history; already delivered content cannot be remotely revoked.

## Scope and role matrix

All identity derives from `auth.uid()`; no actor, client role, metadata or `isPro` parameters.

| Scope | Exact target | Required current authority | Allowed required domains |
|---|---|---|---|
| driver_self | actor's user UUID | active driver capability + canonical driver Pro; canonical self admin/Owner QA entitlement only, no extra data grant | manage_loads, manage_expenses, view_reports, view_dashboard |
| driver_delegate | different driver user UUID | active target driver capability; exact active driver_assistants actor/target relationship carrying every domain; every canonical assistant permission | same driver read domains |
| recruiter | recruiter_profiles.id | OWNER active recruiter capability + canonical readiness + tier starter/growth/fleet; each current recruiter permission, including staff membership/seat checks | opportunities_view, applications_view, conversations_view |
| agency | agency_profiles.id | canonical active profile/member/seat operational authority + actual known paid plan, recognized source, active/trialing entitlement; each current agency permission | packages_view, client_requests_view, work_items_view_all |

Direct driver delegation requires target canonical Pro; assistant's own Pro is irrelevant. Agency delegation additionally joins the exact approved request for actor/driver/agency and requires all requested domains, operational membership authority, actual agency_starter/team/growth, source stripe/manual/admin_seed, status active/trialing. Member-only, wrong pair/agency, unapproved, revoked, malformed permissions, manual_beta/past_due/cancelled and unknown plan/source deny the new feature. Agency paid delegation can serve a free driver. Recruiter free/setup/suspended/revoked/conflict/foreign fail closed; Driver Pro never substitutes recruiter paid tier. Canonical agency-owner recruiter inclusion is allowed, staff seats are not invented. Each transcript is actor-private even among authorized teammates.

## RPC and future tool boundary

- `assistant_scope_authorized(scope,target,permissions)`: narrow auth.uid-bound authority boolean; authenticated EXECUTE is needed by RLS, no arbitrary actor or data output. Pinned pg_catalog/public/auth search path. Fully qualified application tables. Internal canonical grants unchanged.
- `assistant_create_thread(scope,target,permissions)`: live authorization and canonical profile key-share check; only server creates actor/time/expiry. Returns id and expiry. Missing profile yields generic 42501 without provisioning.
- `assistant_add_user_message(thread,request,content)`: locks owned thread, checks expiry and full current scope, fixes role=user. Identical trimmed request/body returns existing id; different body rejects. Denied attempts leave no message.
- `assistant_delete_thread(thread)`: own actor only, independent of entitlement/expiry/revocation; foreign/missing both false; cascade messages.
- `assistant_clear_my_history()`: own threads across scopes, irrespective of access/expiry; returns own count only.
- `assistant_purge_expired()`: service_role-only EXECUTE, expired threads/messages only. No scheduler or cron is configured. Read invisibility is enforced without purge; physical deletion by the deadline is NOT established.
- All new functions revoke PUBLIC/anon EXECUTE before exact grants. No assistant-reply RPC, tools, orchestration or operational-record writes. Future privileged replies require server-signed insertion and reauthorization before spend; granting service table privileges is not implementation of that flow.

Future integration: one role-aware entry in the existing signed-in shell; free deterministic Find Work remains free/model-free; human Conversations remain distinct. Authorize server identity, target, scope, entitlement, budget and rate limits BEFORE every model spend. Every tool must have explicit target filters, minimal projections (not raw full rows) and full pagination. Financial math must reuse authoritative helpers without truncated totals. Treat user/retrieved text as injection-prone data. No messages, applications, listings, billing or Telegram writes. Model output never widens registry authority.

## Executed local evidence

Installed `node_modules/.bin/vitest`, installed `@electric-sql/pglite`; no app dependency changes. Tests apply the actual candidate SQL and exact extracted canonical helper definitions (including full Driver Pro/Owner QA, recruiter owner/staff/seat and agency/delegation chains). Only `auth.uid()` is adapted to the PostgREST-equivalent JWT-subject GUC. Test calls genuinely SET ROLE authenticated, anon or service_role and assert current_user. Local fixture setup, temporal simulation and lifecycle cascades use the bootstrap owner, not as proof of role authorization.

Fixture projections preserve every referenced column/type and relevant constraints/FKs; full current read permission vocabularies are represented. Unused operational columns, triggers, full backend stack and unrelated RLS are not replicated. Malformed agency plan/source tests first prove real CHECK rejection, then temporarily remove only that local CHECK to exercise defensive deny behavior and restore it. Expiry tests temporarily disable only the local thread timestamp trigger for elapsed-time fixture setup and re-enable it before role reads/append. No authorization GUC flags or unconditional entitlement mocks.

Initial new suite: 114 passed / 6 failed (120), all test-harness defects: Vitest flattened array parameter cases and an unprivileged role cleanup omitted grant revocation. Corrected within the new suite; no security checks weakened. Candidate then passed 120/120.

Negative controls in temporary in-memory SQL input only:

```text
PHASE3_NEGATIVE_CONTROL=actor node_modules/.bin/vitest run src/test/phase3AssistantHistoryPostgres.test.ts -t 'cross-actor SELECT zero even same recruiter workspace'
PHASE3_NEGATIVE_CONTROL=scope node_modules/.bin/vitest run src/test/phase3AssistantHistoryPostgres.test.ts -t 'permission loss hides old history at next database read'
```

Each: 1 failed / 119 skipped, exactly expected zero visible rows but got one. Candidate/test SHA256 checks remained identical before/after both controls. Neither source file was mutated. The real guard version passes corresponding tests in the final run.

Final focused command:

```text
node_modules/.bin/vitest run src/test/phase3AssistantHistoryPostgres.test.ts src/test/workConversationContinuity.test.tsx src/test/authenticatedWorkChat.test.tsx
```

Result: **210/210**, three suites: new SQL 120, unchanged continuity 22, unchanged authenticatedWorkChat 68. Coverage includes valid paid plans, missing/free/invalid plans, absent/anon identity, foreign actor/target, additive scope denial, all tested revoked/setup/suspended cases, exact delegation and staff domains, seats, owner inclusion/conflict, private cross-actor RLS, direct CRUD/forged assistant denial, internal ACL denial, exact expiry, idempotence/conflict, profile and auth cascade, user delete/clear after authority loss, service-only expired purge and no row leakage on rejected create/append.

Existing Router future and Select controlled/uncontrolled warnings remain in the unchanged UI suites. No manual build/typecheck was run; automatic platform build reported build OK after the harness typing correction. Final diff check and exact checkpoint/path report are supplied in the completion report.

## Release gates and limits

Scheduler with actual retention/deletion tests, privacy copy, provider retention/training terms, budgets/rate caps, privileged reply reauthorization, stale-session/response guards, explicit-target tool tests, complete pagination/math, live role/tenant QA and independent diff acceptance are required before storage activation. PGlite is genuine PostgreSQL role/RLS execution but not hosted Auth, PostgREST, concurrent sessions or network/runtime parity. Locking is exercised serially here, not a concurrent race proof. No model spend or operational-write claim is made. Current guided memory continuity/UI remains unchanged. Stop at the source candidate checkpoint.