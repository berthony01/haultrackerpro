## Add recurring toggle to Add Expense form + minor fixes

You're right — the prompt's intent (and basic UX expectation) is that a user creating a one-off expense should be able to flip a switch to *also* save it as a recurring monthly template, without leaving the Add Expense flow. Right now they have to go to Recurring Expenses and re-type everything.

Here's the surgical plan.

### 1. Add "Make this recurring" toggle to `src/components/ExpenseForm.tsx`

**Where:** Right above the Save button, after the Notes field. Only shown on **create** (not edit), and only for **Pro/trialing** users (recurring is already a Pro feature).

**UI:**
- A `Switch` labeled **"Save as recurring monthly expense"** with helper text: *"Auto-create this expense on the 1st of every month. You can pause it anytime."*
- When toggled on, reveal two compact fields:
  - **Template name** (text input, defaults to category + amount, e.g. "Truck Insurance — $850")
  - **End date** (optional date input)
- Frequency is locked to `monthly` (matches existing system — no new logic).
- Start date defaults to the expense_date already entered.
- For Free users: show the toggle but disabled with a small "Pro" badge that opens `ProUpgradeModal` on click. Matches existing gating pattern in this form.

**Behavior on submit:**
1. Save the one-off expense exactly as today (no behavior change to existing flow).
2. *If* recurring toggle is on, also call `addTemplate` from `useRecurringExpenses` with:
   - `template_name` (from input)
   - `category`, `amount`, `notes`, `expense_type` (mirrored from the form)
   - `frequency: 'monthly'`
   - `start_date: form.expense_date`
   - `end_date` (if provided)
   - `last_generated_date: form.expense_date` ← **critical**: prevents the cron from double-generating this month, since we just created the expense manually.
3. Show toast: *"Expense saved + recurring template created"*.

**Edge cases handled:**
- If the expense is for a past month, `last_generated_date` set to `expense_date` ensures the cron only generates from next month forward.
- If user enters end_date before expense_date, validate and show error.
- If template creation fails after expense succeeds, show non-blocking toast: *"Expense saved, but recurring setup failed — try again from Recurring Expenses."* The expense stays.

### 2. Fix Home Time Mode resume scope

Right now "Back on the Road" resumes **all** paused templates, even ones the user paused manually before going home. That's a real bug.

**Fix in `src/components/RecurringExpensesView.tsx` + `useRecurringExpenses.ts`:**
- When Home Time Mode starts, store the IDs of templates it paused in `user_settings.home_time_paused_template_ids` (new `uuid[]` column, default `'{}'`).
- "Back on the Road" only resumes templates whose IDs are in that array AND are still `paused`.
- Manually-paused templates stay paused.
- Requires a tiny migration to add the column.

### 3. Fix pause reason consistency

Templates paused via "Pause All" use reason `"Home time / paused all"`. Templates paused via Home Time Mode currently use the same string, which is misleading.

**Fix:** 
- "Pause All" → reason: `"Paused all (bulk action)"`
- Home Time Mode → reason: `"Home time mode"`
- This makes the "Paused since … — Home time mode" badge accurate and lets us audit later.

### Files touched

- `src/components/ExpenseForm.tsx` — add Switch + conditional inline fields + Pro gate + dual-save logic
- `src/hooks/useRecurringExpenses.ts` — no signature change; reuse existing `addTemplate`
- `src/components/RecurringExpensesView.tsx` — split bulk-pause vs home-time-pause reason strings; resume logic reads `home_time_paused_template_ids`
- `src/hooks/useUserSettings.ts` — add `home_time_paused_template_ids` to update type
- One small migration: `ALTER TABLE user_settings ADD COLUMN home_time_paused_template_ids uuid[] NOT NULL DEFAULT '{}'`

### What I won't touch
- The recurring generation cron (no logic change needed — `last_generated_date` already gates duplicates)
- `RecurringExpenseForm.tsx` (the dedicated create-template modal stays exactly as is for users who want to create a template *without* logging an expense first)
- Pricing/Pro gating logic (reuses existing `isPro` prop and `ProUpgradeModal`)
- Reporting, dashboard, tax math (untouched — they read generated `expenses`, not templates)

### Verification after build
1. Free user: toggle is disabled, click → upgrade modal. ✅
2. Pro user: toggle off → expense saves only (existing behavior). ✅
3. Pro user: toggle on → expense saves AND template appears in Recurring Expenses list. ✅
4. Cron next month: generates 1 new expense (not 2). ✅
5. Manually pause Template A → start Home Time → only Template B gets paused-by-home-time → Back on the Road only resumes B. A stays paused. ✅
6. Pause reason on badges reads correctly per source. ✅

That's the full delta. Small, surgical, no regressions to existing recurring flow.