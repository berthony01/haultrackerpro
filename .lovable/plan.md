
# Driver Assistants — Phase 1 Build Plan

A foundation that lets a driver invite a trusted person to enter loads, expenses, fuel, receipts, and pull reports on their behalf — without touching billing, account ownership, or recruiter surfaces. Built so it can grow into a full agency model later without rework.

## Scope this phase

In scope:
- Invite / accept / revoke flow (email-based, account-bound on accept).
- Granular per-assistant permissions.
- Acting-as context: assistant signs into their own account, selects a driver they manage, and all writes land on the driver's account.
- Audit log of assistant actions.
- Driver settings UI to manage assistants.
- Assistant dashboard with driver switcher.
- Hardened DB-level access (RLS + helpers), not just UI hiding.

Explicitly out of scope (designed-for, not built):
- Public agency/marketplace directory, ratings, service packages.
- Agency-of-agencies, team members under an agency owner.
- Ownership transfer.
- Assistant-side billing or paid assistant plans.
- Assistants inviting other assistants.

## Data model (new tables)

```text
driver_assistants
  id, driver_user_id, assistant_user_id (nullable until accept),
  invite_email (lower, normalized), invite_token (hashed),
  status: pending | active | revoked | expired,
  permissions jsonb (see below),
  invited_at, accepted_at, revoked_at, last_active_at,
  created_at, updated_at
  UNIQUE (driver_user_id, invite_email) WHERE status IN (pending, active)

assistant_audit_log
  id, driver_user_id, assistant_user_id, delegate_id,
  action, entity_type, entity_id, metadata jsonb, created_at
```

Permission keys (booleans inside `permissions` jsonb):
`manage_loads, manage_expenses, manage_fuel, manage_receipts, view_reports, export_reports, manage_documents, view_dashboard, manage_settings_limited`.

Hard-blocked everywhere (never reachable via assistant): billing, subscription, account deletion, owner email, recruiter surfaces, inviting other assistants, role/plan changes.

## Access model

Single security-definer helper drives every check:

```sql
public.assistant_has_permission(_assistant uuid, _driver uuid, _perm text) returns boolean
-- true iff active row exists AND permissions->>_perm = 'true'
```

Existing user-owned tables (`loads`, `expenses`, `fuel_logs`, `load_stops`, etc.) get an **additive** policy:

```sql
-- existing owner policy stays untouched
CREATE POLICY "<table>_assistant_rw" ON public.<table>
  FOR ALL TO authenticated
  USING (public.assistant_has_permission(auth.uid(), user_id, '<perm>'))
  WITH CHECK (public.assistant_has_permission(auth.uid(), user_id, '<perm>'));
```

No existing policy is dropped, weakened, or rewritten. Billing tables (`subscriptions`, `recruiter_billing_profiles`, `profiles` intent/billing columns), recruiter tables, and admin tables get **no** assistant policy — assistants simply have no path to them.

`driver_assistants` and `assistant_audit_log` get their own tight RLS: driver sees rows where `driver_user_id = auth.uid()`; assistant sees rows where `assistant_user_id = auth.uid()`; audit log is insert-only for the acting assistant via SECURITY DEFINER RPC, read by driver and by the assistant for their own actions.

## Acting-as context (client)

New hook `useActingContext()`:
- Reads `?as=<driver_user_id>` from URL (source of truth, shareable, survives reloads).
- Validates server-side via `get_my_managed_drivers()` RPC; rejects unknown ids.
- Exposes `{ actingForDriverId, permissions, isAssistant }`.
- All existing data hooks (`useLoads`, `useExpenses`, `useFuelLogs`, etc.) read `actingForDriverId ?? user.id` when building queries and inserts. Because RLS enforces the same rule, a bug here can't leak data — it just 401s.

A persistent "Acting for: <Driver name>" banner shows whenever `actingForDriverId !== user.id`, with a one-click "Exit assistant mode".

## RPCs (SECURITY DEFINER, search_path = public)

