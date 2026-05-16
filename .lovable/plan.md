# Add Contracts as a first-class navigation item

Make Contract Protection discoverable as its own page on both the driver and recruiter sides, without changing the underlying schema, edge functions, or `ContractAttachment` behavior. All access is gated through `effectiveRole` from `useViewMode`, so admins follow the Driver | Recruiter switcher and non-admins stay locked to their real role.

## What gets built

### 1. New route key: `contracts`

In `src/pages/Index.tsx`:

- Add `'contracts'` to `driverOnlyPages` is **not** correct — we need it visible to BOTH roles. Instead, treat `contracts` as a *shared* key whose body component is chosen by `isRecruiterView`.
- Add `contracts` to the page-state union and render either `<DriverContractsView />` or `<RecruiterContractsView />` based on `isRecruiterView`.
- Add a defensive branch in `handleNavigate` so `contracts` is always allowed regardless of view, but the rendered body comes from the active role.
- Route guard `useEffect`: do not redirect away from `contracts`; it's role-agnostic at the route level, role-specific at the body level.

### 2. Driver navigation

`src/components/premium/AppSidebar.tsx` — `driverItems`: insert `{ id: 'contracts', label: 'Contracts', icon: FileSignature }` between `Opportunities` and `Expenses`.

`src/components/BottomNav.tsx`:

- `driverNav` stays 2+FAB+2 (per memory). Don't add Contracts to the 5-slot strip; add it to the driver **More** sheet (`driverMoreItems`) instead so the bottom bar density rule is respected.

### 3. Recruiter navigation

`AppSidebar.tsx` — `recruiterItems`: insert `{ id: 'contracts', label: 'Contracts', icon: FileSignature }` between `Applications` and `Settings`.

`BottomNav.tsx` — `recruiterNav` keeps 4 slots; add `Contracts` to `recruiterMoreItems` for parity with driver-side.

### 4. New component: `src/components/contracts/DriverContractsView.tsx`

Data: `useOpportunityApplications()` (driver applications) + `useContractReadinessMap(applicationIds)`. No new queries needed — reuse what `DriverApplicationsPanel` already uses.

Tabs/filters (in-memory filter on `readiness`):

- Needs Review (`awaiting_driver_decision`)
- Approved (`driver_approved`)
- Changes Requested (`changes_requested`)
- Rejected (`driver_rejected`)
- Signed (derived from `ContractWithVersion.driver_signature` via per-card hook, or fall back to `driver_approved` + status `signed`)
- All

Each card shows: opportunity title, company name, application status badge, readiness badge, last updated, "Open application" deep-link to `opportunities` → My Requests for that app, and the existing `<ContractAttachment applicationId={a.id} role="driver" />` mounted inline (which already exposes view / AI review / approve / reject / request-changes / sign / clause explainer — all driver-only actions). No upload/replace/parse UI because `ContractAttachment` already hides those for `role="driver"`.

Empty state (no driver contracts at all): educational card explaining recruiters will attach contracts here and listing the four driver actions (review, approve/reject, request changes, sign).

### 5. New component: `src/components/contracts/RecruiterContractsView.tsx`

Data: `useRecruiterProfile()` → `useOpportunityApplications({ recruiterId })` + `useContractReadinessMap(applicationIds)`.

Tabs/filters:

- Awaiting Upload (`awaiting_upload` or `no_contract` where application is active)
- Uploaded (`needs_ai_review` pre-AI)
- AI Reviewed (`awaiting_driver_decision` post-AI)
- Needs Driver Review (`awaiting_driver_decision`)
- Approved (`driver_approved`)
- Changes Requested
- Rejected
- Signed (driver_signature present)
- Blocked from Hire (application status `pending_hire` AND readiness ≠ `driver_approved`/signed — derived in component)
- All

Each card shows: driver name (using existing snapshot fields/RLS-allowed view), opportunity title, application status, readiness badge, AI risk tier if present (read from `ContractWithVersion` via lightweight per-card hook OR just rely on what ContractAttachment displays), last updated, "Open application" link to `recruiter-access:applications`, and `<ContractAttachment applicationId={a.id} role="recruiter" />` inline (which already provides upload / replace / parse / analyze / view driver decision — recruiter-only actions; never exposes sign/driver-review submission).

Empty state: educational card explaining recruiters can attach contracts, run AI review, and track driver approval before finalizing a hire.

### 6. Dashboard cards

`src/components/contracts/ContractActionsCard.tsx` (new, single component that switches copy by role):

- Driver mode: counts applications where readiness ∈ {`awaiting_driver_decision`, signed-eligible}. Renders only if count > 0. CTA navigates to `contracts`.
- Recruiter mode: counts {awaiting_upload, needs_ai_review, awaiting_driver_decision, hire-blocked}. Renders only if count > 0. CTA navigates to `contracts`.

Mount in `Index.tsx`:

- Driver dashboard block (`page === 'dashboard' && !isRecruiterView`): add near the top alongside other actionable cards.
- Recruiter hub (`page === 'recruiter-access' && isRecruiterView` when `recruiterView === 'hub'`): add near top of `RecruiterAccessPage`'s hub view, OR mount in `Index.tsx` above the recruiter content area. Prefer the latter to avoid touching `RecruiterAccessPage` if it complicates routing.

### 7. Access rules (no schema changes)

