# Driver Assistants Phase 3 — Agency Workflow + Service Packaging

## Goal

Turn the private Phase 2 agency foundation into a real workflow: agencies package services, share a private request link, drivers request help, drivers explicitly approve a specific assistant, and agencies manage clients + back-office work — all with server-enforced security and audit logs. No public marketplace, no payments, no auto-granted access.

## Non-negotiable invariants

- Agency membership alone never grants driver data access.
- Client request approval alone never grants driver data access.
- Work item assignment alone never grants driver data access.
- Only an active `driver_assistants` row (created via explicit driver approval) grants assistant access to driver operational data.
- All access enforced by RLS + SECURITY DEFINER RPCs with `SET search_path=public`. UI gating is cosmetic only.
- Phase 1/2 driver, recruiter, billing, and assistant flows are not modified except where strictly required for navigation safety.

## Pre-build audit (no code yet)

Re-read and confirm current shape:

- Tables: `driver_assistants`, `assistant_audit_log`, `agency_profiles`, `agency_members`.
- Helpers: `is_agency_owner`, `is_agency_member`, `get_my_agency`, `list_agency_members`, `assistant_has_perm`, etc.
- Hooks: `useActingContext`, `useAssistants`, `useAgency`, `useAssistantAudit`.
- Route guards in `Index.tsx`, `assistantPermissions.ts`.

## Database migration (single migration, all GRANT + RLS in order)

### New tables

1. `**agency_service_packages**` — `agency_id`, `name`, `description`, `price_display_text`, `billing_frequency_display_text`, `included_services jsonb`, `recommended_permissions jsonb`, `is_active`, `sort_order`.
2. `**agency_client_requests**` — `agency_id`, `driver_user_id`, `selected_package_id`, `status` (`pending|approved|declined|cancelled|converted_to_client`), `message`, `preferred_contact_method`, `phone`, `requested_permissions jsonb`, `assigned_member_user_id`, `decided_at`, `decided_by_user_id`.
3. `**agency_delegation_requests**` — `agency_id`, `client_request_id`, `driver_user_id`, `member_user_id` (nullable when invite-by-email), `member_invite_email` (nullable), `requested_permissions jsonb`, `status` (`pending_driver_approval|approved|declined|revoked|expired`), `approval_token` (hashed for driver-link approval when needed), `created_by_user_id`, `decided_at`.
4. `**agency_work_items**` — `agency_id`, `driver_user_id`, `assigned_member_user_id`, `client_request_id`, `title`, `description`, `type` (enum), `status` (enum), `priority` (enum), `due_date`, `created_by_user_id`, `completed_at`.
5. `**agency_audit_log**` — `actor_user_id`, `agency_id`, `driver_user_id`, `target_user_id`, `action`, `entity_type`, `entity_id`, `metadata jsonb`.

All tables: `id uuid pk`, `created_at`, `updated_at`, GRANT to `authenticated` + `service_role` (no `anon`), RLS enabled, then policies.

### RLS (representative)

- `agency_service_packages`: select if `is_agency_member(agency_id)` OR row in `agency_client_requests` ties to `auth.uid()`; write only if `is_agency_owner_or_admin(agency_id)`.
- `agency_client_requests`: driver sees own; agency owner/admin sees agency rows; assigned member sees assigned rows; insert allowed if `driver_user_id = auth.uid()`.
- `agency_delegation_requests`: driver sees own; agency owner/admin sees own agency; assigned member sees own.
- `agency_work_items`: agency owner/admin sees all; assigned member sees own; driver sees only `waiting_on_driver` rows for themselves.
- `agency_audit_log`: agency owner/admin sees agency rows; driver sees rows where `driver_user_id = auth.uid()`; no `anon`.

### Helpers (SECURITY DEFINER, `SET search_path=public`)

- `is_agency_owner_or_admin(_agency_id)`.
- `agency_can_view_request(_request_id)`.
- `agency_can_view_work_item(_item_id)`.

### RPCs (SECURITY DEFINER, EXECUTE granted to `authenticated`)

