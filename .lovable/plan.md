Run a surgical Cost Profile reflection fix pass. Do not change styling, routes, database schema, pricing, Stripe, auth, reports, recruiter logic, parking logic, or unrelated files.

Scope:

- src/components/DashboardView.tsx

- src/components/LoadForm.tsx

- src/hooks/useCostProfile.ts

- src/hooks/useProfitCheck.ts

- src/components/ProfitCheckCard.tsx only if needed for totalMiles polish

- src/test/costProfileCPM.test.ts or a new focused test file

Fix 1: Dashboard Projected Net double-counting bug

In DashboardView.tsx, Projected Net currently does:

- computeCostProfileCPM(costProfile, totalMiles)

- variableCost = cpm * totalMiles

- separately calculates dailyCost from meals/lodging

- projectedNet = grossForProj - variableCost - dailyCost

This is wrong because computeCostProfileCPM already includes per-day costs inside cpm. Remove the manual dailyCost calculation and set:

projectedNet = grossForProj - variableCost;

Do not remove per-day logic from computeCostProfileCPM. Only remove the duplicate Dashboard subtraction.

Fix 2: Dashboard warning visibility

In DashboardView.tsx, destructure warnings from computeCostProfileCPM:

const { cpm, warnings } = computeCostProfileCPM(costProfile, totalMiles);

If warnings includes fixed_missing_monthly_miles, show a small warning state/chip/subtitle on the Projected Net tile saying:

“Fixed costs not applied — set monthly miles”

Make the tile clickable to Settings if possible, consistent with the existing “Set up” behavior.

Fix 3: LoadForm live preview warning

In LoadForm.tsx, stop discarding warnings:

const costProfileResult = computeCostProfileCPM(costProfile, totalMi);

const cpm = costProfileResult.cpm;

If costProfileResult.warnings includes fixed_missing_monthly_miles, show a small inline amber note inside the live financial preview:

“Fixed monthly costs are not included yet. Add estimated monthly miles in Settings.”

Do not change the live preview math except for reading warnings.

Fix 4: Fixed-only profile warning flow

In src/hooks/useCostProfile.ts, update profileHasUsableData so fixed costs count as usable data even when estimated_monthly_miles is missing. The goal is not to apply fixed costs without miles. The goal is to allow computeCostProfileCPM() to run so it can return fixed_missing_monthly_miles.

Current behavior blocks the warning. New behavior should allow:

- fuel profile

- variable per-mile profile

- fixed-only profile with monthly miles

- fixed-only profile without monthly miles, but warning must surface

Fix 5: useProfitCheck warning preservation

In useProfitCheck.ts, ensure fixed-only profiles with missing miles use costSource “profile” or otherwise preserve costWarnings so ProfitCheckCard can show the fixed_missing_monthly_miles warning.

Do not allow history fallback to hide the fixed cost warning when the user has entered fixed costs but forgot monthly miles.

Fix 6: Optional polish

If low-risk, pass totalMiles through ProfitCheckResult instead of reverse-deriving it in ProfitCheckCard. If this adds risk, skip it.

Tests:

Add focused tests covering:

1. computeCostProfileCPM includes per-day cost once.

2. Dashboard-style projected net should not subtract per-day costs twice.

3. fixed-only profile with missing estimated_monthly_miles still surfaces fixed_missing_monthly_miles.

4. useProfitCheck should not silently hide the fixed_missing_monthly_miles warning by falling back to history.

Acceptance criteria:

- Projected Net no longer subtracts meals/lodging twice.

- Settings, LoadForm, ProfitCheckCard, and Dashboard all communicate when fixed monthly costs are not applied because estimated monthly miles is missing.

- Existing Cost Profile math remains unchanged.

- TypeScript/build/test must pass.

- No unrelated files changed.

# Cost Profile — Strict Calculation & Reflection Audit

Scope reviewed:

- `src/hooks/useCostProfile.ts` — `computeCostProfileCPM`, `profileHasUsableData`
- `src/hooks/useProfitCheck.ts` — load-level cost application
- `src/components/CostProfileSettings.tsx` — settings UI + live CPM preview
- `src/components/ProfitCheckCard.tsx` — per-load breakdown UI
- `src/components/LoadForm.tsx` (lines ~890–905) — live financial preview
- `src/components/DashboardView.tsx` (lines ~346–415) — "Projected Net" tile

