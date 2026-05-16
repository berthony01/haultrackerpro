# Fix Role Confusion + Add Owner View Switcher

## Root cause (audit)

Your `berthonyxyz@gmail.com` account is **admin + has a `recruiter_profiles` row + has driver data** all at once. Three pieces of code interact badly:

1. `useUserRole.ts` returns `role='recruiter'` (because the seeded recruiter profile exists).
2. `Index.tsx` line 428 role-guard says `if (roleLoading || isAdmin) return;` — admins are exempt from being redirected to their role's home page, so the page stays on the default `'dashboard'` (driver content).
3. Sidebar/BottomNav render based on `role` — so they show the **recruiter menu**.

Result: **driver dashboard content + recruiter menu items + an "Admin Tools" jump**. That's what you're seeing.

For non-admin accounts the same code path *should* work strictly (driver-only or recruiter-only), but it has not been verified end-to-end.

---

## What gets built

### 1. Add a Driver | Recruiter view switcher (admin / dual-role only)

New hook `src/hooks/useViewMode.ts`:

- Returns `{ viewMode, setViewMode, canSwitch, effectiveRole }`.
- `canSwitch = isAdmin || (hasRecruiterProfile && hasDriverData)` — non-admins with only one role never see the switcher.
- `viewMode` persisted in `localStorage` under `htp_view_mode` (`'driver' | 'recruiter'`). Default for admins = `'driver'`; for dual-role non-admin = their primary `role`.
- `effectiveRole = canSwitch ? viewMode : role`.

New component `src/components/ViewModeSwitch.tsx`:

- Compact segmented control (Driver | Recruiter) in the header.
- Only renders when `canSwitch === true`.
- On change: updates localStorage, then navigates to that role's home (`dashboard` or `recruiter-access`).

### 2. Replace `isRecruiter` gating with `effectiveRole` in `Index.tsx`

- `const { effectiveRole, canSwitch } = useViewMode(); const isRecruiterView = effectiveRole === 'recruiter';`
- Replace **every** `isRecruiter` reference in `Index.tsx` (~10 spots) with `isRecruiterView` for UI gating — including:
  - Sidebar/BottomNav `role={effectiveRole}` prop
  - Header subtitle ("Recruiter Console" vs "Load & Pay Manager")
  - Smart reminders / milestone nudges / role card visibility
  - Settings page selector (RecruiterSettingsView vs SettingsView)
- Update the role-guard `useEffect` (line 427):
  - Remove `isAdmin` bypass.
  - Rule: if `isRecruiterView && page ∈ driverOnlyPages` → setPage('recruiter-access'). If `!isRecruiterView && page === 'recruiter-access'` → setPage('dashboard').
  - This now applies uniformly — admin obeys their chosen viewMode, non-admins are locked to their `role`.
- Same swap in `handleNavigate` defensive gating (line 459+): use `effectiveRole`, drop `isAdmin` short-circuits.

### 3. Remove now-redundant "Admin Tools" cross-role link

- Delete the `adminCrossRoleItem` block in `AppSidebar.tsx` (lines 31–39, 81–95).
- Delete the equivalent admin cross-role block in `BottomNav.tsx` (~lines 82+).
- The header switcher replaces it cleanly.

### 4. Verify non-admin role isolation

Walk through the four non-admin cases and confirm `effectiveRole` and gating behave correctly:


| Account                                  | role      | canSwitch | Expected dashboard  | Expected menu  |
| ---------------------------------------- | --------- | --------- | ------------------- | -------------- |
| Plain driver (no recruiter_profiles row) | driver    | false     | Driver dashboard    | Driver menu    |
| Plain recruiter (profile, no loads)      | recruiter | false     | Recruiter dashboard | Recruiter menu |
| Dual-role non-admin                      | recruiter | true      | Last-used / driver  | Switcher shown |
| Admin (berthonyxyz)                      | recruiter | true      | Last-used / driver  | Switcher shown |


For the first two: switcher hidden, role-guard forces them home if they URL-hack into the other side. Confirmed by tracing the new `useEffect` with `isAdmin` removed.

### 5. Quick QA after implementation

- Manual: log in as `berthonyxyz`, toggle switch, confirm menu + main pane swap together and last choice persists across reload.
- Manual: create a temp plain-driver account, log in, confirm no switcher, dashboard = driver, `/?page=recruiter-access` redirects to dashboard.
- Console: no React key/role-loading warnings during the toggle.

---

## Out of scope

- No DB / RLS / edge function changes.
- No changes to `useUserRole.ts` itself (still source of truth for "does this user *have* the role"). Only consumers change.
- No landing-page / Phase 4 changes.
- No removal of admin privileges — `useAdmin()` still grants RLS bypass etc., it just no longer auto-bypasses the *UI* role guard.

## Files touched

- `src/hooks/useViewMode.ts` (new)
- `src/components/ViewModeSwitch.tsx` (new)
- `src/pages/Index.tsx` (edit: swap `isRecruiter`→`isRecruiterView`, fix role-guard, mount switcher in header)
- `src/components/premium/AppSidebar.tsx` (edit: remove admin cross-role item)
- `src/components/BottomNav.tsx` (edit: remove admin cross-role item)

This plan is approved, but please apply these safeguards while implementing it.

The architecture is correct:

- Keep useUserRole as the source of what roles/access the account has.

- Add viewMode as the active UI view.

- Use effectiveRole to control the dashboard, sidebar, mobile nav, settings view, redirects, and route guards.

- Admin/owner should no longer bypass UI role guards.

- Admin/owner should use the Driver | Recruiter switcher instead.

Required safeguards:

1. Do not define driver eligibility only by existing load/driver data.

A new driver may not have loads yet. If there is no dedicated driver_profiles table, default non-recruiter users to driver. For canSwitch, admin can always switch. Non-admin dual-role switching should only be allowed if the account truly has both confirmed roles.

2. localStorage must never create access.

If canSwitch is false, ignore htp_view_mode completely and force effectiveRole to the real role from useUserRole.

Example:

- normal driver with htp_view_mode='recruiter' must still be driver

- normal recruiter with htp_view_mode='driver' must still be recruiter

3. Guard all recruiter pages, including deep links.

Do not only check page === 'recruiter-access'.

Also block:

- recruiter-access:manage

- recruiter-access:applications

- any page that starts with recruiter-access:

Use a helper like:

const isRecruiterPage = page === 'recruiter-access' || page.startsWith('recruiter-access:');

4. Guard all driver-only pages consistently.

When effectiveRole === 'recruiter', redirect away from driver-only pages to recruiter-access.

When effectiveRole === 'driver', redirect away from recruiter pages to dashboard.

5. The view switcher must control both content and menu.

When owner/admin selects Driver:

- driver dashboard

- driver sidebar

- driver mobile nav

- driver settings view

- no recruiter menu

When owner/admin selects Recruiter:

- recruiter dashboard

- recruiter sidebar

- recruiter mobile nav

- recruiter settings view

- no driver dashboard

6. Remove all admin cross-role menu links from the normal sidebar and bottom nav.

The switcher replaces those links.

7. Add role-loading protection.

Do not render role-sensitive menus while roleLoading/viewMode is still resolving. Avoid any flash where the wrong menu appears.

8. QA must include:

- owner/admin Driver View

- owner/admin Recruiter View

- normal driver

- normal recruiter

- mobile bottom nav

- desktop sidebar

- direct URL attempts

- reload persistence

- localStorage tampering test

No database, RLS, Stripe, landing page, or unrelated feature changes.