- `create_agency_package`, `update_agency_package`, `deactivate_agency_package`, `reorder_agency_packages`, `list_agency_packages(_agency_id)`.
- `public_get_agency_request_view(_agency_slug_or_id)` — returns agency name/desc/contact + active packages only. Safe for any authenticated user.
- `submit_agency_client_request(_agency_id, _package_id, _message, _contact_method, _phone, _consent)` — inserts row with `driver_user_id = auth.uid()`.
- `list_agency_client_requests(_agency_id)`, `assign_member_to_request`, `decline_client_request`, `cancel_client_request` (driver-owned).
- `create_delegation_request(_client_request_id, _member_user_id_or_email, _requested_permissions)`.
- `driver_approve_delegation(_delegation_id)` — on approve: upsert active `driver_assistants` row scoped to that member + permissions; mark client_request `converted_to_client`; audit.
- `driver_decline_delegation(_delegation_id)`.
- `revoke_delegation(_delegation_id)` — agency owner/admin or driver.
- `list_agency_clients(_agency_id)` — only drivers connected via approved delegation.
- `create_work_item`, `update_work_item`, `assign_work_item`, `set_work_item_status`, `list_work_items(_agency_id, filters)`.
- `list_agency_audit_log(_agency_id, _limit)`; `list_driver_agency_audit_log(_limit)`.

All write RPCs insert into `agency_audit_log`. Delegation approval also writes into existing `assistant_audit_log` to keep Driver Assistants timeline consistent.

## Frontend

### New / extended files

- `src/hooks/useAgencyPackages.ts`
- `src/hooks/useAgencyClientRequests.ts`
- `src/hooks/useAgencyDelegations.ts`
- `src/hooks/useAgencyWorkItems.ts`
- `src/hooks/useAgencyAudit.ts`
- `src/components/agency/ServicePackagesSection.tsx` (CRUD + reorder)
- `src/components/agency/ClientRequestsSection.tsx`
- `src/components/agency/AgencyClientsSection.tsx`
- `src/components/agency/WorkQueueSection.tsx`
- `src/components/agency/AgencyAuditSection.tsx`
- `src/pages/AgencyRequestPublic.tsx` — `/agency/request/:agencyId` (or slug). Auth-required; shows agency public view + request form.
- `src/pages/DriverDelegationApprovals.tsx` — driver-facing list of pending delegation requests; accessible from Assistants area + Settings link.
- Extend `src/pages/AgencyDashboard.tsx` to host the four new sections via tabs/accordion.
- Extend `useAssistantAudit.formatAuditAction` with Phase 3 actions, or new `formatAgencyAuditAction` in `useAgencyAudit.ts`.

### Copy

Add professional, non-overpromising onboarding copy on the empty `/agency` state per spec.

### Routes (App.tsx)

- `/agency/request/:agencyId` → `AgencyRequestPublic` (requires auth).
- `/assistant/delegations` (or under `/more`) → `DriverDelegationApprovals`.
- Existing `/agency` keeps current guard.

## Tests (`src/test/phase3AgencyWorkflow.test.ts`)

Pure unit-level checks against client logic + audit formatter, mirroring Phase 2 cleanup test style:

- Package gating: non-owner cannot mutate (RPC call shape).
- Inactive packages filtered from driver view helper.
- Request submission rejects when `driver_user_id !== auth.uid()` (mock).
- Delegation approval helper produces correct `driver_assistants` payload.
- Decline does not produce assistant payload.
- Agency client list helper excludes drivers without approved delegation.
- Work item assignment payload never includes assistant permissions.
- Audit formatter covers all new actions.
- Route guard map: assistant cannot reach `/agency`, billing routes; driver can reach delegation approval page.

## Verification

Run (and only claim pass if actually green):

- `bunx tsgo --noEmit`
- `bunx vitest run`
- `bun run build`

## Final report

Structured A–R sections exactly as specified by the user.

## Out of scope (explicitly deferred)

Public agency marketplace, ratings/reviews, payments, Stripe Connect, auto-granted access on membership or request approval, agency-wide multi-driver bulk operations beyond the work queue.

Proceed with Driver Assistants Phase 3 using the plan above, but apply these strict clarifications before building.

This must be built end to end. Do not build surface-level UI. Do not create fake workflows. Do not create database tables without real working UI and secure RPCs. Do not create UI buttons that do not complete the actual workflow.

Use your strongest available engineering agent. This is a production business feature for real drivers, assistants, and agencies.

Important clarifications:

1. Access rule is absolute

Agency membership alone must never grant driver operational data access.

Client request approval alone must never grant driver operational data access.

Work item assignment alone must never grant driver operational data access.

Only an active `driver_assistants` row created through explicit driver approval can grant assistant access to driver loads, expenses, fuel, reports, cost profile, or related operational data.

2. Delegation approval must handle existing and non-existing assistant accounts correctly

If the selected agency member already has a `member_user_id`, driver approval may create or update a `driver_assistants` row for that user with the approved permissions.