Test coverage: `src/test/costProfileCPM.test.ts`

---

## Verdict

The core CPM math in `computeCostProfileCPM` is **correct** — fixed monthly costs are spread per mile, variable per-mile costs are added, and per-day costs are amortized over miles. Unit tests confirm fixed-cost spreading and the missing-miles warning.

However, the **Dashboard "Projected Net" tile contains a real double-counting bug**, and several places where Cost Profile data is consumed do not surface the same warnings the Profit Check card does. Result: a driver who "fills everything out" will see a correct number on the Profit Check card, but a **wrong (more pessimistic) number** on the Dashboard's Projected Net.

---

## Findings

### 1. BUG — Per-day costs double-counted in Dashboard "Projected Net"

`DashboardView.tsx` (~lines 358–364):

```text
const { cpm } = computeCostProfileCPM(costProfile, totalMiles);
const variableCost = cpm * totalMiles;                  // already includes perDay share
const daysPer1k    = Number(costProfile?.days_per_1000_miles ?? 2.5) || 2.5;
const days         = (totalMiles / 1000) * daysPer1k;
const perDay       = Number(costProfile?.meals_per_day ?? 0) + Number(costProfile?.lodging_per_day ?? 0);
const dailyCost    = days * perDay;
projectedNet = grossForProj - variableCost - dailyCost; // ← per-day subtracted TWICE
```

`computeCostProfileCPM` already includes a `perDay` bucket in `breakdown` and in `cpm`:

```
breakdown.perDay = (perDay * days) / totalMiles
```

Multiplying that `cpm` by `totalMiles` already reintroduces `perDay * days`. Subtracting `dailyCost` again is wrong.

Concrete example — driver with $50/day meals, $0 lodging, 2.5 days/1000 mi, totalMiles=10,000:

- Per-day contribution to CPM: (50 × 25) / 10,000 = $0.125/mi
- `variableCost` includes $1,250 of per-day already.
- Dashboard then subtracts another `dailyCost = 25 × 50 = $1,250`.
- Projected Net is **$1,250 low** in this period for that single driver setting.

Fix direction: use only `variableCost = cpm * totalMiles` (and drop the manual `dailyCost`). This makes Dashboard consistent with `useProfitCheck` and `LoadForm` live preview, which already do it correctly.

---

### 2. UX gap — Dashboard silently drops fixed costs when monthly miles missing

`computeCostProfileCPM` returns `warnings: ['fixed_missing_monthly_miles']` when fixed costs are set but `estimated_monthly_miles` is empty. The Dashboard discards the warnings array entirely. So a driver who entered $1,800 truck + $600 insurance but forgot monthly miles sees:

- Settings preview: amber warning (good).
- Profit Check card on a load: amber warning (good).
- **Dashboard Projected Net: no warning, fixed costs simply disappear** → number looks falsely high.

Fix direction: when `warnings.includes('fixed_missing_monthly_miles')`, either show a small amber chip on the Projected Net tile ("Fixed costs not applied — set monthly miles") or substitute the "Set up" state.

---

### 3. UX gap — LoadForm live preview hides the same warning

`LoadForm.tsx` ~line 900:

```text
const cpm = computeCostProfileCPM(costProfile, totalMi).cpm;
const estExpenses = cpm * totalMi;
```

Same pattern: the `warnings` field from the destructured result is discarded. The user sees a "Net Profit" inside the form that excludes fixed costs without telling them, even though the Profit Check card immediately below it does warn. Two numbers, two truths.

Fix direction: surface a small inline note in the live preview when `warnings.includes('fixed_missing_monthly_miles')`.

---

### 4. Behavior — `profileHasUsableData` blocks fixed-only profiles

`profileHasUsableData`:

```text
return fuelOk || anyVariable || (anyFixed && estimated_monthly_miles > 0);
```

A driver who enters only fixed costs (truck/insurance/permits) but forgets monthly miles is considered to have **no usable profile** → `useProfitCheck` falls back to history (likely 0), and the Profit Check card shows "Estimate only" instead of the missing-miles warning. The hook's own warning never fires because `profileHasUsableData` short-circuits before `computeCostProfileCPM` runs.

