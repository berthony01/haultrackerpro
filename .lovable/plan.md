# Phase 23 — Financial Calculation Consistency Repair

## Audit findings (confirmed by reading the listed files)

1. `**RecentLoadsPanel` receives unfiltered loads.** `DashboardView.tsx:382` passes `loads` (all loads) instead of `filteredLoads`, so the panel ignores the dashboard date filter.
2. `**RecentLoadsPanel` mislabels pay as "Profit".** Line 67 renders `Profit` under the dollar value, but the value is `actual_pay_received ?? getLoadExpectedPay(load)` — that is revenue/pay, not profit.
3. `**ReportsView` ignores week-start setting.** Line 90: `getWeekSummaries(filteredLoads)` is called without `weekStartsOn`, so weekly report rows always start on Sunday regardless of `user_settings.week_start_day`. The helper already accepts a `weekStartsOn` argument.
4. `**ProfitByLoadTable` silently understates expenses per row.** It only subtracts `expenses.linked_load_id === load.id`, but the dashboard's total Net Profit uses **all** period expenses. Column is labeled generically "Expenses", which is misleading.
5. **Date-range logic is partially duplicated.** `DateRangeFilter.tsx` builds presets inline; `src/lib/reportRanges.ts` already exposes `getPresetRange` / `validateCustomRange`. No "previous comparison range" helper exists, and there's no single `isDateInRange` helper.
6. **Calculation core is already correct.** `financialCalculations.ts` (`summarizeLoads`, `excludeCancelled`, `getLoadRealizedRevenue`) and `loadMetrics.ts` (`getLoadExpectedPay`, `getLoadOperatingMiles`) already enforce rules 1, 2, 4–11. No formula changes needed there — the fixes are wiring + labels + week-start plumbing.

## Changes

### A. Centralize date-range helpers — `src/lib/reportRanges.ts`

Extend (do **not** replace) the existing module:

- Add `isDateInRange(dateStr: string, range: { from?: string; to?: string }): boolean` — inclusive YYYY-MM-DD compare.
- Add `getPreviousComparisonRange(key, range, weekStartsOn)` — mirrors the active preset one period back (week→prev week, month→prev month, quarter→prev quarter, ytd→prior YTD slice, custom→same-length window immediately before `from`).
- Add `formatShowingRange(range)` returning the same "Showing: …" string `DateRangeFilter` builds today.
- Keep existing exports untouched.

### B. `DateRangeFilter.tsx`

- Replace inline preset construction with `getPresetRange(key, wso)` from `reportRanges.ts`.
- Use `formatShowingRange` for the footer label.
- No visual change; behavior identical.

### C. `DashboardView.tsx`

- Line 382: pass `filteredLoads` (not `loads`) to `<RecentLoadsPanel>` so the panel honors the dashboard date filter.

### D. `RecentLoadsPanel.tsx`

- Change row label from "Profit" → **"Pay"** when `actual_pay_received` is set, otherwise **"Est. Pay"**. Value unchanged.
- Filter out `status === 'cancelled'` loads from `sorted` (cancelled loads never appear in recent list).

### E. `ProfitByLoadTable.tsx`

- Rename Expenses column header → **"Linked Expenses"**.
- Add small subtitle under the panel title:  
*"Net Profit shown per load reflects expenses linked to that load. Unlinked period expenses appear in dashboard totals."*
- When `unlinkedTotal = Σ(filteredExpenses where !linked_load_id) > 0`, render a single line under the table:  
*"Unlinked period expenses: $X — included in dashboard net profit, not assigned to individual loads."*
- Accept optional `unlinkedExpensesTotal` prop (computed in `DashboardView` from `filteredExpenses`) to avoid re-deriving.

### F. `ReportsView.tsx`

- Import `weekStartDayToNumber` + `useUserSettings`.
- Compute `weekStartsOn` and pass it: `getWeekSummaries(filteredLoads, weekStartsOn)`.
- Memo key updated to include `weekStartsOn`.

### G. Tests — `src/test/`

New file `reportRangesPresets.test.ts`:

- Monday start, anchor 2026-05-27: This Week = 2026-05-25 → 2026-05-31; Last Week = 2026-05-18 → 2026-05-24.
- Sunday start, anchor 2026-05-27: This Week = 2026-05-24 → 2026-05-30; Last Week = 2026-05-17 → 2026-05-23.

New file `financialConsistency.test.ts`:

- Build a small fixture of loads (incl. one cancelled, one with actual pay, one pending) and assert `summarizeLoads(filtered)` returns the same `grossRevenue`, `loadCount`, `totalMiles`, `effectiveRPM` as the values the Loads KPI strip derives from the same `filtered` array via `loadMetrics` helpers.

New file `recentLoadsPanelLabel.test.tsx`:

- Renders `<RecentLoadsPanel>` and asserts no occurrence of the text "Profit"; asserts "Pay" or "Est. Pay" present.

New file `profitByLoadTableUnlinked.test.tsx`:

- With expenses containing both linked and unlinked rows, asserts column header text is "Linked Expenses" and the unlinked summary line renders with the correct $ total.

New file `reportsWeekStartRespected.test.ts`:

- Calls `getWeekSummaries(loads, 1)` vs `getWeekSummaries(loads, 0)` on identical input and asserts the `weekStart` field shifts by the expected day.

### H. Out of scope (explicitly deferred)

- Rewriting `summarizeLoads` or `loadMetrics` (already correct).
- Allocating unlinked expenses across loads (no defensible allocation method).
- `LoadsKpiStrip`, `ProfitOverviewChart`, `WeeklyCloseout`, `useSmartAlerts` — re-read during implementation; only touched if audit reveals a concrete drift. Current reads show they already use `summarizeLoads` / `loadMetrics` / `weekStartDayToNumber`.

## Technical details

- Effective date everywhere continues to flow through `getEffectiveDate` (dropoff fallback to pickup).
- `isDateInRange` uses string compare on YYYY-MM-DD (timezone-safe, matches how loads are filtered today in `DashboardView`).
- No DB / RLS / edge-function changes.

## Verification

- `tsc` clean (auto build).
- `bunx vitest run` — all new + existing tests pass.
- Manual: switch user week-start between Sunday/Monday; confirm Reports weekly rows shift; confirm Dashboard date filter now constrains Recent Loads list.

## Final report (delivered after build)

Files inspected, files changed, the 11 calculation rules with the helper that enforces each, dashboard ↔ loads ↔ reports parity confirmation, test output, and the deferred items above.

Add Phase 23A protections before implementing:

1. DashboardView must use shared reportRanges helpers for active range, showing label, and previous comparison range. Remove local duplicate date-range helper logic unless there is a documented reason not to.

2. ProfitOverviewChart must exclude cancelled loads before calculating daily revenue/net profit.

3. ProfitByLoadTable must exclude cancelled loads before building rows.

4. getWeekSummaries must either exclude cancelled loads internally or receive already-active loads. Add a test proving cancelled loads are not counted in weekly financial summaries.

5. useSmartAlerts must use the same canonical rules:

   - exclude cancelled loads

   - gross revenue = actual pay when present, otherwise expected pay

   - expenses from the same selected week range

   - week-start setting respected

6. Add tests for cancelled-load exclusion across:

   - ProfitOverviewChart

   - ProfitByLoadTable

   - Reports weekly summaries

   - Smart Alerts

Do not proceed until these are included.