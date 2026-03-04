

## Plan: Make Landing Page the Root Route

### Current State
- `/` → ProtectedRoute → Index (dashboard) — unauthenticated users redirect to `/landing`
- `/landing` → AuthRoute → Landing

### Changes

**1. `src/App.tsx`** — Swap routing:
- `/` renders Landing inside a new `PublicRoute` wrapper (shows Landing for unauthenticated, redirects to `/dashboard` for authenticated)
- `/dashboard` becomes the new ProtectedRoute for Index (the app dashboard)
- `/landing` redirects to `/` via `<Navigate to="/" replace />`
- `ProtectedRoute` redirects unauthenticated users to `/` instead of `/landing`
- `AdminRoute` redirects to `/dashboard` instead of `/`

**2. `src/pages/Landing.tsx`** — No changes needed (no self-referencing navigation)

**3. `src/pages/Features.tsx`** — Change `navigate('/landing')` → `navigate('/')`

**4. `src/pages/Pricing.tsx`** — Change `navigate('/landing')` → `navigate('/')`

**5. Internal nav links** — Any other references to `/landing` across the codebase will be updated to `/` (the search found only Features.tsx and Pricing.tsx).

### Route Table After Change

| Path | Component | Guard |
|------|-----------|-------|
| `/` | Landing | Public (auth users → `/dashboard`) |
| `/landing` | Redirect → `/` | None |
| `/dashboard` | Index | ProtectedRoute (unauth → `/`) |
| `/auth` | Auth | AuthRoute |
| `/admin` | Admin | AdminRoute |
| All others | Unchanged | Unchanged |

