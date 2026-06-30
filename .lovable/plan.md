
## Why this plan

You're right that the Back-Office Agency surface "feels attached" to the driver and recruiter dashboards. The data is actually scoped correctly (agency clients, packages, requests, work queue, audit, plan & limits all read from agency-only RPCs), but the **shell, navigation, and one summary stat** still conflate the three audiences. That's what you're seeing in the UI.

This plan is a true separation pass — not a rebuild. /agency stays as its own page; we cut the wires that make it look like a tab inside the driver/recruiter dashboard.

## Audit findings (what's actually wrong)

1. **"Drivers managed (you)" stat on /agency Overview** reads from `useActingContext().managedDrivers` — that's the **assistant-delegation** list (drivers who invited you as a Driver Assistant), not the agency's clients. An agency with 4 clients but 0 assistant delegations shows "0 drivers managed", and an assistant with no agency shows their delegation count there too. This is the single biggest "it's mixing things up" symptom.

2. **PageNav "Dashboard" button on /agency points to `/dashboard`** (the driver/recruiter shell). Clicking the obvious "go home" link on the agency page lands you in the driver UI — that's why it feels like agency lives *inside* the driver dashboard.

3. **No agency-native top/side nav.** /agency renders only inside `AppShell` + `PageNav`. The driver/recruiter dashboards have `AppSidebar` + `BottomNav` with their own console identity ("Load & Pay Manager" / "Recruiter Console"). The agency has no equivalent "Agency Console" chrome, so it visually reads as a stray sub-page.

4. **Work queue item types include `load_entry`, `expense_entry`, `fuel_entry`** — these are agency *tasks* ("log this load on behalf of client X"), not driver load rows. The copy is close enough to driver terminology that at a glance it looks like the agency is showing real driver loads. Data is clean; copy is misleading.

5. **CapabilityLauncher / Auth tiles** correctly route Agency to `/agency`, but once there, there's no signed-in way back to `/start` or to switch capability — only the driver dashboard link. Reinforces the "agency is a child of driver" feeling.

What is *not* wrong (verified):
- `/agency` does not read `loads`, `expenses`, or `fuel_logs` tables directly.
- `agency_clients`, `agency_work_items`, `agency_service_packages`, `agency_audit_log`, `agency_entitlements` are agency-scoped via SECURITY DEFINER RPCs with their own RLS.
- Recruiter tables (`recruiter_*`) are not touched by agency code.
- Stripe agency billing uses isolated customer IDs and `billing_context = "agency"` metadata.

## Fixes (surgical, UI/UX only — no schema changes)

### 1. Stop conflating assistant delegations with agency clients
- In `AgencyDashboard.tsx`, replace the **"Drivers managed (you)"** stat with **"Active clients"** sourced from `useAgencyClients(agency.id)`.
- Keep "Active members" as-is.
- Remove the `useActingContext` import from `AgencyDashboard.tsx` — the agency page has no business reading the assistant-delegation context.

### 2. Make /agency feel like its own console
- Add an agency-specific header band inside `AgencyDashboard.tsx`: title "Agency Console", subtitle "Back-office workspace — separate from your driver and recruiter dashboards", and the agency name/role badge.
- Add a compact "Switch workspace" menu in that header with links to `/start` (Capability Launcher), `/dashboard` (only if the user actually has driver data — gated by `useUserRole`), and `/assistant` (only if `managedDrivers.length > 0`). This makes the relationship explicit instead of implicit.

### 3. Fix the "Dashboard" trap in PageNav on agency routes
- `PageNav.tsx` currently always renders a "Dashboard" link to `/dashboard`. Extend it with an optional `home` prop (`{ label, to }`) and on `/agency*` pass `home={{ label: 'Agency', to: '/agency' }}`. Same treatment for `/assistant*` → `{ label: 'Assistant', to: '/assistant' }`.
- Fallback stays `/dashboard` for driver/recruiter routes.

### 4. Clarify work queue copy so it doesn't look like driver loads
- In `WorkQueueSection.tsx`, relabel the entry types in the UI:
  - `load_entry` → "Log load for client"
  - `expense_entry` → "Log expense for client"
  - `fuel_entry` → "Log fuel for client"
- Add a one-line section caption: "These are tasks your agency owes a client. They are *not* the client's loads — opening one routes you into that client's account with your delegated permissions."

### 5. Tests
- Extend `src/test/phase8AgencyStripe.test.ts` (or add `src/test/agencySeparation.test.tsx`) with assertions:
  - `AgencyDashboard` renders "Active clients" stat from `useAgencyClients`, not `managedDrivers`.
  - `PageNav` on an `/agency` route renders a home link to `/agency`, not `/dashboard`.
  - `WorkQueueSection` renders the new client-scoped labels.

### Out of scope (call out, don't do now)
- Building a dedicated `AgencySidebar` / `AgencyBottomNav` (a richer console). The header + switch-workspace menu is enough to break the "child of driver dashboard" feel without a full nav rebuild.
- Splitting agency into its own subdomain / route prefix beyond `/agency`.
- Any schema, RLS, or RPC change — data layer is already separated correctly.

## Files this will touch

- `src/pages/AgencyDashboard.tsx` — replace stat, add console header + switch-workspace menu, drop `useActingContext`.
- `src/components/layout/PageNav.tsx` — add `home` prop; default unchanged.
- `src/pages/AgencyDashboard.tsx` (PageNav call site) and `src/pages/AssistantDashboard.tsx` — pass `home`.
- `src/components/agency/WorkQueueSection.tsx` — relabel entry types, add caption.
- `src/test/agencySeparation.test.tsx` (new) — coverage for the three behaviors above.

After implementation I'll run typecheck + vitest and a quick Playwright pass on `/agency` to confirm no driver/recruiter data renders.
