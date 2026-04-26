# Parking Intelligence + Driver Intelligence — MVP Plan

## Scope locked

✅ **Building now (MVP):** Phases 1, 2 (list-only), 3, 6
⏸ **Deferred:** Map (Phase 2 viz), smart prompts (4), score extension into existing scorecard (5), leaderboard (7), full streak UI (8), load integration (9), advanced Pro gating (10)

This ships fast, validates the core loop (find parking → tap report → earn points → see score), and creates a clean foundation for the deferred phases.

---

## Phase 1 — Database (single migration)

**New tables (all RLS-enabled, scoped by `user_id` where applicable):**

1. **`parking_locations`** — community-owned parking pins
   - `id, name, address, latitude, longitude, type` (enum: truck_stop/rest_area/warehouse/street/private)
   - `is_paid, overnight_allowed, truck_friendly` (booleans, default false)
   - `total_spots` (nullable int), `created_by` (uuid → auth user, nullable for seeds), `created_at`
   - **RLS:** anyone authenticated can SELECT (it's a shared network); INSERT requires `auth.uid() = created_by`; UPDATE/DELETE only by creator (or admin via `is_admin`)

2. **`parking_reports`** — status updates
   - `id, parking_id, user_id, status` (available/limited/full), `safety_rating` (1–5, nullable), `notes` (nullable), `created_at`
   - **RLS:** SELECT all authenticated; INSERT own; no UPDATE/DELETE
   - **Index** on `(parking_id, created_at DESC)` for "recent reports" queries
   - **Anti-spam:** enforced in app layer (1 report/location/user/hour) — DB stays simple

3. **`parking_verifications`** — lightweight thumbs-up/down on a recent report
   - `id, parking_id, user_id, verified_status` (available/full), `created_at`
   - Same RLS pattern as reports

4. **`parking_favorites`** — saved spots (Pro feature in deferred phase)
   - `id, user_id, parking_id, created_at`
   - **RLS:** full CRUD by owner only; UNIQUE `(user_id, parking_id)`

5. **`driver_points`** — gamification ledger summary (one row per user)
   - `user_id` (PK), `total_points, weekly_points, parking_points, load_points`
   - `streak_days, last_activity_date`, `updated_at`
   - **RLS:** SELECT/UPDATE own only; row auto-created by trigger on first points award

**Seed data:** ~80 well-known truck stop locations across major US interstates (Pilot, Loves, TA, Petro flagship sites — hand-curated coordinates from public data). Lightweight enough to ship in the migration without bloat. Marked with `created_by = NULL` so they're recognizable as seeds.

**Helper function:** `award_points(_user_id, _category, _amount)` (SECURITY DEFINER) — upserts into `driver_points`, increments correct buckets, updates streak based on `last_activity_date` vs today, resets `weekly_points` if it's a new ISO week. Single source of truth for all point grants.

---

## Phase 2 — Parking Finder (`/parking`, list-only)

**New route:** `/parking` added to `App.tsx` (existing route style, lazy-loaded), nav entry as a small chip on the dashboard (NOT in bottom nav — keeps the 2+FAB+2 layout intact per project memory).

**New components:**
- `src/pages/Parking.tsx` — page shell with SEOHead + auth guard
- `src/components/parking/ParkingFinder.tsx` — search + filters + list
- `src/components/parking/ParkingCard.tsx` — card per location
- `src/components/parking/ParkingDetailSheet.tsx` — Radix Sheet (matches `LoadDetailSheet` pattern)
- `src/components/parking/AddParkingModal.tsx` — Dialog to add a new location
- `src/hooks/useParkingLocations.ts` — TanStack Query: list + search + nearby
- `src/hooks/useParkingReports.ts` — list reports for a location, submit report
- `src/hooks/useGeolocation.ts` — on-demand `navigator.geolocation.getCurrentPosition` wrapper

**UI:**
- **Top bar:** search input (city/zip/free-text → matches name/address ILIKE), "Use my location" button (one-tap, prompts permission only when tapped)
- **Filter row:** Free/Paid pills, Overnight, Truck Friendly, Confidence (High/Med/Low — derived from most recent report age + count, no DB column needed)
- **List:** ParkingCard rows with name, distance (only if user shared location), confidence badge (green/amber/red matching app theme), "Last verified Xm ago"
- **Empty state:** "No parking found nearby. [+ Add a location]" — opens AddParkingModal
- **Detail sheet** (tap a card): full details, last 5 reports, average safety rating, three big tap-friendly buttons: **Available / Limited / Full** + "Add Report" (opens form with optional notes/safety rating)

**Confidence logic (client-side, deterministic):**
- High = ≥1 report in last 2h AND ≥2 reports in last 24h
- Medium = ≥1 report in last 24h
- Low = no reports in last 24h (or never reported)

**Distance:** Haversine formula in JS when user grants location; otherwise hide distance and show "Enable location for distance".

---

## Phase 3 — 1-Tap Reports + Points

**Report submission flow (in `useParkingReports.ts`):**
1. Check anti-spam: query last report by this user for this location in the last hour. If found → toast "You already reported this lot recently" and abort.
2. Insert into `parking_reports`.
3. Call `award_points(user, 'parking', 5)` via supabase RPC.
4. Read back `driver_points` row, compute streak delta.
5. Toast: `+5 points earned 🔥 Parking streak: ${streak_days}` using sonner (matches project pattern).
6. Invalidate parking list + detail queries so confidence updates live.

**Verifications** (separate from reports — a verification is a thumbs-up on someone else's report): tap "Still available" or "Now full" inside the detail sheet → award 3 points, same anti-spam window. Lighter weight than a full report.

---

## Phase 6 — Dashboard Card (Driver Intelligence)

**New component:** `src/components/DriverIntelligenceCard.tsx`
**Placement:** top of `DashboardView.tsx`, just under date filter / above Quick Actions row. Pro-gated with the existing locked-preview pattern (free users see blurred preview + "Unlock with Pro").

**Card content (from `driver_points`):**
- Big number: total score
- Tier label (mock for v1): Bronze 0–49 / Silver 50–149 / Gold 150–399 / Platinum 400+
- Weekly delta: `+${weekly_points} this week`
- Mock percentile: deterministic hash of user_id mapped to "Ahead of N% of drivers" (60–95% range — feels real, no leaderboard data needed yet). Marked with subtle "estimate" hint in the tooltip so it's honest.
- Streak: `🔥 ${streak_days} day streak` if > 0
- Tip line that rotates based on what's lowest: "Report parking to level up faster" / "Log a load to earn +5"
- Single CTA: "View parking" → `/parking`

**Reads:** new hook `src/hooks/useDriverPoints.ts` (TanStack Query), realtime subscribe to user's own `driver_points` row so toasts and the card stay in sync.

**Existing scorecard:** unchanged. Phase 5 (extending the scorecard) is deferred — the new card lives alongside, not on top of, the existing one.

---

## Pro gating in MVP

Per your "use existing $19.99 Pro" rule and the locked-preview pattern:
- **Parking search/list/view reports:** free for all authenticated users
- **Submitting reports / earning points / Driver Intelligence card:** Pro-gated (free users see the card teaser + upgrade nudge; can browse `/parking` but tapping a report button opens the existing `ProUpgradeModal`)
- Favorites, smart prompts, load integration, advanced filters → deferred phases

This keeps the conversion funnel intact (free users get a preview of the network value, Pro unlocks participation).

---

## Files touched

**New:**
- `supabase/migrations/<ts>_parking_intelligence.sql` (5 tables + RLS + `award_points` fn + seed)
- `src/pages/Parking.tsx`
- `src/components/parking/ParkingFinder.tsx`
- `src/components/parking/ParkingCard.tsx`
- `src/components/parking/ParkingDetailSheet.tsx`
- `src/components/parking/AddParkingModal.tsx`
- `src/components/DriverIntelligenceCard.tsx`
- `src/hooks/useParkingLocations.ts`
- `src/hooks/useParkingReports.ts`
- `src/hooks/useDriverPoints.ts`
- `src/hooks/useGeolocation.ts`

**Edited (surgical, no redesign):**
- `src/App.tsx` — add `/parking` route
- `src/components/DashboardView.tsx` — mount `DriverIntelligenceCard` at top + small "Find Parking" chip near Quick Actions
- `src/integrations/supabase/types.ts` — auto-regenerated after migration

**Untouched:** bottom nav, existing scorecard, load forms, expense flow, recurring expenses, profit intel, weekly closeout, all dashboards beyond the one card insertion. No route renames, no UI redesigns.

---

## Verification after build

1. Migration applies cleanly; seeds visible in `/parking` list
2. `/parking` loads on mobile (390×844) and desktop without overflow
3. Anti-spam blocks 2nd report within 1 hour with friendly toast
4. Tapping Available awards 5 points, toast shows correct streak number
5. Driver Intelligence card on dashboard reflects new total within ~1s (realtime)
6. Free user sees Pro upgrade modal on report tap
7. Existing dashboard, loads page, expenses, recurring expenses, scorecard, settings all render unchanged
8. No TypeScript errors, no console errors on `/dashboard` or `/parking`

---

## Deferred for follow-ups (clearly out of scope right now)

- Leaflet map view on `/parking` (Phase 2 viz)
- Smart "you just parked?" prompts (Phase 4) — needs geolocation strategy refinement
- Merging Parking Intelligence into the existing Driver Scorecard (Phase 5)
- Leaderboard route (Phase 7)
- Streak detail UI / parking_streak_days separation (Phase 8)
- Load → parking outlook on load detail sheet (Phase 9)
- Favorites + advanced Pro filters (Phase 10)

I'll log each as a clean follow-up after MVP ships and you've validated the loop with real taps.