
# Recruiter Role-Separation — End-to-End Audit

I traced the recruiter flow from sign up → auth redirect → role detection → navigation → route guards → recruiter pages. Below is what's wired correctly and what's still broken.

---

## ✅ What IS set up correctly

**1. Auth page (`src/pages/Auth.tsx`)**
- Driver / Recruiter role selector is present, accessible, and persisted to both URL (`?intent=recruiter`) and `sessionStorage` (`htp_auth_intent`).
- Title, helper copy, bullets, Google helper text, and switch-role footer all update with the selected role.
- Google OAuth round-trip preserves recruiter intent via `redirect_uri=…/?intent=recruiter`.

**2. Post-auth redirect (`src/App.tsx`)**
- `postAuthRedirect()` reads `?intent=recruiter` and sends the user to `/dashboard?page=recruiter-access`.

**3. Role detection (`src/hooks/useUserRole.ts`)**
- Single source of truth: a row in `recruiter_profiles` → `recruiter`, otherwise `driver`. Admins flagged separately via `useAdmin`.

**4. Sidebar (`src/components/premium/AppSidebar.tsx`)**
- Drivers see driver-only menu, recruiters see recruiter-only menu, with skeleton during `roleLoading` to avoid flash.
- Admin cross-role jump is isolated under a labeled "Admin Tools" section.

**5. Bottom nav (`src/components/BottomNav.tsx`)**
- Same role-split logic for mobile tabs and the "More" sheet. Admin Tools section is also visually isolated.

**6. Index route guards (`src/pages/Index.tsx`)**
- `handleNavigate` blocks non-admin drivers from `recruiter-access*` and blocks non-admin recruiters from driver-only pages **before** state changes.
- A secondary `useEffect` guard re-checks `page` whenever role resolves, catching URL hacks.
- `?page=recruiter-access` and legacy `?page=opportunities&view=recruiter` both deep-link to the new top-level route.
- Recruiter Access render gate: `page === 'recruiter-access' && (isRecruiter || isAdmin)`.

---

## 🛑 What is BROKEN / incomplete

### 🔴 BUG 1 — Brand new recruiter signups are immediately bounced to the driver dashboard
**Severity: high — this breaks the primary recruiter signup happy path.**

`useUserRole` decides `recruiter` ONLY when a row exists in `recruiter_profiles`. That row is created later, inside the recruiter onboarding form (`useRecruiterProfile.upsertProfile`).

Sequence for a fresh recruiter:
1. Sign up with role=recruiter → `htp_auth_intent='recruiter'`.
2. `App.tsx` redirects to `/dashboard?page=recruiter-access`.
3. `Index.tsx` sets `page='recruiter-access'`.
4. `useUserRole` resolves → `role='driver'` (no profile row yet).
5. The `useEffect` role guard (lines 420–428) sees `!isRecruiter && page==='recruiter-access'` → **forces `setPage('dashboard')`**.
6. Recruiter lands on the driver dashboard, with the driver sidebar, and never reaches the onboarding form.

**Fix:** treat "recruiter intent" or "recruiter signup in progress" as a recruiter for routing purposes until they either complete or abandon onboarding. Options:
- Make `useUserRole` also return `isRecruiter=true` when `sessionStorage.htp_recruiter_intent==='1'` or when `htp_auth_intent==='recruiter'` is still set, OR
- In Index.tsx guards, allow `page==='recruiter-access'` when the user has recruiter intent flagged, even if no profile row exists yet (so they can reach `RecruiterOnboarding`).
- Cleanest: when a recruiter signup completes, write a stub `recruiter_profiles` row (verification_status='pending') so role detection is correct from minute one. This also matches the existing `resolveState()` 'pending' branch in `RecruiterAccessPage`.

### 🟠 BUG 2 — Header brand strip always says "Load & Pay Manager"
`src/pages/Index.tsx` line 551: the mobile header subtitle is hard-coded to `Load & Pay Manager` even for recruiters. The sidebar already swaps to "Recruiter Console"; the mobile header should too.

### 🟠 BUG 3 — Driver-only dashboard widgets still mount for recruiters (admin path)
For an admin viewing `page='dashboard'`, the `<DashboardView>` and the "Role path card" (lines 600–631) render with driver semantics ("Track Profit", "Find Opportunities"). For a normal recruiter the guards redirect, so this is mostly an admin-UX issue, but the role-path card explicitly nudges into driver flows even when `role==='recruiter'`. It should be gated to `role==='driver'`.

### 🟠 BUG 4 — `onBack` from Recruiter Access for a pure recruiter loops back to itself
Line 764: `onBack={() => setPage(isRecruiter && !isAdmin ? 'recruiter-access' : 'dashboard')}`. For a non-admin recruiter the back button is a no-op (already on recruiter-access). It should either be hidden for pure recruiters or route to a sensible recruiter sub-view.

### 🟡 BUG 5 — `MilestoneNudges` and `SmartReminders` shown on recruiter dashboard (admin only, but visually wrong)
Same dashboard render block doesn't check role. Low priority because non-admin recruiters never reach `page='dashboard'`, but worth gating for admins acting as recruiters.

### 🟡 BUG 6 — `?page=opportunities` is still reachable by recruiters who type the URL
`handleNavigate` blocks it, but the initial-mount `useEffect` (lines 184–217) directly calls `setPage('opportunities')` from the query string without consulting role. Then the role-guard `useEffect` catches it and redirects, so the user sees a brief flash of the driver Opportunities page. Move the role check into the URL-parsing effect, or defer URL routing until `roleLoading===false`.

### 🟡 BUG 7 — Settings "back" assumes binary role
Line 768: `onBack={() => setPage(isRecruiter ? 'recruiter-access' : 'dashboard')}`. An admin viewing as driver who opens Settings should go back to `dashboard`. Current logic is fine for pure roles but quietly wrong for admins. Not blocking.

### 🟢 Minor — Auth role selector doesn't surface the "you'll need approval" reality
A recruiter who signs up expects to "start posting." They actually need: profile onboarding → admin approval → billing. The auth helper text could set that expectation, otherwise the first-run experience feels broken even when wired correctly.

---

## Recommended fix order

1. **Bug 1** (recruiter signup redirect loop) — blocks the entire recruiter onboarding funnel. Fix first.
2. **Bug 2** (mobile header subtitle) — 1-line fix, eliminates the "I'm in the wrong app" feeling.
3. **Bugs 4 & 6** (back-button no-op + brief Opportunities flash) — small polish on routing edges.
4. **Bugs 3, 5, 7** (admin-as-recruiter UX) — only impacts admin testing, low urgency.
5. **Minor** — add a one-line "Requires approval before posting" note to the recruiter auth helper.

---

## Technical scope (for implementation)

- `src/hooks/useUserRole.ts`: extend with `intentRecruiter` derived from sessionStorage so guards don't trap fresh signups.
- `src/pages/Index.tsx`:
  - Update `driverOnlyPages` / `handleNavigate` to honor `intentRecruiter`.
  - Gate URL-parsing effect on `!roleLoading`.
  - Make header subtitle role-aware.
  - Gate role-path card + MilestoneNudges + SmartReminders to `role==='driver'`.
  - Fix Recruiter Access `onBack` for pure recruiters.
- `src/pages/Auth.tsx`: optional one-line helper update for recruiter expectations.
- No DB schema, RLS, billing, Stripe, or recruiter feature logic changes.

Would you like me to proceed with these fixes in priority order (1 → 7), or only the high-severity ones (Bugs 1, 2, 4, 6)?
