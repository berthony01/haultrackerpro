# Phase C — Parking Verifications + Driver Leaderboard

## 0. Critical fix first (blocking the page right now)

Runtime error on `/parking`: **`Uncaught TypeError: Component is not a function`**.

Root cause: in Phase B we wrapped `ProUpgradeModal` and `AddParkingModal` in `React.forwardRef` even though nothing forwards a ref to them. They are rendered directly as page children, not as Radix triggers, and the `forwardRef` exotic object is what's blowing up the renderer in this environment.

**Fix:** revert both back to plain function components (keep all the rest of the Phase B work — gating, validation, etc.). Net change is just removing the `forwardRef` wrapper and the unused `_ref` arg.

Files: `src/components/ProUpgradeModal.tsx`, `src/components/parking/AddParkingModal.tsx`.

This must ship in the same change as Phase C so the leaderboard work isn't blocked behind a broken page.

---

## Phase C1 — Parking verification system

### Database migration (new)
1. Add `verification_hour_bucket timestamptz NOT NULL DEFAULT now()` to `parking_verifications` (default avoids breaking existing rows).
2. Trigger `set_parking_verification_hour_bucket` (BEFORE INSERT) → `NEW.verification_hour_bucket = date_trunc('hour', COALESCE(NEW.created_at, now()))` (mirrors the existing `set_parking_report_hour_bucket`).
3. Backfill existing rows: `UPDATE parking_verifications SET verification_hour_bucket = date_trunc('hour', created_at)`.
4. Unique index `parking_verifications_one_per_hour` on `(parking_id, user_id, verification_hour_bucket)`.
5. Add `parking_verifications` to `supabase_realtime` publication (idempotent guard).

No RLS changes — existing policies (`Anyone authenticated can view verifications`, `Users can submit own verifications`) are correct.

### New hook: `src/hooks/useParkingVerifications.ts`
- `useRecentParkingVerifications()` — last 24h across all locations (mirror of `useRecentParkingReports`), used for confidence + card meta.
- `useParkingVerificationsForLocation(parkingId)` — last 20 for a location, used inside the detail sheet.
- `useSubmitParkingVerification()` — inserts into `parking_verifications` with `verified_status` ∈ `available|limited|full`, then calls `award_points(_user_id, 'parking', 3)`. Handles `23505` with friendly toast: *"You already verified this location recently."* Success toast: *"+3 points earned · Parking verified"*. Invalidates: `parking-verifications`, `parking-reports`, `driver-points`, `driver-leaderboard`.

### `ParkingDetailSheet` updates
- New section under "Recent reports": **"Verify this spot"** with three buttons (`Still Available` / `Still Limited` / `Still Full`), styled exactly like the existing 1-tap report row but smaller (h-12 instead of h-14) so it reads as a secondary action.
- Free users: lock icons → click opens `ProUpgradeModal` (use the same `onUpgrade` callback already plumbed in).
- Pro/trial: submits verification, awards +3.
- Show "Latest verification: <Status> · 12 min ago" line above the buttons when there's a recent verification for this location.

### Confidence logic update (`computeConfidence` in `useParkingLocations.ts`)
Extend signature to accept verifications:
```
computeConfidence(reports, verifications, parkingId)
```
- Treat verification entries as fresh signals just like reports (status maps directly).
- Fresh window stays at 2h for `high`, 24h for `medium`, otherwise `low`.
- "Available" / "Limited" fresh signals → boost confidence; "Full" fresh signals don't boost availability confidence (same simple bucket logic — no AI prediction).
- `lastReportAt` becomes `lastSignalAt` (max of report and verification timestamps).

Update all callers (`ParkingCard`, `ParkingFinder`).

### `ParkingCard` metadata
- Show "Last verified <X> ago" using the new combined `lastSignalAt`.
- If the latest signal is a verification, prefix it with the status word (e.g., "Verified Available · 12 min ago").

---

## Phase C2 — Leaderboard

### New SQL function: `get_weekly_driver_leaderboard(_limit int default 10)`
- `SECURITY DEFINER`, `STABLE`, `SET search_path = public`.
- Returns: `user_id uuid, weekly_points int, total_points int, parking_points int, load_points int, streak_days int, tier text, rank int, masked_display_name text`.
- `tier` computed in SQL: ≥400 Platinum, ≥150 Gold, ≥50 Silver, else Bronze.
- `masked_display_name`: `COALESCE(NULLIF(trim(p.display_name), ''), 'Driver #' || substr(d.user_id::text, length(d.user_id::text) - 3))`. Never returns email.
- Ordering: `weekly_points DESC, total_points DESC, last_activity_date ASC NULLS LAST` — handles ties exactly per the spec.
- Filter: only rows where `weekly_points > 0` OR `user_id = auth.uid()` (so a brand-new user can still see themselves).
- Grant `EXECUTE ... TO authenticated` only.
- Privacy: only joins `profiles.display_name` (already client-visible to that user under existing RLS). No emails, no other profile fields.

