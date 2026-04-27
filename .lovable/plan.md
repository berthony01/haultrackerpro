## Plan

### What I found
- The repeating modal is most likely caused by `src/hooks/useReleaseNotesSeen.ts` assuming the user already has a `profiles` row and only doing an `update()` when dismissing. If that row is missing, the write is effectively a no-op, and the hook also swallows the failure. In storage-hostile environments, the local cache is not reliable enough on its own, so the modal comes back on reload.
- App startup is heavier than it should be because `useAuth()` is instantiated all over the app. Right now it creates a fresh auth subscription and runs `getSession()` every time the hook is called. I found 41 call sites.
- The dashboard path also starts several eager data flows at once: `useLoads()` twice, `useExpenses()`, `useFuelLogs()`, `useLoadStops()`, `useAdmin()`, `useSubscription()` and downstream intelligence hooks. That is a lot of work during first paint.

### Phase 1 — Stabilize auth bootstrap
- Convert auth state to a shared provider/context so the app restores auth once and all consumers read the same `user/session/loading` state.
- Keep the existing `useAuth()` API shape so auth pages, protected routes, admin checks, and billing code do not have to be rewritten.
- Update `src/App.tsx` to mount the auth provider above routes.

### Phase 2 — Fix “What’s New” so it is truly once per user
- Refactor `src/hooks/useReleaseNotesSeen.ts` to consume the shared auth state.
- Stop clearing the seen state during transient auth bootstrap.
- Change the dismiss write from update-only to an upsert-safe flow so users without an existing profile row still persist `last_seen_release_id`.
- Keep the fast local cache, but make backend persistence the durable source of truth.
- Keep `src/pages/Index.tsx` modal behavior intact except for preventing repeat popups.

### Phase 3 — Reduce dashboard startup load safely
- Remove unconditional `useLoadStops()` boot-time fetching from `src/pages/Index.tsx`; only fetch stops when the user is editing/viewing load details that actually need them.
- Collapse duplicate auth/admin/subscription work where possible so the dashboard does not re-check the same state through separate hook trees.
- Tighten `src/hooks/useSubscription.ts` so it does not always do the extra backend subscription sync on every initial load when local database state is already sufficient.
- Review page-level hook activation in `src/pages/Index.tsx` so expensive data only loads when the current tab/page needs it.

### Phase 4 — Audit and verification
- Build and run tests after the refactor.
- Smoke-audit these flows: dashboard load, modal dismiss/reload, sign in/out, Pro gating, parking page, pricing upgrade return, admin route.
- Confirm no regressions to load parsing, scan rate-con flow, billing, lead magnet funnel, or release-notes content.

## Files likely to change
- `src/App.tsx`
- `src/hooks/useAuth.ts`
- `src/hooks/useReleaseNotesSeen.ts`
- `src/hooks/useSubscription.ts`
- `src/pages/Index.tsx`
- `src/hooks/useLoadStops.ts`
- Possibly one small new auth provider/context file

## Technical details
```text
Current boot path
ProtectedRoute -> useAuth()
Index -> useAuth()
useReleaseNotesSeen -> useAuth()
useAdmin -> useAuth()
useSubscription -> useAuth() + useAdmin()
multiple dashboard hooks -> useAuth()

Target boot path
AuthProvider restores session once
all hooks read shared auth state
release-notes hook waits for stable auth
markSeen persists with upsert-safe profile write
Index only mounts heavyweight queries when needed
```

This keeps the existing auth, billing, dashboard, Pro gating, and route structure in place while fixing the two issues you called out first.