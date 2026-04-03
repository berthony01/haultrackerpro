

# Fix Critical Issues: Category Mismatch + Pagination

Two high-priority fixes from the analysis.

---

## 1. Expense Category Mismatch Fix

**Problem**: The AI edge function uses 24 categories (e.g., "Permits & Licenses", "Food & Meals", "Dispatch Fee") that don't match the app's 19 categories (e.g., "Permits", "Meals", "Lumper"). When AI parses an expense, the category won't match what the form expects.

**Fix**: Update the AI edge function's `PARSE_EXPENSE_TOOL` enum to use the app's exact 19 categories: Fuel, Maintenance, Repairs, Tires, Insurance, Tolls, Parking, Permits, Licensing, Truck Payment, Lease Payment, Phone, ELD/Software, Scale/Weigh, Lumper, Meals, Lodging, Supplies, Other.

**File**: `supabase/functions/ai-insight/index.ts` — replace the category enum (lines 52-59)

---

## 2. Pagination for Loads & Expenses

**Problem**: Both `useLoads` and `useExpenses` fetch all records with no limit. The default 1,000-row cap silently truncates data for power users.

**Fix**: Add server-side pagination with a page-size of 50. Add `.range()` calls and return total count. Update the list views to use pagination controls.

### Changes:

- **`src/hooks/useLoads.ts`** — Accept `page` param, add `.range(from, to)` and `.order()` server-side, return `{ loads, totalCount, page, pageSize }`
- **`src/hooks/useExpenses.ts`** — Same pagination pattern
- **`src/components/LoadsListView.tsx`** — Add pagination controls at bottom using existing `Pagination` UI component
- **`src/components/ExpensesListView.tsx`** — Same pagination controls

---

## Files Changed
| File | Change |
|------|--------|
| `supabase/functions/ai-insight/index.ts` | Fix category enum to match app's 19 categories |
| `src/hooks/useLoads.ts` | Add server-side pagination with `.range()` |
| `src/hooks/useExpenses.ts` | Add server-side pagination with `.range()` |
| `src/components/LoadsListView.tsx` | Add pagination UI |
| `src/components/ExpensesListView.tsx` | Add pagination UI |