### New hooks: `src/hooks/useDriverLeaderboard.ts`
- `useDriverLeaderboard(limit = 10)` → `supabase.rpc('get_weekly_driver_leaderboard', { _limit: limit })`. 60s `staleTime`.
- `useMyLeaderboardRank()` — convenience selector that returns the current user's row (or null) + the top score.

### New component: `src/components/DriverLeaderboardCard.tsx`
Placement on dashboard: **directly below** `DriverIntelligenceCard`, in the same Quick Insights area in `DashboardView.tsx`. Reuses existing `Card`/`Badge`/`Trophy` styling — no redesign.

Contents:
- Title row: "Top Drivers This Week" + small "Updated weekly" hint.
- Top 5 rows: rank, masked name, tier badge (color from existing `tierFor`), weekly points, source label (`parking_points > load_points * 1.5` → "Parking", `load_points > parking_points * 1.5` → "Loads", else "Balanced").
- Current user highlighted with `bg-primary/10` row background if in top 5.
- If current user not in top 5: bottom row "Your rank · #X · Yp" using `useMyLeaderboardRank`.
- Empty states per spec.

### Driver Scorecard "Weekly Leaderboard" section
Scorecard is rendered inside `src/components/DriverScorecard.tsx` (route is `page === 'scorecard'` inside `Index.tsx`, not a separate URL route). Add a new bottom section reusing `DriverLeaderboardCard` configured with `limit={10}`, plus the explanatory copy from the spec. No layout/structural changes to the scorecard itself.

---

## Phase C3 — DriverIntelligenceCard enhancement

Inside the existing card (don't change its frame), append a tiny stats row when leaderboard data is available:
- "Your weekly rank: #X" (hidden if rank unknown)
- "Top driver: Yp" (hidden if no leaderboard data)
- Tip line gains a "+3 verify parking" alternative when user already has parking points but no recent verifications.

If queries return empty, hide gracefully — no broken layout.

---

## Phase C4 — Feedback loop wiring

Already covered by hook invalidations:
- `useSubmitParkingVerification` invalidates `driver-points` + `driver-leaderboard` + parking queries.
- `useSubmitParkingReport` (existing) — add `driver-leaderboard` to its invalidation set.
- Load creation in `src/pages/Index.tsx` already calls `award_points('load', 5)`. Add a `qc.invalidateQueries({ queryKey: ['driver-leaderboard'] })` next to the existing `driver-points` invalidation. No duplicate awards: stays inside the `addLoad` success branch only (no edits trigger it).

---

## Phase C5 — Verification checklist (post-implementation)

I will verify and report:
1. `/parking` no longer throws `Component is not a function`.
2. Free user: leaderboard visible, parking visible, verify buttons show lock + open `ProUpgradeModal`, no points awarded.
3. Pro/trial: verify submits, +3 toast fires, second verify within the hour shows the friendly duplicate message, confidence/last-verified updates.
4. Leaderboard ordering ties resolved correctly (weekly → total → oldest activity).
5. Masked names never leak emails (RPC inspection).
6. Load creation still awards +5 once; leaderboard refreshes.
7. Regression: dashboard, parking reports, add parking gating, scorecard tab, bottom nav, pricing, Stripe — all untouched.
8. `tsc --noEmit` clean.

---

## Out of scope (explicit)

Not building: Leaflet map, "you just parked" prompts, load Parking Outlook, full scorecard redesign, pricing/Stripe edits, edge function edits, favorites UI.

## Files touched

**Modified:** `src/components/ProUpgradeModal.tsx`, `src/components/parking/AddParkingModal.tsx`, `src/components/parking/ParkingDetailSheet.tsx`, `src/components/parking/ParkingCard.tsx`, `src/components/parking/ParkingFinder.tsx`, `src/hooks/useParkingLocations.ts` (extend `computeConfidence`), `src/hooks/useParkingReports.ts` (add leaderboard invalidation), `src/components/DriverIntelligenceCard.tsx`, `src/components/DashboardView.tsx` (mount leaderboard card), `src/components/DriverScorecard.tsx` (mount leaderboard section), `src/pages/Index.tsx` (leaderboard invalidation on load create).

**New:** `src/hooks/useParkingVerifications.ts`, `src/hooks/useDriverLeaderboard.ts`, `src/components/DriverLeaderboardCard.tsx`, one SQL migration (verification anti-spam + realtime + leaderboard RPC).

**Untouched:** routes, `App.tsx`, `BottomNav.tsx`, pricing, Stripe code, edge functions, `subscriptions` table, `parking_locations` schema.
