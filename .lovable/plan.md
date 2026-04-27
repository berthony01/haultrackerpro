# Fix: Platform won't load — realtime channel crash on /dashboard

## Root cause

Console shows a hard error caught by `ErrorBoundary`, producing the "Something went wrong / Reload App" screen on every dashboard load:

```
Error: cannot add `postgres_changes` callbacks for realtime:driver-points-<uid> after `subscribe()`.
    at useDriverPoints (src/hooks/useDriverPoints.ts)
```

Why it happens now:

1. The new `AuthProvider` (in `src/hooks/useAuth.tsx`) calls `setUser(...)` from **both** `onAuthStateChange` *and* `getSession().then(...)` during initial mount. Each call produces a **new `User` object reference** (Supabase returns fresh objects).
2. `useDriverPoints` has `useEffect(..., [user, qc])` — so the effect tears down and re-creates the channel rapidly during initial load.
3. Inside the effect, `supabase.channel('driver-points-<uid>')` is called with the **same channel name**. Supabase's client de-duplicates by name and returns the **existing channel** that is already past `.subscribe()` (the previous cleanup's `removeChannel` is async and hasn't completed). Calling `.on('postgres_changes', ...)` on an already-subscribed channel throws.
4. The throw bubbles up, the ErrorBoundary catches it, and the user sees the reload loop. Even after reload, the same race fires again.

This is the only `.channel(` call site in the codebase, so the fix is isolated.

## Plan

### 1. Make `useDriverPoints` resilient to remounts

`src/hooks/useDriverPoints.ts`:
- Depend on **`user?.id`** (a stable string) instead of the whole `user` object, so the effect only re-runs when identity actually changes — not on every fresh User object reference.
- Use a **unique channel name per mount** (e.g. include a `crypto.randomUUID()` suffix) so a stale, not-yet-removed channel can never be returned by `supabase.channel(name)`.
- Guard the `.on(...)` registration in a try/catch as belt-and-suspenders so a transient realtime hiccup can never take down the entire dashboard via the ErrorBoundary again.
- Keep cleanup via `supabase.removeChannel(channel)`.

### 2. Stabilize `AuthProvider` updates

`src/hooks/useAuth.tsx`:
- In both the `onAuthStateChange` handler and the `getSession()` resolver, only call `setUser` / `setSession` when the **id / access_token actually changed** (compare against the previous value via the functional setter). This prevents redundant re-renders and avoids handing downstream effects new object references for the same logical user.
- Keep the existing "subscribe first, then getSession" ordering.

### 3. Verify

- Reload the dashboard and confirm:
  - No `postgres_changes after subscribe()` error in the console.
  - No ErrorBoundary "Reload App" screen.
  - Driver points still update in realtime when parking/load actions run (`useParkingVerifications`, `useParkingReports` invalidate the same query key, so stale data still refreshes even if realtime is briefly unavailable).
- Run the test suite to confirm no regressions.

## Out of scope

- No other realtime channels exist in the codebase, so no other hooks need changing.
- No changes to Stripe, Pro gating, lead magnet, admin, auth flow, or dashboard data fetching.
- The "What's New" upsert fix from the previous turn stays as-is.