If the selected assistant/member does not have a user account yet and only has an invited email, driver approval must not create active access. It should create a pending assistant invite/delegation path tied to that email, then activate only when the invited person signs in with that email and accepts through the secure existing assistant invite flow.

Do not activate access for an email-only assistant until identity is verified.

3. No raw token exposure

Do not expose raw invite tokens, approval tokens, or token hashes in client-readable rows.

If tokenized flows are needed:

- store only hashed tokens
- send/use raw tokens only in generated links
- never return token hashes to the client
- never let database IDs act as approval tokens

4. Private request link

The agency request link must remain private and auth-required.

Use `/agency/request/:agencyId` unless a safe unique agency slug already exists or is properly added with uniqueness guarantees.

Do not build a public agency marketplace. Do not make agencies publicly searchable. Do not add ratings, reviews, payments, or Stripe Connect in Phase 3.

5. Service packages must be real

Service packages must be stored in `agency_service_packages`.

Agency owner/admin can create, edit, deactivate, and reorder packages.

Drivers should only see active packages through the private request flow.

Inactive packages must not be selectable by drivers.

Recommended permissions from a package are suggestions only. They do not grant access until the driver approves the final delegation request.

6. Client requests must be real

Driver requests must be stored in `agency_client_requests`.

Submitting a request must not grant access.

Agency owner/admin can review, approve, decline, assign, and convert requests.

Assigned members may view only what they are allowed to view.

Drivers must be able to see their own request status.

7. Driver delegation approval must be explicit

The driver must see a clear approval screen showing:

- agency name
- selected package
- assistant/member name or email
- requested permissions
- what the assistant can do
- what the assistant cannot do
- approve button
- decline button

Approval must be server-side through a secure RPC.

Decline must not grant access.

Every approval/decline must be logged.

8. Agency clients must be derived safely

The agency client list must only show drivers connected through the Phase 3 agency workflow and approved delegation records.

Do not show unrelated drivers.

Do not show a driver just because an agency member personally manages them unless that connection is safely linked to the agency workflow.

9. Work queue must not grant access

Work items are task management only.

A work item assigned to a member must not grant access to driver data.

If a member clicks from a work item into driver data, existing `driver_assistants` permissions must still be checked by RLS/RPC.

10. Audit logging is required

Add agency audit logging for:

- package created
- package updated
- package deactivated
- client request submitted
- client request approved
- client request declined
- delegation request created
- delegation approved by driver
- delegation declined by driver
- work item created
- work item assigned
- work item status changed
- work item completed

Also write to the existing assistant activity timeline when delegation approval creates or updates `driver_assistants`.

11. Security implementation requirements

All new write actions must be server-authorized.

Use RLS and SECURITY DEFINER RPCs carefully.

All SECURITY DEFINER functions must use `SET search_path=public`.

Revoke EXECUTE from PUBLIC/anon where appropriate.

Grant only to authenticated where needed.

Do not add broad policies like `authenticated can read all`.

Do not touch recruiter billing, driver billing, role intent, or existing assistant access unless required for safe navigation.

12. Tests are required

Add meaningful Phase 3 tests.

At minimum, test:

- agency membership alone does not grant driver access
- client request approval alone does not grant driver access
- work item assignment alone does not grant driver access
- driver delegation approval is required before assistant access
- declined delegation does not grant access
- inactive packages are hidden from driver request flow
- non-owner/non-admin cannot manage packages
- revoked agency member cannot create delegation requests
- agency client list excludes unrelated drivers
- audit labels handle Phase 3 actions
- assistant route guards still block billing and recruiter areas

13. Required commands

Run and report exact results:

- `bunx tsgo --noEmit`
- `bunx vitest run`
- `bun run build`

Do not claim success unless each command was actually run and passed.

14. Final report

Use the required A-R structure:

A. Files changed/added  
B. Migrations added  
C. Tables added  
D. RLS policies added/modified  
E. RPCs/helpers added/modified  
F. Agency service package summary  
G. Private request link summary  
H. Client request workflow summary  
I. Driver delegation approval summary  
J. Agency client list summary  
K. Work queue summary  
L. Audit logging summary  
M. Security verification  
N. Regression verification  
O. Tests added  
P. Exact command results  
Q. Known limitations  
R. Recommended Phase 4

Do not mark Phase 3 complete unless the full workflow works end to end and the build, tests, and typecheck all pass.

This phase must be real, secure, and production-ready.