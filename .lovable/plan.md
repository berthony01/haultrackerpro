

## Plan: 5 Pro Feature Enhancements

### Task 1: Actionable Recommendations in Driver Scorecard

**`src/hooks/useDriverScorecard.ts`**
- Add `recommendation: string` to `ScorecardMetric` interface (line 13)
- After line 99 (`totalScore` calc), add recommendation strings based on score thresholds for each metric (RPM, deadhead, expense, profit, streak)
- Update metrics array (lines 104-110) to include `recommendation` field on each entry

**`src/components/DriverScorecard.tsx`**
- Add `Lightbulb` to lucide imports (line 6)
- After line 122 (`metric.detail` paragraph), add a bordered recommendation section with Lightbulb icon and `metric.recommendation` text

### Task 2: Week in Review Anomaly Detection in Weekly Closeout

**`src/components/WeeklyCloseout.tsx`**
- Add `Zap` to lucide imports (line 10)
- Before the `{/* Deadhead */}` section (line 193), insert a "Week in Review" card that:
  - Calculates RPM per load, finds best/worst loads
  - Flags loads with >30% deadhead
  - Notes unpaid loads
  - Renders color-coded insight rows (good/warning/info)

### Task 3: Dollar Impact in Smart Alerts

**`src/hooks/useSmartAlerts.ts`** — 4 alert message updates:
- **Profit drop** (line 80): Add `$dollarDrop` amount to message
- **High deadhead** (line 98): Add estimated cost using `avgRPM * totalDH * 0.3`
- **Low RPM** (line 117): Add `$rpmLoss` based on `(avg30RPM - thisWeekRPM) * totalLoaded`
- **High expense ratio** (line 131): Add `$excessExpense` above 70% target with revenue/expense totals

### Task 4: Improved PDF Report

**`src/lib/loadUtils.ts`**
- Replace entire `exportToPDF` function (lines 238-330) with improved version featuring:
  - Larger fonts (8pt body, 9pt headers instead of 6-7pt)
  - Branded header with company name
  - Summary totals on page 1
  - Alternating row shading
  - Footer with branding
  - Fewer columns (9 vs 13) for readability

### Task 5: "Pro Saved You Time" Dashboard Card

**New file: `src/components/ProTimeSavedCard.tsx`**
- Queries `expense_automation_logs` (voice + receipt counts) and `parse_usage` (paste parse counts) for current week
- Calculates estimated time saved (2min/voice, 3min/receipt, 1.5min/paste)
- Shows total minutes saved + breakdown grid
- Only visible for Pro/trialing users with >0 actions this week

**`src/components/DashboardView.tsx`**
- Import `ProTimeSavedCard`
- Add component before `{/* Fuel Analytics */}` section, passing `isPro`, `isTrialing`, `weekStartsOn`

### Files changed
- `src/hooks/useDriverScorecard.ts` — add recommendation field + logic
- `src/components/DriverScorecard.tsx` — render recommendations
- `src/components/WeeklyCloseout.tsx` — add Week in Review card
- `src/hooks/useSmartAlerts.ts` — 4 alert message enhancements
- `src/lib/loadUtils.ts` — replace exportToPDF function
- `src/components/ProTimeSavedCard.tsx` (new)
- `src/components/DashboardView.tsx` — add ProTimeSavedCard

### What stays unchanged
- All database tables, edge functions, RLS policies, auth, billing, navigation, styling patterns

