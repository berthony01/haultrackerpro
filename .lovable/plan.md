

## Plan: Performance Metrics Charts Section

### Overview

Create a new `PerformanceCharts` component placed on the Dashboard below the existing `PerformanceTrends` section. It contains 5 charts with a dedicated time range toggle (This Week / This Month / This Year) that respects the user's "Week Starts On" setting.

### New File: `src/components/PerformanceCharts.tsx`

A single self-contained component that receives `loads` and `expenses` arrays (already fetched in `DashboardView`). Internally it:

1. **Time range toggle** — 3 buttons: "This Week", "This Month", "This Year". Uses `getPresetRange` logic already in `DashboardView` (will extract or duplicate the small helper).

2. **Bucket logic** — Based on selected range:
   - This Week / This Month → daily buckets (format: "Mon", "Tue" or "Mar 1", "Mar 2")
   - This Year → monthly buckets ("Jan", "Feb", ...)

3. **5 Charts** (all using Recharts, already installed):

   **Chart 1: Net Profit Trend** — Line chart. Y = revenue - expenses per bucket. Single orange line.

   **Chart 2: Revenue vs Expenses** — Line chart with 2 lines. Revenue (orange) + Expenses (red/muted). Legend below.

   **Chart 3: Avg RPM Trend** — Line chart. Y = total_revenue / total_loaded_miles per bucket. Empty state note if no miles.

   **Chart 4: Deadhead % Trend** — Line chart. Y = deadhead / (loaded + deadhead) * 100. Empty state if no deadhead data.

   **Chart 5: Expense Breakdown by Category** — Horizontal bar chart. Top 5 categories aggregated for selected range.

4. **Styling** — Uses existing `Card`/`CardContent`, `text-label`, `card-premium` classes. Chart colors use existing theme HSL values (primary orange, green for actual, muted for secondary lines). Tooltips use `formatCurrency` / `formatNumber`. Each chart is ~140px tall in a `ResponsiveContainer`.

5. **Empty states** — If insufficient data for a chart, show a small muted message inside the card instead of a broken chart.

### Modified File: `src/components/DashboardView.tsx`

- Import and render `<PerformanceCharts loads={allLoadsQuery.loads} expenses={allExpensesQuery.expenses} />` after the existing `<PerformanceTrends />` component (line ~278).
- Pass the unfiltered `loads` and `expenses` props (the component handles its own time range internally).

### No Other Changes

- No schema changes, no routing changes, no changes to existing business logic, theme, or navigation.
- The existing `PerformanceTrends` component is kept as-is (it shows different data: last 4 weeks earnings bar chart + 30-day averages).

