

## Plan: Add Grand Total Summary Cards to Loads, Expenses, and Fuel Logs Pages

### What and Why

When a driver selects a date preset (This Week, Last Week, etc.), they currently see a filtered list but no aggregated totals for the Loads page. The Expenses page already has a total card but could be enhanced. Adding a summary card right below the date filter gives instant context about the selected period.

### Changes

#### 1. `src/components/LoadsListView.tsx` — Add summary card

After the date filter and search/filter row, insert a summary card showing:
- **Total Loads** (count of filtered)
- **Total Revenue** (sum of `gross_revenue` or `estimated_pay`)
- **Total Miles** (sum of `loaded_miles`)
- **Avg $/mile** (revenue / miles)

Compute these from the `filtered` array. Use the existing `formatCurrency` and `formatNumber` helpers. Style with `card-premium shadow-card` matching the Expenses page total card — a compact horizontal grid of 4 stats.

#### 2. `src/components/ExpensesListView.tsx` — Enhance existing summary

The existing total card already shows total amount and count. Enhance it minimally by adding a **category breakdown** row showing top 2-3 categories with amounts (compact inline badges). This keeps it informative without clutter.

#### 3. `src/components/FuelLogsListView.tsx` — Already has totals

This page already shows total cost and total gallons. No changes needed.

#### 4. `src/components/DateRangeFilter.tsx` — Add "Last Week" and "Last Month" presets

Currently the Loads page DateRangeFilter only has: This Week, This Month, This Year, All Time, Custom. Add **Last Week** and **Last Month** presets to match the Expenses page which already has them.

### Technical Details

- Import `formatCurrency`, `formatNumber` from `@/lib/loadUtils`
- Import `subWeeks`, `subMonths` from `date-fns` in DateRangeFilter
- Summary computations use existing filtered array — no new queries
- No database changes, no new files, no billing changes

