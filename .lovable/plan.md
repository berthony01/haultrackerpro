
# Phase A + Phase B Fix Plan — Parking & Driver Intelligence MVP

Scope: production-safety fixes only. No new features, no UI redesign, no pricing/route changes, no untouched edge functions.

---

## PHASE A — Critical Fixes

### A1. Fix Pro gating on `DriverIntelligenceCard`
**File:** `src/components/DriverIntelligenceCard.tsx`
- Add `ProUpgradeModal` import + local `showUpgrade` state.
- Change Parking button `onClick`: if `!hasAccess` → open `ProUpgradeModal` (featureName: "Driver Intelligence rewards"). If `hasAccess` → navigate to `/parking` as today.
- Lock icon stays. No visual redesign.
- `/parking` itself remains reachable from bottom nav / direct URL for free users (view-only).

### A2. Fix `AddParkingModal` Pro gating
**Files:** `src/components/parking/ParkingFinder.tsx`, `src/components/parking/AddParkingModal.tsx`
- In `ParkingFinder`, change both "Add a parking spot" buttons (the empty-state one and the bottom one): if `!hasAccess` → `setShowUpgrade(true)` instead of `setShowAdd(true)`. Add a small `Lock` icon next to the button label for free users (no layout change).
- Defense-in-depth in `AddParkingModal.handleSubmit`: if not Pro/trialing, show toast + return early. (Pass `hasAccess` prop from `ParkingFinder`, or read from `useSubscription` directly inside the modal — simpler: read inside modal so signature unchanged.)
- RLS already blocks insert of `created_by != auth.uid()`; this is purely a tier gate, enforced both client-side and (after migration) backstopped by application logic. No new RLS needed for this since we don't have a server-side "is_pro" check available in RLS without coupling to `subscriptions`. Document this limitation in the audit report; the realistic risk surface is low (a bypass user would only be inserting locations to a community table they can already read).

### A3. DB-level anti-spam for `parking_reports`
**Migration (new):**
- Add generated column `report_hour_bucket timestamptz GENERATED ALWAYS AS (date_trunc('hour', created_at)) STORED`.
- Pre-clean: `DELETE` duplicate rows keeping the earliest per `(parking_id, user_id, report_hour_bucket)` using `ctid`-based dedupe, only if duplicates exist.
- Add `CREATE UNIQUE INDEX IF NOT EXISTS parking_reports_one_per_hour ON public.parking_reports (parking_id, user_id, report_hour_bucket);`
- In `useParkingReports`, catch unique-violation Postgres code `23505` and surface "You already reported this lot in the last hour" instead of raw error. Keep the existing client-side pre-check as a UX optimization.

---

## PHASE B — High-Value Fixes

### B4. `Badge` forwardRef
**File:** `src/components/ui/badge.tsx`
- Convert `Badge` to `React.forwardRef<HTMLDivElement, BadgeProps>`. Set `displayName = "Badge"`. Preserve all variants/classnames/exports.

### B5. Enable realtime for `driver_points` & `parking_reports`
**Migration (new):** Idempotent block:
```sql
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_points;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.parking_reports;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.driver_points REPLICA IDENTITY FULL;
ALTER TABLE public.parking_reports REPLICA IDENTITY FULL;
```
- Verify `useDriverPoints` cleanup already calls `supabase.removeChannel(channel)` on unmount — confirmed in current code; no change needed.

### B6. Wire load points
**File:** `src/pages/Index.tsx` (only place `addLoad.mutate` is called)
- In the `addLoad.mutate(data, { onSuccess: ... })` callback, after the existing onSuccess work, fire-and-forget:
  ```ts
  supabase.rpc('award_points', { _user_id: user.id, _category: 'load', _amount: 5 })
    .then(({ error }) => { if (error) console.warn('award_points(load) failed', error); });
  ```
  (Only on create path — `updateLoad` is untouched, so edits never award points.)
- Wrap in `try/catch` no-op; never block load save. No success toast change (avoid misleading copy).
- Gate to Pro/trialing only (matches DriverIntelligenceCard messaging) — skip RPC if `!isPro && !isTrialing`.

### B7. Idempotent seed safety for `parking_locations`
**Migration (new):**
- Add unique index: `CREATE UNIQUE INDEX IF NOT EXISTS parking_locations_dedupe ON public.parking_locations (lower(trim(name)), round(latitude::numeric, 5), round(longitude::numeric, 5));`
- Pre-clean duplicates only if any exist (keep earliest by `created_at`, using `ctid`).
- Future seed inserts must use `ON CONFLICT DO NOTHING`. (No new seed in this migration; constraint just protects future runs.)
- Does not delete user-added rows that are unique.

### B8. Polish
- `src/components/parking/ParkingCard.tsx`: remove unused `Heart` import.
- `src/components/parking/AddParkingModal.tsx` validation in `handleSubmit`:
  - `const trimmed = name.trim();`
  - Reject if `trimmed.length < 3` → toast "Name must be at least 3 characters"
  - Reject if `trimmed.length > 64` → toast "Name must be 64 characters or less"
  - Reject if `/^\s*$/.test(name)` (already covered by length)
  - Use `trimmed` in the insert.

---

## Files to be modified
- `src/components/DriverIntelligenceCard.tsx`
- `src/components/parking/ParkingFinder.tsx`
- `src/components/parking/AddParkingModal.tsx`
- `src/components/parking/ParkingCard.tsx`
- `src/components/ui/badge.tsx`
- `src/hooks/useParkingReports.ts`
- `src/pages/Index.tsx` (single small `onSuccess` addition for `addLoad`)

## Migrations to be added (one combined SQL migration is fine)
1. `parking_reports` hour-bucket generated column + dedupe + unique index.
2. `parking_locations` dedupe unique index (+ safe pre-clean).
3. `supabase_realtime` publication add for `driver_points` and `parking_reports` + `REPLICA IDENTITY FULL`.

## Out of scope (deferred per instruction)
- Leaflet map, leaderboard, Driver Scorecard merge, smart prompts, Parking Outlook on loads, favorites UI, pricing changes, edge function changes.

## Post-implementation verification (will be reported)
- TS check passes; no new console warnings; `Badge` ref warning gone.
- Free user: Parking button on dashboard → upgrade modal; Add Parking button → upgrade modal; report buttons → upgrade modal (already in place).
- Pro/trial user: routes to `/parking`, can add spots, can submit reports, earns points.
- Load create → +5 load points (Pro/trial only); load edit → no points.
- DB unique index blocks 2nd report within same hour even if client check is bypassed.
- Existing load/expense/recurring/scorecard/pricing flows untouched.
