# Phase 23B — Finish Date Range Consolidation

## Audit findings

Duplicated date-range logic still lives in two places:

**`src/components/DateRangeFilter.tsx`** (lines 5-42, 83-88)
- Inline `presets` array rebuilds `startOfWeek/endOfWeek/startOfMonth/endOfMonth/startOfQuarter/endOfQuarter/startOfYear/endOfYear/subWeeks/subMonths/subQuarters/subYears` for all 8 named presets.
- Inline "Showing: …" label built from `format(...)` instead of `formatShowingRange`.
- Already respects `week_start_day` via `useUserSettings` + `weekStartDayToNumber`. ✅

**`src/components/DashboardView.tsx`** (lines 75-85, 123-147, 229-234, 252-288)
- Local `getPresetRange(key, weekStartsOn)` returns `{start: Date, end: Date}` for `this_week / last_week / this_month / last_month / this_year`.
- Local `getShowingLabel(...)` rebuilds the same ranges to emit "Showing: …".
- Local `prevRange` useMemo rebuilds previous-period math by hand.
- `thisWeekLoadCount` (line 229) recomputes the current week independently.
- Dashboard preset set differs from filter: includes `this_year` + `all` + `custom`, omits quarters / last_year / ytd. This is intentional and stays dashboard-local.

**Other files — clean, no change needed**
- `ReportsView.tsx`, `LoadsListView.tsx`: no date-range preset math (Reports just consumes `getWeekSummaries` with `weekStartsOn`, already fixed in Phase 23).
- `WeeklyCloseout.tsx`: uses `startOfWeek/endOfWeek` once with `weekStartsOn` for the current pay-week snapshot — that's a single-purpose anchor, not preset math. Leave it.
- `reportRanges.ts` already exports `getPresetRange`, `formatShowingRange`, `getPreviousComparisonRange`, `isDateInRange`, `validateCustomRange`. ✅
- Existing tests: `reportRangesPresets.test.ts`, `financialConsistency.test.ts`, `dateRangeFilter.test.tsx`, `dashboardShowingAndCancelled.test.tsx`, `dashboardTrendPct.test.ts`.

No unexpected calculation dependency surfaced — safe to refactor.

## Implementation

### 1. `src/components/DateRangeFilter.tsx`

Replace the inline `presets` array with thin wrappers around `getPresetRange` from `reportRanges.ts`. Keep the same visible labels, button order, `aria-pressed` logic, and `onRangeChange(from?, to?)` contract.

- Import `getPresetRange, formatShowingRange, type RangePresetKey` from `@/lib/reportRanges`.
- Build presets as `[{ label, key: RangePresetKey | 'all_time' }]`. `'all_time'` stays local (helper has no `all_time` key) and emits `(undefined, undefined)`.
- Active-pill detection: compare `currentRange.from/to` against `getPresetRange(key, wso).from/to` strings (no more Date→string conversion in the component).
- Replace inline "Showing: …" construction with `formatShowingRange({ from, to })`.
- Drop unused date-fns imports.
- Keep `validateCustomRange` flow untouched.
- Preserve all classNames and DOM structure exactly.

### 2. `src/components/DashboardView.tsx`

Minimal surgical swap — do not change the dashboard preset set, custom-range UI, or KPI logic.

