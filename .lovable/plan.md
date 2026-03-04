

## Fix: "Loads Done" Not Counting Loads

### Root Cause
Line 100 in `DashboardView.tsx` filters loads by `status === 'completed'` or `status === 'Completed'`, but all loads in the database have `status = 'pending'`. The card shows 0 because no loads match.

### Fix

**File: `src/components/DashboardView.tsx`**

Change "Loads Done" to show **all** loads in the filtered period (not just completed ones), since in this app context every logged load counts as work done. Rename the variable for clarity.

- **Line 100**: Remove the completed-only filter — use `filteredLoads.length` directly
- **Line 189**: Update to use `filteredLoads.length`

Alternatively, if distinguishing statuses matters, rename the card to "Total Loads" to accurately reflect what's being counted. Either way, the user should see their 3 loads.

**Proposed change (line 189)**:
```tsx
<StatCard label="Total Loads" value={filteredLoads.length.toString()} icon={Truck} />
```

And remove the unused `completedLoads` variable on line 100.

No other files affected.