- RLS on `contracts`, `contract_versions`, `contract_reviews`, `contract_signatures`, `contract_audit_log`, `opportunity_applications` already enforces driver-sees-own / recruiter-sees-own-via-`is_recruiter_owner` / admin-sees-all. The new pages add zero privileged surface.
- UI separation is enforced by `effectiveRole`. `ContractAttachment`'s `role` prop is fed from `effectiveRole`, never from the user's database role, so an admin in Driver view sees driver controls only.
- Non-admin non-recruiter users: `useRecruiterProfile()` returns null → `RecruiterContractsView` shows a "not available" state; route guard already prevents them from landing in recruiter view.
- Direct URL deep-link to `?page=contracts` works for both views; body picks via `isRecruiterView`. No way to bypass — recruiter-only data is fetched with `recruiterId`, and driver-only data is fetched with the caller's `auth.uid()`, both subject to RLS.

## Files

**New**

- `src/components/contracts/DriverContractsView.tsx`
- `src/components/contracts/RecruiterContractsView.tsx`
- `src/components/contracts/ContractActionsCard.tsx`

**Edited**

- `src/pages/Index.tsx` — add `contracts` page, render switcher, dashboard card mounts, navigate gating.
- `src/components/premium/AppSidebar.tsx` — add Contracts to both driver and recruiter item lists.
- `src/components/BottomNav.tsx` — add Contracts to driver and recruiter More sheets.

**Untouched (explicitly preserved)**

- `src/components/contracts/ContractAttachment.tsx`
- All `supabase/functions/*-contract/` edge functions
- All `contracts*` tables / RLS
- `useApplicationContract`, `useContractReadinessMap`
- `DriverApplicationsPanel`, `RecruiterApplicationsDashboard` (their inline contract blocks stay)

## Out of scope

- No DB migrations.
- No edits to edge functions or `ContractAttachment`.
- No new top-level slot in the mobile bottom bar — Contracts lives in the More sheet to respect the existing 2+FAB+2 rule.
- No changes to landing-page or marketing copy.
- No admin contracts panel changes — `AdminContractsPanel` keeps its existing admin-only top-level entry.

This plan is approved, but please implement it with the following safeguards.

1. Keep `contracts` as a shared page key.

Do not add it to driverOnlyPages or recruiterOnlyPages. The route key should be shared, and the rendered body should be chosen by effectiveRole:

- effectiveRole === 'driver' -> DriverContractsView

- effectiveRole === 'recruiter' -> RecruiterContractsView

2. Verify the data hooks before building.

Before using useOpportunityApplications() for DriverContractsView, confirm it returns only the logged-in driver's own applications and includes the opportunity/company fields needed for the contract cards.

Before using useOpportunityApplications({ recruiterId }) for RecruiterContractsView, confirm it returns only applications tied to that recruiter's opportunities and includes driver/applicant fields allowed by RLS.

If the existing hook does not support this cleanly, create a small contracts-specific hook that reuses existing tables and respects existing RLS. Do not change schema.

3. Do not confuse approved with signed.

Signed should only mean an actual driver signature exists, such as a contract signature record or confirmed driver_signature field.

Do not label a contract as Signed just because readiness is driver_approved.

4. Keep ContractAttachment unchanged.

Reuse the existing ContractAttachment component exactly as planned:

- DriverContractsView passes role="driver"

- RecruiterContractsView passes role="recruiter"

Admin/owner should receive the role based on effectiveRole, not the raw database role.

5. Add Contracts to desktop navigation for both sides.

Driver sidebar:

- Dashboard

- Loads

- Opportunities

- Contracts

- Expenses

- Fuel

- Reports

- Settings

Recruiter sidebar:

- Recruiter Dashboard

- Manage Opportunities

- Applications

- Contracts

- Settings

6. Keep mobile bottom nav clean.

Do not add Contracts as a main bottom-nav slot.

Put Contracts in the driver More sheet and recruiter More sheet as planned.

7. Add dashboard action cards carefully.

Driver dashboard card:

Show only if the driver has contracts needing review, signature, or action.

CTA: Review Contracts

Recruiter dashboard card:

Show only if recruiter has contracts needing upload, AI review, driver approval, or hire-blocked action.

CTA: Manage Contracts

Do not show the card when count is zero.

8. Add educational empty states.

Driver empty state should explain that contracts from recruiters will appear here and drivers can review, approve, reject, request changes, and sign.

Recruiter empty state should explain that recruiters can attach contracts, run AI-assisted review, track driver approval, and prevent final hiring before contract readiness is complete.

9. Keep strict role separation.

Driver View:

- show DriverContractsView only

- show driver contract actions only

- no upload/replace/parse recruiter tools

Recruiter View:

- show RecruiterContractsView only

- show recruiter contract tools only

- no driver signing or driver decision actions

10. QA checklist:

- Driver desktop sidebar shows Contracts.

- Driver mobile More sheet shows Contracts.

- Driver Contracts page shows only driver-owned application contracts.

- Driver cannot upload or replace contracts.

- Recruiter desktop sidebar shows Contracts.

- Recruiter mobile More sheet shows Contracts.

- Recruiter Contracts page shows only recruiter-owned application contracts.

- Recruiter cannot sign as driver or submit driver decisions.

- Owner/admin in Driver View sees driver contracts only.

- Owner/admin in Recruiter View sees recruiter contracts only.

- ?page=contracts works in both views and renders the correct page body.

- Dashboard card appears only when there are real pending contract actions.

- Empty state appears when there are no contracts.

- Build passes with no TypeScript errors and no console errors.