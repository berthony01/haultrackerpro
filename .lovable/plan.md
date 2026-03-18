
Goal: make load period assignment fully completion-based (drop-off date first, pickup fallback) and remove the remaining places that still behave like pickup-date-first.

What I found (root causes)
1) `src/hooks/useLoads.ts` still fetches in pickup-date order (`order('load_date')`) and does not apply effective-date filtering when `dateRange` is set.  
   - This makes “posted/sorted” behavior look pickup-based.
   - It also prevents Loads-page period filters from being reliably completion-date-based.
2) Export/report row “Date” fields in `src/lib/loadUtils.ts` still output `load_date` (pickup), which makes period reports look pickup-driven even if filtering is already drop-off-based.
3) Some load-reference dropdowns still display pickup date (`ExpenseForm`, `FuelLogForm`), which reinforces the same confusion.

Implementation plan (smallest safe logic correction)
1) Update `src/hooks/useLoads.ts` (primary fix)
   - Keep backend fetch user-scoped only.
   - After fetch, compute `effectiveDate = dropoff_date ?? load_date`.
   - Apply `dateRange.from/to` filtering against `effectiveDate` (string compare on `yyyy-MM-dd`).
   - Sort returned loads by `effectiveDate` descending (tie-break by `created_at` descending).
   - Keep existing CRUD behavior intact.
   - Ensure insert/update path always preserves fallback safety (`dropoff_date` defaults to `load_date` when omitted).

2) Update period-report export date fields in `src/lib/loadUtils.ts`
   - In `exportToCSV`, `exportProfitCSV`, and `exportToPDF`, change row “Date” value from `l.load_date` to `getEffectiveDate(l)`.
   - Keep pickup/dropoff columns unchanged for operational reference.
   - No layout/styling changes, only date-source logic.

3) Align load date display in load-link selectors (logic consistency)
   - `src/components/ExpenseForm.tsx`: linked-load select label date should use effective date.
   - `src/components/FuelLogForm.tsx`: linked-load select label date should use effective date.
   - This does not change behavior, only removes pickup-date-first ambiguity in period context.

4) Keep current correct areas unchanged
   - Dashboard, charts, scorecard, weekly closeout, smart alerts, and report range filtering already use effective date logic and will remain untouched.

Technical details
- Canonical period date everywhere: `dropoff_date ?? load_date`.
- No schema migration needed.
- No auth/billing/navigation/theme/styling changes.
- No change to standalone expense date logic (`expense_date` remains independent).
- Legacy loads remain visible due pickup fallback.

Verification checklist (after implementation)
1) Create load: pickup Saturday, drop-off Monday → appears/counts in Monday’s week.
2) Create load: pickup Jan 31, drop-off Feb 1 → counted in February.
3) Create load: pickup Dec 31, drop-off Jan 2 → counted in new year.
4) Legacy/empty drop-off record (if present) still included via pickup fallback.
5) Loads page presets/custom range reflect completion date classification.
6) Weekly closeout includes only loads completed in selected week.
7) Weekly/monthly/report exports show effective completion date in “Date” column.

Planned files to change
- `src/hooks/useLoads.ts`
- `src/lib/loadUtils.ts`
- `src/components/ExpenseForm.tsx`
- `src/components/FuelLogForm.tsx`

Expected result
After these changes, all period-based load calculations, filtering, grouping, sorting-for-period views, and report/export date assignment will consistently use drop-off date with pickup-date fallback.
