

## Plan: Quick Actions, Pricing Fix, and 3 New AI Pro Features

### Task 1: Quick Action Row on Dashboard

**`src/components/DashboardView.tsx`**
- Add `Receipt, Fuel` to the lucide-react import (line 19 — `Truck` already present)
- Insert Quick Action row between the date filter closing `</div>` (line 175) and the `{/* Loading skeletons */}` comment (line 177): three buttons for Quick Expense, Log Load, and Fuel Log

### Task 2: Fix Pricing Page Bottom CTA

**`src/pages/Pricing.tsx`**
- Replace lines 287-313 (the Bottom CTA section) with a single-button CTA layout — removes the confusing dual-button pattern and uses one clear "Start Tracking Free" button

### Task 3: Smart Load Advisor

**New file: `src/components/SmartLoadAdvisor.tsx`**
- Analyzes last 60 days of loads, groups by lane (pickup city to dropoff city)
- Shows best/worst lanes by RPM, potential weekly earnings gain
- Free users see a teaser with load/lane counts; Pro users see full analysis
- No LLM needed — pure client-side data analysis

**`src/components/DashboardView.tsx`**
- Import `SmartLoadAdvisor`
- Add it before the `{/* Performance Trends */}` section (before line 302)

### Task 4: AI Expense Categorization

**New file: `src/lib/categorizeExpense.ts`**
- Keyword-matching engine with weighted scoring across 6 categories (Fuel, Tolls, Maintenance, Repairs, Insurance, Permits)
- Trucking-specific keywords (Pilot, Love's, EZPass, DOT inspection, etc.)

**`src/components/ExpenseForm.tsx`**
- Import `categorizeExpense`
- Enhance the `update` function (line 92) to auto-detect category when notes field changes, category is empty, user is Pro, and text is 3+ chars
- Shows toast on successful detection; never overwrites user's manual selection

### Task 5: AI Weekly Summary

**New file: `src/lib/generateWeeklySummary.ts`**
- Template-based natural language summary generator comparing this week vs last week
- Covers revenue, RPM, deadhead, load count, best load, and actionable tips
- No LLM needed — conditional sentence construction

**`src/components/WeeklyCloseout.tsx`**
- Import `generateWeeklySummary`
- Add an "AI Weekly Summary" card after the existing Week in Review section showing the generated narrative paragraphs
- Only visible for Pro users with loads in the current week

### Files changed
- `src/components/DashboardView.tsx` — Quick Actions + SmartLoadAdvisor import
- `src/pages/Pricing.tsx` — Bottom CTA replacement
- `src/components/SmartLoadAdvisor.tsx` (new)
- `src/lib/categorizeExpense.ts` (new)
- `src/components/ExpenseForm.tsx` — auto-categorization in update function
- `src/lib/generateWeeklySummary.ts` (new)
- `src/components/WeeklyCloseout.tsx` — AI Summary card

### What stays unchanged
- All database tables, edge functions, RLS policies, auth, billing, navigation
- All existing dashboard sections and component ordering (additions only)