- Import `getPresetRange as getSharedPresetRange, getPreviousComparisonRange, formatShowingRange, type RangePresetKey` and `parseISO` (already imported).
- Rewrite local `getPresetRange(key, wso)` so that for keys shared with the helper (`this_week, last_week, this_month, last_month`) it delegates to `getSharedPresetRange` and converts the returned `from/to` ISO strings to `Date` via `parseISO(from)` and `endOfDay(parseISO(to))`-equivalent (use `parseISO(to + 'T23:59:59')` or just reuse end-of-period Date from existing date-fns — simplest: keep `this_year` and the `default` branch local, and for the four shared keys return `{ start: parseISO(r.from), end: parseISO(r.to) }` plus an explicit `endOfDay`-style adjustment **only if needed by `isWithinInterval`**. Verify by reading the helper's `to` value — it is already `endOf*`-formatted as `yyyy-MM-dd` (midnight). To preserve inclusive comparisons we'll pass `end: parseISO(r.to + 'T23:59:59.999')`.
- `this_year` and the `default` fallback stay local with a comment: `// dashboard-only key; reportRanges has no 'this_year' preset`.
- `getShowingLabel`: for shared keys delegate to `formatShowingRange(getSharedPresetRange(key, wso))`. Keep local handling for `'all'` (returns `'Showing: All Time'`), `'custom'`, and `'this_year'` with a comment noting they are dashboard-specific.
- `thisWeekLoadCount` (line 229): replace inline `startOfWeek/endOfWeek` with `getSharedPresetRange('this_week', weekStartsOn)` + `isDateInRange`.
- `prevRange` useMemo: for keys covered by `getPreviousComparisonRange` (`this_week, last_week, this_month, last_month`), delegate; convert result to `{start: Date, end: Date}`. `this_year` and `custom` stay local with comments — the helper doesn't expose `this_year`, and the custom branch needs the same equal-length logic the helper provides for `'custom'` so we **can** delegate `custom` too by building a synthetic `DateRange` and calling `getPreviousComparisonRange('custom', ...)`. Use that to remove the custom branch as well.
- Drop now-unused date-fns imports (`startOfMonth, endOfMonth, subWeeks, subMonths, subYears, differenceInCalendarDays, addDays` once everything routes through the helper for the four shared keys + custom — keep `startOfWeek/endOfWeek/startOfYear/endOfYear` for the `this_year` and `default` branches).

### 3. Tests

- **`src/test/reportRangesPresets.test.ts`** — already covers Mon/Sun anchor 2026-05-27 + custom previous range. Extend with assertions for `this_month` / `last_month` at the same anchor.
- **New `src/test/dashboardDateRangeParity.test.ts`** — for anchor 2026-05-27, both `weekStartsOn ∈ {0,1}`, assert Dashboard `getPresetRange(key, wso)` produces the same `from/to` (as `yyyy-MM-dd`) as `reportRanges.getPresetRange(key, wso)` for `this_week, last_week, this_month, last_month`.
- **New showing-label parity test** (same file) — `getShowingLabel('this_week', wso)` === `formatShowingRange(getPresetRange('this_week', wso))` for the four shared keys.
- Existing `financialConsistency.test.ts`, `dateRangeFilter.test.tsx`, `dashboardShowingAndCancelled.test.tsx` must remain green (regression guard).

### 4. Verification

- Build runs automatically after edits.
- Run `bunx vitest run src/test/reportRangesPresets.test.ts src/test/dashboardDateRangeParity.test.ts src/test/financialConsistency.test.ts src/test/dateRangeFilter.test.tsx src/test/dashboardShowingAndCancelled.test.tsx src/test/dashboardTrendPct.test.ts`.
- Visual check: Dashboard `This Week / Last Week / This Month / Last Month` chips vs Loads DateRangeFilter same chips — both must produce identical date windows and identical "Showing:" labels under Sunday and Monday `week_start_day`.

## Out of scope

- No UI redesign, no className changes, no new presets.
- No changes to `ReportsView`, `LoadsListView`, `WeeklyCloseout`, `summarizeLoads`, `loadMetrics`, or any financial formulas.
- Dashboard-only keys `this_year`, `all`, `custom` remain locally handled — `reportRanges` does not expose them and forcing them in is out of scope.

## Files

- Edit: `src/components/DateRangeFilter.tsx`, `src/components/DashboardView.tsx`
- Edit: `src/test/reportRangesPresets.test.ts`
- Create: `src/test/dashboardDateRangeParity.test.ts`
