# Phase 3 Assistant Foundation: Architecture Contract

Status: Section 1 is built. Phase 3A history is a SOURCE-ONLY SQL CANDIDATE with local role/RLS tests, not applied or active. Phase 3B (integration) adds, as UNPUBLISHED source: the `/ai-assistant` page and in-memory provider, sidebar/More/helper/agency header links, the extended SQL candidate (session freshness, context discovery, registered read-only projections, bodyless usage ledger, service-only finalization) and an undeployed `supabase/function-candidates/assistant-chat` handler. Nothing is applied, deployed or enabled; in preview the page shows "AI assistant is not enabled in this environment yet". The existing `/assistant` human-helper dashboard is unchanged. Independent-review corrections (retained-transcript idempotency, exact reply lookup, lock order, bounded streams, field allowlist, session-scoped cache isolation, workspace pagination) are source only. Evidence and release packet: `docs/phase3-assistant-integration-review.md`. Sections 2 to 6 below are superseded where that review is more specific. Tracking: issue #44.

## 1. Built now: same-tab driver conversation continuity

- `src/components/home/WorkConversationDraftProvider.tsx` is mounted once in `src/App.tsx`, inside `AuthProvider` and `ActingContextProvider`, wrapping the existing routes. Provider and route order and all route guards are unchanged.
- It holds ONE in-memory snapshot of the guided driver conversation (transcript, current step, Back history, unsent typed text, Start over state). It never writes to localStorage, sessionStorage, IndexedDB, the network or logs. A page refresh destroys it.
- Identity comes only from the existing `useAuth` and `useActingContext` state. The snapshot is readable and writable only when auth is resolved, `user.id === session.user.id`, the managed-driver context is resolved and the user is not acting for another driver (scope `personal-driver-self`). Any other state clears it synchronously during render and reads fail closed.
- Epoch boundary: every owner or validity transition, and every explicit clear, starts a new epoch. Each chat mount obtains one lease bound to the epoch current at mount. A lease from an earlier epoch is permanently rejected for read and write, even when the same owner becomes valid again (A to signed out to A, A to B to A, acting or managed-context loading to A, session mismatch to A, driver-gate clear). No auth tokens are compared; only user ids and the epoch counter.
- `DriverWorkConversation` attaches the adapter only inside the already-authorized `ProfileConversation`. A definitive invalid outer gate (signed out, capability error, no driver workspace, acting) clears the draft. The snapshot is tied to a fingerprint of the saved work-profile seed; a changed profile invalidates it.
- The public homepage chat receives no adapter and stays ephemeral. Without the provider every consumer stays ephemeral; there is no module-global fallback cache.
- Opening, typing or restoring never saves preferences, publishes a job search card, or calls AI. Review handoff (`pendingProfileHandoff`) is separate and unchanged.
- Known limit (unobserved revocation): the provider reads only auth and acting-context state, not driver capability. If driver capability is revoked and later restored while no chat is mounted, and no chat mounts in between, the provider never observes the revocation, so a draft retained before the revocation can be shown again after restoration on the next mount. If the chat mounts at any point while revoked, the wrapper renders unavailable, clears the draft and retires all leases. While revoked, the draft is never displayed and nothing is written. Closing this gap fully requires the provider to observe capability state, which is outside the current allowlist.

## 2. Future: one assistant entry in the signed-in shell (proposed)

- One entry point inside the authenticated shell. It is distinct from (a) the free deterministic driver Find Work workflow, which stays free and model-free, and (b) human Conversations (`/conversations`, recruiter and driver messaging).
- No model call is made from the free workflow.

## 3. Role matrix for any future assistant tool (proposed)

| Actor | Required authority before any read or spend |
|---|---|
| Driver self / owner-operator | Same canonical driver capability as today (`src/lib/workspaceAccess.ts`, `useViewMode`). Owner-operator is a driver, not a separate role. |
| Recruiter owner / staff | Canonical recruiter workspace and membership; view or reply grant for the specific workspace; data limited to own workspace. |
| Assistant / agency | Active driver-approved delegation for the target driver, the specific field/permission (`useActingContext` permissions, `src/lib/assistantPermissions.ts`, `src/lib/agencyWorkspacePermissions.ts`) and the managed driver's entitlement where applicable. |
| Admin | Not blanket authorization. Admin view mode never grants data access by itself. |

User-approved decision: a future general assistant is included in all existing paid plans (Driver Pro, paid Recruiter, paid Agency), always within the chosen role/target and existing data permissions. The source candidate uses canonical server capability, entitlement, membership, seat and delegation helpers, not client `isPro` or the existing specialized AI gateway. No general assistant is activated.

## 4. Future tool and safety rules (proposed)

- Every tool call is authorized server side (identity, target, permission, Pro) BEFORE any model spend.
- First tools are read-only, grounded projections over existing RLS-protected data. No arbitrary SQL. Caller-supplied context is never authority.
- Retrieved content and user text are untrusted (prompt injection). Tools cannot be selected or widened by model output beyond the authorized registry.
- Job search cards stay disabled (`job_search_feature_control` never activated) pending a separate activation decision.
- No messages, applications, payments or other writes from the assistant in the first phases.

## 5. Existing AI is not this assistant

`supabase/functions/ai-insight/index.ts` runs specialized tasks (`type` plus caller-supplied `context`, cached by context hash, see lines ~349-482; delegation checks in `ai-insight/delegation.ts`). It accepts caller context and is NOT a generalized, authorized tool registry. It must not be described or reused as a ready multi-role assistant.

## 6. Proposed later build sequence

1. Approved history policy: expires 30 days (720 hours) after thread creation or user deletion sooner; messages never extend expiry. Source candidate tables are `assistant_threads` and `assistant_messages`, distinct from human Conversations and AI insights. Actor ownership references `public.profiles(user_id) ON DELETE CASCADE`, with identity exclusively from `auth.uid()`. Missing profiles fail closed without provisioning. Profile deletion and auth-to-profile deletion cascade history; a replacement profile starts empty. Physical expiry deletion requires a scheduler before release; none is configured. This does not change the built same-tab guided draft, its refresh/sign-out boundaries, or current UI.
2. Server tool registry with per-tool authorization matrix and schema-faithful role/RLS tests.
3. Read-only driver-self tools (own loads, expenses, profile summaries), Pro-gated, spend after authorization.
4. Recruiter workspace read-only tools under membership grants.
5. Assistant/agency tools under driver-approved field permissions.
6. Signed-in shell entry and UI, with copy that claims only built capabilities.

Acceptance for each step: privilege matrix tests, denied-role evidence, no spend on denied calls, no writes, live post-change checks.

Source candidate: `supabase/migration-candidates/20261026165204_phase3_assistant_history_foundation.sql`. Detailed scope matrix, provenance, local test evidence and release gates: [Phase 3 history audit](phase3-assistant-history-audit.md). No migration promotion, production SQL, model calls, tool registry or assistant-reply RPC occurred.

Outstanding release work: retention scheduler, privacy/provider terms, budgets and rate caps, server-signed replies and pre-spend reauthorization, scoped read-only tools, stale-session/response guards, signed-in shell integration, live role QA, job search card activation decision and audit logging scope. Inclusion in paid plans does not waive permission, budget or retention checks.
