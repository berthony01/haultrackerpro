
## What's actually wrong

### 1. "I don't see profit on the dashboard"

Profit math **is** rendered (`ProfitOverview`, `ContributionMarginCard`, `TaxEstimateCard`), but the user is right that it isn't *visible*:

- These cards sit far down the dashboard — below Quick Actions, Driver Intelligence, Leaderboard, Alerts, Weekly Focus, Home Time, Date Filter, and a 6-tile stat grid. On a 434×798 viewport, the user has to scroll ~5 screens before profit appears.
- The **top stat grid** shows Est. Earnings, Actual Earnings, Loads, Miles, Deadhead, Known Difference — but **no Net Profit, Total Expenses, or Net $/Mile tile**. Eyes land there and never see profit.
- When the user has zero expenses logged, `ProfitOverview` collapses to a "Track Your True Profit" CTA — math is hidden entirely. The driver who said "I added repair, fuel, meal expenses" hasn't actually logged them as Expenses, so `ProfitOverview` shows the CTA, not numbers.
- The new **Cost Profile** isn't surfaced anywhere on the dashboard. After setting it up, the only place it's used is the per-load Profit Check inside the LoadForm. Drivers expect to see "Projected profit (using my cost profile)" on the dashboard too.

### 2. "Start for free" white screen flash while logged in

Two real causes layered together:

- **Lazy chunk failure.** Runtime errors show `Failed to fetch dynamically imported module: /src/pages/Index.tsx`. When that chunk fails to load (stale build / network blip), Suspense never resolves, the ErrorBoundary or router falls back, and the eagerly-imported Landing page (with the "Start Free — See Your Real Profit Today" hero) briefly paints behind the fallback. There is no retry logic for failed lazy imports.
- **Auth race timing.** `useAuth` initializes `loading=true`, but `supabase.auth.getSession()` and `onAuthStateChange` both call `setLoading(false)`. Between the moment `loading` flips to false and the moment `Index.tsx` chunk arrives, `<Suspense fallback={<PageFallback/>}>` shows the gray "Loading..." — which is correct. But if `onAuthStateChange` fires *first* with `session=null` (initial fire before getSession completes), `ProtectedRoute` will `<Navigate to="/" replace />` for one render, mounting Landing, and then the real session arrives and bounces back. That bounce paints Landing for ~50–200ms.

## Fix plan

### A. Make profit unmistakable on the dashboard

1. **Promote a "Net Profit" tile into the top stat grid** in `DashboardView.tsx`. Replace one slot (Avg $/Mile fallback) with a dedicated **Net Profit** tile (variant=success/danger) and a **Total Expenses** tile so the very first thing the user sees includes profit math.
2. **Move `ProfitOverview` up** — render it directly under the stat grid, before `ContributionMarginCard`, `FuelAnalyticsCard`, etc. (It already sits there; the move is to put it *above* the grid actually, so it's the first earnings card after Quick Actions on dashboard scroll. We'll place it right after the date-range filter, before the 2×3 stat grid.)
3. **Always show the math, even with zero expenses.** Update `ProfitOverview.tsx` so when `expenses.length === 0` it still renders Gross / Expenses ($0) / Net Profit (= Gross) and keeps the "Add Expense" CTA inline at the top of the same card. The user explicitly said they "don't see profit" — never hide the numbers.
4. **Add a "Projected Profit (Cost Profile)" tile** that uses the new `useCostProfile` hook. For the filtered date range, compute:
   ```
   projectedCost = computeCostProfileCPM(profile, totalMiles).cpm * totalMiles
                 + (mealsPerDay + lodgingPerDay) * estimatedDays
   projectedNet  = grossRevenue - projectedCost
   ```
   Show as a tile with a subtitle "Based on your Cost Profile" and link to Settings → Cost Profile if not configured.

### B. Fix the "Start for free" flash

1. **Add a retry wrapper for lazy imports** in `App.tsx` so a transient chunk failure auto-retries instead of falling back to public Landing. Pattern:
   ```ts
   const lazyWithRetry = (factory) => lazy(() =>
     factory().catch((err) => {
       if (!sessionStorage.getItem('chunk-retried')) {
         sessionStorage.setItem('chunk-retried', '1');
         window.location.reload();
       }
       throw err;
     })
   );
   ```
   Apply to `Index` (and the other authenticated lazy routes).
2. **Stabilize the auth race** in `useAuth.tsx`: don't flip `loading` to `false` from `onAuthStateChange` until the initial `getSession()` has resolved at least once. Track `initialResolved` so the first `onAuthStateChange(null)` event before session restoration doesn't briefly mark the user as logged-out and trigger a `<Navigate to="/" />`. Only after both calls have run does `loading` become false.
3. **Render a neutral splash, not Landing, during auth resolution.** This is already the case via `PageFallback`, but we'll make `PublicRoute` also wait for `loading=false` *and* an explicit "no session after initial resolve" signal before mounting Landing — preventing the brief Landing paint between the chunk failing and the redirect happening.

## Files to change

- `src/components/DashboardView.tsx` — promote ProfitOverview above the stat grid; add Net Profit + Total Expenses + Projected Net (Cost Profile) tiles to the top grid.
- `src/components/ProfitOverview.tsx` — always render numbers (even at $0 expenses); inline the Add Expense CTA instead of replacing the card.
- `src/hooks/useAuth.tsx` — guard `loading=false` until `getSession()` has resolved; expose an `initialResolved` flag.
- `src/App.tsx` — wrap lazy imports (at minimum `Index`) with a retry-on-chunk-failure helper; ensure `PublicRoute` waits on `initialResolved` before rendering Landing.

## Out of scope

- No DB changes. Cost Profile table and migrations from the previous round stay as-is.
- No changes to the in-form `ProfitCheckCard` (it's working).
- No new Pro gating logic.

## Acceptance check after build

- On `/dashboard` with even 1 load and 1 expense, **Net Profit** and **Total Expenses** are visible above the fold (top stat grid), and `ProfitOverview` shows the gross−expenses=net math right under the grid.
- With a Cost Profile saved, a "Projected Net (Cost Profile)" tile appears in the grid with a sane number.
- Hard-refreshing `/dashboard` while logged in never shows the Landing "Start Free" hero — it shows the gray "Loading..." splash and goes straight to the dashboard.
- If the `Index.tsx` chunk fails once, the page auto-retries instead of bouncing to Landing.