Fix direction: treat "fixed entered but no monthly miles" as usable-but-warn — call `computeCostProfileCPM` anyway so the warning surfaces in the Profit Check card with a clear CTA, instead of silently degrading to history.

---

### 5. Fragile — ProfitCheckCard reverse-derives total miles

`ProfitCheckCard.tsx` ~line 129:

```text
const totalMiles = result.estimatedVariableCost > 0 && result.effectiveRpm > 0
  ? result.estimatedGross / result.effectiveRpm
  : 0;
```

This works arithmetically (`effectiveRpm = gross / totalMiles` ⇒ `totalMiles = gross / effectiveRpm`) but is fragile and floating-point-noisy. The hook already knows `totalMiles` — it should pass it through on `ProfitCheckResult` so the per-bucket trip cost line is exact.

Not a correctness bug today, just brittle.

---

### 6. Minor — "Looks low for monthly bill" hint may false-positive

`CostProfileSettings.tsx` `lowMonthlyHint` flags any monthly value `< 20` as suspicious. That correctly catches a driver typing `0.18` thinking it's `$/mi`, but also flags legitimate small monthly fees (e.g., a $10/mo add-on rider, $15 phone line share). Low-impact; consider tightening to `< 5` or wording it as a soft suggestion only.

---

### 7. Minor — `min_margin_pct` check requires `cpm > 0`

`useProfitCheck.ts` line 150:

```text
const meetsMinMargin = profileMinMargin != null && cpm > 0 ? estimatedMarginPct >= profileMinMargin : null;
```

If a driver has set a `min_margin_pct` target but `cpm === 0` (e.g., fixed-only profile + missing miles, see finding #4), the verdict is rendered as "no opinion" instead of warning that we couldn't evaluate it. Same root cause as #4; fixing #4 fixes this naturally.

---

## What is verified correct

- `computeCostProfileCPM` math: fuel (`diesel / mpg`), per-mile variables, fixed share (`bill / monthlyMiles`), per-day share (`(meals+lodging) * days / totalMiles`) — all dimensionally correct and unit-tested.
- `useProfitCheck` cost-source priority: profile > 60-day history > none. Correct.
- `useProfitCheck` per-load math: `variableCost = cpm * totalMiles`, `net = gross - variableCost`, `marginPct = net/gross*100`. Correct, no double counting.
- `LoadForm` live preview cost math itself (only the warning surfacing is missing).
- `ProfitCheckCard` per-bucket breakdown ordering and sum equality to `cpm` (covered by test).
- Settings live preview: itemized buckets, warning banner, required-field styling on Estimated monthly miles — all correct.

---

## Recommended fix order (no code changes yet — awaiting approval)

1. **Critical — DashboardView Projected Net**: drop the manual `dailyCost` subtraction; use `variableCost = cpm * totalMiles` only.
2. **Critical — Dashboard warning surfacing**: when `computeCostProfileCPM(...).warnings` contains `fixed_missing_monthly_miles`, show an amber chip on the Projected Net tile linking to Settings → Cost Profile.
3. **High — LoadForm live preview**: surface the same warning inline so the form and the Profit Check card never disagree.
4. **High — `profileHasUsableData` / `useProfitCheck**`: allow fixed-only profiles to flow through so the missing-miles warning reaches the driver instead of falling back to history.
5. **Low — pass `totalMiles` through `ProfitCheckResult**` to remove the gross/rpm reverse-derivation in the breakdown row.
6. **Optional polish — tighten the `< 20` "looks low" threshold or reword it.

No database, schema, or business-logic changes are required. All fixes are localized to:

- `src/components/DashboardView.tsx`
- `src/components/LoadForm.tsx`
- `src/hooks/useProfitCheck.ts` (small)
- `src/hooks/useCostProfile.ts` (small — `profileHasUsableData`)
- `src/components/ProfitCheckCard.tsx` (polish only)

Existing tests in `src/test/costProfileCPM.test.ts` continue to pass; one new test should cover the Dashboard scenario (per-day not double-counted) and the fixed-only-no-miles path.