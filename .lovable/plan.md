# Phase 6C.7A — Date Range State Authority Patch

## Issue confirmed

`DateRangeFilter` owns its own `active` / `activeRange` state (lines 32-33). The parent (`Index.tsx`, line 76) owns the real applied filter as `dateRange = { from, to }`. The filter only pushes outward via `onRangeChange` — it never reads back from the parent. Consequences:

- On remount (navigate away → back to Loads), the filter resets visually to "All Time" with no `from`/`to`, but `Index.dateRange` is preserved → label and active chip drift from the real filter.
- The chip highlighting is computed via `active === p.label`, which only updates on click — not in response to the parent's authoritative range.

`LoadsListView` already correctly resets pagination on `loads` change (line 71, fixed in Phase 6C.7). No regression there.

## Date range authority map (target state)

```text
Index.tsx (parent)
  dateRange { from?, to? }  ← source of truth
        │  passed down ▼
  LoadsListView
        │  passes both currentRange + onChange ▼
  DateRangeFilter (now controlled)
        - derives active preset label from currentRange
        - derives "Showing: …" label from currentRange
        - calls onRangeChange on user action; never holds its own copy
```

## Changes

### 1. `src/components/DateRangeFilter.tsx`

- Add prop `currentRange?: { from?: string; to?: string }`.
- Remove internal `active` / `activeRange` state.
- Derive `activeLabel` each render by matching `currentRange.from`/`to` against each preset's `getRange()` (compare as `yyyy-MM-dd` strings). If no match and both undefined → `'All Time'`. If no match and both defined → `'Custom'`.
- Derive `rangeLabel` from `currentRange` directly (parse ISO → format MMM d, yyyy). `'All Time'` when both undefined.
- Keep `customFrom`/`customTo`/`showCustom`/`customError` as local UI state only — they don't represent applied state.
- `handlePreset` and `handleCustom` keep calling `onRangeChange`; they no longer mutate local active state.

### 2. `src/components/LoadsListView.tsx`

- Add prop `currentDateRange?: { from?: string; to?: string }`.
- Pass it through to `<DateRangeFilter currentRange={currentDateRange} onRangeChange={onDateRangeChange} />`.

### 3. `src/pages/Index.tsx`

- Pass `currentDateRange={dateRange}` to the existing `<LoadsListView …>` render site. No other changes.

### 4. Tests

- No existing test harness for these components. Add no new files unless needed; verify by build + manual matrix below.

## Dashboard vs Loads page consistency notes

`DashboardView` runs an entirely independent preset state (`activePreset`, lines 92-95) keyed off `PresetKey` which does **not** include `'all_time'`. Its KPI cards and trend math (`prevRange`, lines 175-…) **require** a bounded interval to compute previous-period deltas. Adding an "All Time" preset here would force null-handling across:

- `prevRange` memo
- every trend computation downstream
- the trend arrow/percentage UI

That is not a small/safe change inside this phase's scope. **Deferred** (see D1 below). Dashboard remains period-comparison-only, intentional. Loads page "All Time" still does not affect Dashboard — same as before.

## Verification matrix (manual after build)

1. Loads page: pick **Last Week** → navigate to Dashboard → back to Loads → chip shows **Last Week** and label shows the correct Mon–Sun / Sun–Sat range.
2. Pick **All Time** → navigate away → back → chip shows **All Time**, label shows "Showing: All loads", list shows every load.
3. Monday week-start setting → Last Week renders Monday-to-Sunday range label.
4. Sunday week-start setting → Last Week renders Sunday-to-Saturday range label.
5. Apply a Custom range → label persists while applied; chip shows **Custom**.
6. Switch presets → pagination resets (already in place).
7. Dashboard: presets behave unchanged; no "All Time" appears.

Build/test: `bunx vitest run` must remain green (199 tests).

## Intentionally not changed

- `useLoads`, `loadUtils`, `computeLoadPay`, mileage math, reports/exports, schema, types — all forbidden by phase scope.
- Pagination dep array in `LoadsListView` (already correct from 6C.7).
- Custom-date input parsing (`new Date('YYYY-MM-DD')`) — pre-existing concern, see D2.
- DashboardView preset structure.

## Deferred findings

- **D1**: DashboardView lacks an `'all_time'` preset. Adding it requires null-handling across `prevRange` and all trend math; out of scope for this surgical patch.
- **D2**: Custom date input uses `new Date('YYYY-MM-DD')` which is UTC-parsed; not user-visible at present but a latent timezone risk.
- **D3**: No automated test harness covers DateRangeFilter / LoadsListView interaction. Worth adding a small RTL test file in a future phase.

## Rollback plan

1. Revert `src/components/DateRangeFilter.tsx` to restore internal `active` / `activeRange` state and remove the `currentRange` prop.
2. Revert `src/components/LoadsListView.tsx` to drop the `currentDateRange` pass-through.
3. Revert the single prop add in `src/pages/Index.tsx`.
4. No DB, no migration, no data repair.

ADDITIONAL REQUIREMENTS:

1. Date label parsing safety:

When deriving the “Showing: …” label from currentRange.from/[currentRange.to](http://currentRange.to), do not use unsafe new Date('YYYY-MM-DD') parsing. Use parseISO + isValid or an equivalent local-safe helper. Invalid date values should not crash the component and should fall back safely.

2. Pagination reset precision:

Pagination must reset when the actual applied date range changes, or when status/pay/search filters change. Avoid causing unnecessary resets only because the loads array reference changes after a background refetch, unless there is no safer option.

3. Controlled-state authority:

After this patch, DateRangeFilter must not have its own independent applied active preset/range state. It may keep temporary custom input state, but the applied chip/label must derive from currentRange provided by the parent.