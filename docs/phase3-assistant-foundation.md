# Phase 3 Assistant Foundation: Architecture Contract

Status: CONTRACT. Only section 1 is built. Everything in sections 2 to 6 is proposed future work and is not implemented, approved or active. Tracking: issue #44.

## 1. Built now: same-tab driver conversation continuity

- `src/components/home/WorkConversationDraftProvider.tsx` is mounted once in `src/App.tsx`, inside `AuthProvider` and `ActingContextProvider`, wrapping the existing routes. Provider and route order and all route guards are unchanged.
- It holds ONE in-memory snapshot of the guided driver conversation (transcript, current step, Back history, unsent typed text, Start over state). It never writes to localStorage, sessionStorage, IndexedDB, the network or logs. A page refresh destroys it.
- Identity comes only from the existing `useAuth` and `useActingContext` state. The snapshot is readable and writable only when auth is resolved, `user.id === session.user.id`, the managed-driver context is resolved and the user is not acting for another driver (scope `personal-driver-self`). Any other state clears it synchronously during render and reads fail closed. Writes from a stale owner are refused by a live-owner ref check.
- `DriverWorkConversation` attaches the adapter only inside the already-authorized `ProfileConversation`. A definitive invalid outer gate (signed out, capability error, no driver workspace, acting) clears the draft. The snapshot is tied to a fingerprint of the saved work-profile seed; a changed profile invalidates it.
- The public homepage chat receives no adapter and stays ephemeral. Without the provider every consumer stays ephemeral; there is no module-global fallback cache.
- Opening, typing or restoring never saves preferences, publishes a job search card, or calls AI. Review handoff (`pendingProfileHandoff`) is separate and unchanged.
- Known limit: a capability revocation that happens while the chat is not mounted is enforced when the chat next mounts (it renders unavailable and clears). The provider itself does not read capability state.

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

Pro entitlement (`src/hooks/useSubscription.ts`, server `check-subscription`) gates paid assistant use, checked server side.

## 4. Future tool and safety rules (proposed)

- Every tool call is authorized server side (identity, target, permission, Pro) BEFORE any model spend.
- First tools are read-only, grounded projections over existing RLS-protected data. No arbitrary SQL. Caller-supplied context is never authority.
- Retrieved content and user text are untrusted (prompt injection). Tools cannot be selected or widened by model output beyond the authorized registry.
- Job search cards stay disabled (`job_search_feature_control` never activated) pending a separate activation decision.
- No messages, applications, payments or other writes from the assistant in the first phases.

## 5. Existing AI is not this assistant

`supabase/functions/ai-insight/index.ts` runs specialized tasks (`type` plus caller-supplied `context`, cached by context hash, see lines ~349-482; delegation checks in `ai-insight/delegation.ts`). It accepts caller context and is NOT a generalized, authorized tool registry. It must not be described or reused as a ready multi-role assistant.

## 6. Proposed later build sequence

1. Decide durable transcript policy: storage location, retention period, user deletion control, account deletion cascade, and whether drafts survive sign-out. (Open, not decided.)
2. Server tool registry with per-tool authorization matrix and schema-faithful role/RLS tests.
3. Read-only driver-self tools (own loads, expenses, profile summaries), Pro-gated, spend after authorization.
4. Recruiter workspace read-only tools under membership grants.
5. Assistant/agency tools under driver-approved field permissions.
6. Signed-in shell entry and UI, with copy that claims only built capabilities.

Acceptance for each step: privilege matrix tests, denied-role evidence, no spend on denied calls, no writes, live post-change checks.

Outstanding decisions: transcript retention and deletion, durable storage, Pro pricing of assistant usage, job search card activation, audit logging scope.