- `invite_assistant(_email, _permissions jsonb)` — driver-only, normalizes email, creates pending row, returns invite link payload.
- `accept_assistant_invite(_token)` — assistant-only, binds `assistant_user_id = auth.uid()`, flips to active.
- `revoke_assistant(_id)` — driver-only.
- `update_assistant_permissions(_id, _permissions)` — driver-only.
- `get_my_managed_drivers()` — assistant-only, returns active drivers + permissions.
- `list_my_assistants()` — driver-only.
- `log_assistant_action(_driver, _action, _entity_type, _entity_id, _metadata)` — writes audit row only if caller is active assistant for that driver. Called from a thin client wrapper around create/update/delete data mutations.

## UI

Driver side — new `Settings → Assistants` panel:
- Invite form (email + permission checkboxes).
- Pending / Active / Revoked lists with per-row Edit permissions, Resend, Revoke.
- Plain-language explainer of what assistants can/can't do.

Assistant side — new top-level entry when the user has ≥1 active delegation:
- `/assistant` dashboard: managed-driver cards, current acting context, quick actions (Add Load / Expense / Fuel / Upload Receipt) routed into existing forms with `?as=…` preserved.
- Pending-invite acceptance screen at `/assistant/invite/:token`.

All built with existing shadcn/Tailwind components — no new design system.

## Email

Invite email sent via existing `send-transactional-email` edge function with a new template `driver-assistant-invite`. Link: `https://<host>/assistant/invite/<token>`.

## Billing gating

Phase 1: drivers with `subscriptions.tier = pro` (or admin) can invite up to **1** active assistant. Free drivers see a locked-state CTA pointing to `/pricing`. Existing `useSubscription` hook is reused; no new billing logic. Assistants pay nothing and need only a free HaulTrackerPro account.

## Future-ready, not future-built

`driver_assistants` is intentionally a many-to-many edge: one assistant row per (driver, assistant) pair, so a single assistant_user_id can already manage multiple drivers in Phase 1. The agency layer in Phase 2 only needs to add an `agencies` table + optional `agency_id` FK on this table — no destructive migration.

## Regression protection

Before edits: read existing RLS on `loads`, `expenses`, `fuel_logs`, `load_stops`, `subscriptions`, `recruiter_profiles`, `profiles`; confirm owner policies use `auth.uid() = user_id`.

After edits, must pass:
1. `tsgo` clean.
2. `vitest run` — full 439-test suite green; new tests for permission helper, RPC eligibility, and acting-context selection.
3. Playwright smoke (`tests/e2e/driver-journey.spec.ts`) — driver flow unchanged.
4. Manual RLS probe via `psql`: assistant token cannot read another driver's loads, cannot read `subscriptions`, cannot call `apply_recruiter_intent`, loses all access the instant their row flips to `revoked`.

## Deliverable structure

Migrations (one file): tables + helper + RPCs + additive policies + grants.
Edge function template: invite email.
New files:
- `src/hooks/useActingContext.ts`
- `src/hooks/useAssistants.ts`, `src/hooks/useManagedDrivers.ts`
- `src/components/assistants/{AssistantsPanel,InviteAssistantDialog,AssistantRow,ActingAsBanner}.tsx`
- `src/pages/AssistantDashboard.tsx`, `src/pages/AssistantInviteAccept.tsx`
- `src/lib/assistantPermissions.ts` (client mirror of server perm keys; UI gate only)
- `src/test/assistantPermissions.test.ts`, `src/test/actingContext.test.ts`

Modified files (surgical):
- `src/App.tsx` — two new routes, banner mount.
- Data hooks: `useLoads, useExpenses, useFuelLogs, useLoadStops` — swap `user.id` for `actingContext.targetUserId`.
- `src/components/SettingsView.tsx` — add Assistants accordion section.

## Open questions before I start

1. **Invite delivery** — OK to reuse existing `send-transactional-email` (Resend) for the assistant invite email, same look as current transactional templates?
2. **Plan gating threshold for Phase 1** — confirm: Pro = 1 assistant, Free = locked? Or allow Free drivers 1 assistant during rollout?
3. **Settings access for assistants** — `manage_settings_limited` covers what exactly? My default: only Cost Profile + default pay model. Confirm or narrow.
4. **Delete rights** — should assistants ever be allowed to delete a load/expense/fuel row, gated behind a separate `allow_destructive` per-permission flag? Default: no deletes in Phase 1; edits and creates only.
