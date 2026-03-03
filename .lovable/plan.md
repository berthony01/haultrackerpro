

## Fix: Dashboard Empty-State Flash After Login

### Root Cause
In `DashboardView.tsx`, the empty-state card (line 325) checks `filteredLoads.length === 0` but does **not** check `isLoading`. During the initial data fetch, `loads` is `[]`, so `filteredLoads` is also `[]`, causing the "No loads for this period" card to flash before real data arrives.

The `Onboarding` hero in `Index.tsx` (line 104) is already correctly guarded with `!allLoadsQuery.isLoading`. No change needed there.

### Fix (1 file, 1 line)

**File: `src/components/DashboardView.tsx`** — Line 325

Change:
```tsx
{filteredLoads.length === 0 && (
```
To:
```tsx
{!isLoading && filteredLoads.length === 0 && (
```

This ensures the empty-state card only renders after loading completes. During loading, the skeleton cards (already rendered at lines 166-171) provide visual feedback.

### Files Modified
| File | Change |
|------|--------|
| `src/components/DashboardView.tsx` | Add `!isLoading` guard to empty-state condition (line 325) |

No other files need changes. No database, Stripe, theme, or calculation modifications.

