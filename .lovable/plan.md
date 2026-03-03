

## Audit Findings

**Current onboarding behavior:**

1. **OnboardingModal** (3-slide carousel): Introduces load tracking, expense/profit concept, and weekly closeouts. Final CTA: "Log Your First Load" → navigates to add-load form.
2. **Onboarding** (empty-state hero on dashboard): Shows when 0 loads exist. CTA: "Log Your First Load".
3. After onboarding completes, `onboarding_completed` flag is set in `user_settings`.

**What's missing:**
- No prompt to set a default rate per mile before logging the first load.
- No prompt to log a first expense after the first load is saved.
- No explanation of how Net Profit is calculated (Revenue - Expenses = Net).
- The `ProfitOverview` component shows an empty state ("Add expenses to calculate true profit") but no actionable CTA button.

---

## Plan

### 1. OnboardingModal — Add "Set Default Rate" step (slide 2 of 4)

**File: `src/components/OnboardingModal.tsx`**

Insert a new slide at position index 1 (between "Track Every Load" and "Know Your Real Profit"):
- Icon: `Settings` (from lucide)
- Title: "Set Your Default Rate"
- Description: "Set your default rate per mile so profit calculations are accurate from the start."
- No special button on this slide — the normal Next/Skip flow continues.

Update the final slide CTA to remain "Log Your First Load".

Also accept an optional `onNavigateSettings` callback prop. On the new slide, add a small secondary link: "Set My Default Rate →" that calls `onNavigateSettings` (which will navigate to settings page). This is optional — the user can skip.

**File: `src/pages/Index.tsx`**

Pass `onNavigateSettings` to `OnboardingModal`:
```
onNavigateSettings={() => { setShowOnboardingModal(false); setPage('settings'); }}
```

### 2. Post-first-load expense nudge

**File: `src/pages/Index.tsx`**

In `handleAddLoad` `onSuccess`, after the toast, check if `allExpensesQuery.expenses.length === 0`. If so, show a toast with an action:
```
toast.success('Load logged!', {
  description: 'Now log your first expense to see real net profit.',
  action: { label: 'Add Expense', onClick: () => { setPage('add_expense'); } }
});
```
This replaces the existing `toast.success('Load logged successfully!')` only when expenses are empty.

### 3. Profit explanation tooltip on ProfitOverview

**File: `src/components/ProfitOverview.tsx`**

Next to the "Profit Overview" label (line 46), add an info icon with a tooltip:
```
<TooltipProvider><Tooltip><TooltipTrigger>
  <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
</TooltipTrigger><TooltipContent>
  Net Profit = Load Revenue − Expenses
</TooltipContent></Tooltip></TooltipProvider>
```

Also update the empty-state card (line 29-37) to include a CTA button "Add First Expense" that calls an `onAddExpense` callback. Accept `onAddExpense?: () => void` prop.

**File: `src/components/DashboardView.tsx`**

Pass `onAddExpense={() => onNavigate?.('add')}` — actually this should trigger add_expense:
```
<ProfitOverview loads={...} expenses={...} onAddExpense={() => onNavigate?.('add_expense')} />
```
Wait — `onNavigate` with `'add_expense'` won't work since `handleNavigate` in Index.tsx routes `'add'` to the AddActionModal. Let me check... Actually looking at Index.tsx, `handleNavigate` checks `if (p === 'add')` to show the modal, but `'add_expense'` goes through to `setPage('add_expense')` directly. So passing `() => onNavigate?.('add_expense')` is correct — but we need to make sure DashboardView's onNavigate prop allows this.

Looking at the code, `onNavigate` already accepts any string page name and Index.tsx sets the page directly for anything other than `'add'`. So `onNavigate('add_expense')` will work.

Pass to ProfitOverview: `onAddExpense={() => onNavigate?.('add_expense')}`

### 4. Files Modified

| File | Change |
|------|--------|
| `OnboardingModal.tsx` | Add "Set Default Rate" slide + optional settings link |
| `Index.tsx` | Pass settings nav callback; expense nudge toast after first load |
| `ProfitOverview.tsx` | Add profit formula tooltip + "Add First Expense" CTA in empty state |
| `DashboardView.tsx` | Wire `onAddExpense` to ProfitOverview |

No database, calculation, theme, layout, or route changes.

