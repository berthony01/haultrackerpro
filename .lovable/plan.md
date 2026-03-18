

## Plan: Complete Drop-off Date Logic Correction

### Problem

Several files still use `load_date` (pickup date) for period-based filtering instead of the drop-off date. Additionally, the database query in `useLoads.ts` filters on `dropoff_date` directly, which will exclude legacy loads where `dropoff_date` is `NULL`.

### Files & Changes

#### 1. `src/hooks/useLoads.ts` — Fix database query for NULL dropoff_date

The query currently does `.order('dropoff_date')` and `.gte('dropoff_date', ...)`. Legacy loads with `NULL` dropoff_date will be excluded from date-filtered queries. Fix by using `coalesce` via a raw filter or switching to client-side filtering after fetching, OR by ordering/filtering on `load_date` as fallback. The safest approach: fetch all loads without server-side date filtering (loads are user-scoped and bounded), then filter client-side using `getEffectiveDate`. This avoids the NULL problem entirely.

- Remove `.gte('dropoff_date', ...)` and `.lte('dropoff_date', ...)` server-side filters
- Change `.order('dropoff_date', ...)` to `.order('load_date', { ascending: false })` (safe default sort)
- Move date filtering to the consumer side (already done in DashboardView, etc.)

Alternatively, keep server-side filtering but use `.or()` to handle NULL: filter on `dropoff_date` OR `load_date` when `dropoff_date` is null. This is more complex in Supabase JS. The simplest safe fix: fetch all user loads, sort client-side.

#### 2. `src/hooks/useSmartAlerts.ts` — 3 instances of `l.load_date`

- Line 31: `filterByRange` function uses `l.load_date` → change to use `getEffectiveDate(l)`
- Line 106: `last30Loads` filter uses `l.load_date` → change to `getEffectiveDate(l)`
- Line 140: missing pay filter uses `l.load_date` → change to `getEffectiveDate(l)`
- Add import for `getEffectiveDate`

#### 3. `src/components/ReportsView.tsx` — Line 159

- The "Export Week" button filters loads using `l.load_date` → change to `getEffectiveDate(l)`
- Add `getEffectiveDate` to the existing import from `@/lib/loadUtils`

#### 4. `src/pages/Index.tsx` — Line 216

- Load duplication sets `load_date` on the duplicate. This is fine — it's setting form data for a new load, not period assignment. No change needed.

### What's already correct

- `DashboardView.tsx` — already uses `getEffectiveDate`
- `PerformanceTrends.tsx` — already uses `getEffectiveDate`
- `PerformanceCharts.tsx` — already uses `getEffectiveDate`
- `MonthlySummary.tsx` — already uses `getEffectiveDate`
- `useDriverScorecard.ts` — already uses `getEffectiveDate`
- `WeeklyFocusCard.tsx` — uses `getCurrentWeekLoads` which uses `getEffectiveDate`
- `WeeklyCloseout.tsx` — uses `getCurrentWeekLoads` which uses `getEffectiveDate`
- `LoadForm.tsx` — form field handling, not period logic
- `loadUtils.ts` exports — all use `getEffectiveDate`

### Summary

3 files need changes, all are small targeted fixes:
1. **`useLoads.ts`** — fix NULL-safe query
2. **`useSmartAlerts.ts`** — 3 lines using `load_date` for period filtering
3. **`ReportsView.tsx`** — 1 line using `load_date` in week export filter

