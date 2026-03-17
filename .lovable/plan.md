

## Plan: Use Drop-off Date for Weekly/Monthly Calculations

### Understanding

You're right — in trucking, what matters for pay week grouping is when the load was **delivered** (drop-off), not when it was picked up. If you pick up Saturday but deliver Sunday, that load belongs to the Sunday week, not Saturday's.

### Current Problem

The database only has one date column: `load_date` (used as pickup date). All filtering, weekly summaries, scorecard, reports, and dashboard calculations use this single date. There is no drop-off date field.

### Changes Required

#### 1. Database Migration — Add `dropoff_date` column to `loads` table

- Add a nullable `dropoff_date` date column
- Default existing rows: set `dropoff_date = load_date` so nothing breaks for historical data
- New loads will let users optionally set a different drop-off date

#### 2. `src/components/LoadForm.tsx` — Add drop-off date field

- Add a "Drop-off Date" input below the existing "Load Date" (rename label to "Pickup Date")
- Default drop-off date to the pickup date value when creating a new load
- Keep it optional — if blank, it falls back to pickup date

#### 3. `src/hooks/useLoads.ts` — Filter by `dropoff_date`

- Change the date range query to filter on `dropoff_date` instead of `load_date`
- Order by `dropoff_date` descending
- Use coalesce logic: `dropoff_date` if set, otherwise `load_date`

#### 4. Update all weekly/monthly grouping logic to use `dropoff_date`

Files affected:
- **`src/lib/loadUtils.ts`** — `getWeekSummaries`, `getCurrentWeekLoads`, `getCurrentMonthLoads` — use `dropoff_date ?? load_date`
- **`src/components/PerformanceTrends.tsx`** — week/month filtering
- **`src/components/MonthlySummary.tsx`** — monthly grouping
- **`src/hooks/useDriverScorecard.ts`** — last 30 days, this week/last week
- **`src/components/ReportsView.tsx`** — date range filtering
- **`src/components/LoadCard.tsx`** — display both dates when different
- **`src/components/LoadDetailSheet.tsx`** — show pickup and drop-off dates

Each location simply changes `l.load_date` → `l.dropoff_date ?? l.load_date` for grouping/filtering purposes.

#### 5. Display updates

- **LoadCard**: Show "Picked up Mon · Delivered Tue" when dates differ
- **LoadDetailSheet**: Show both Pickup Date and Drop-off Date
- **LoadsListView**: Sort and summary use drop-off date

### What stays the same

- No changes to expenses, fuel logs, Stripe billing, settings, navigation, SEO pages, or any public pages
-