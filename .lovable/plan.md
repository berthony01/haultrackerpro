## Strict analysis: does Cost Profile fold fixed monthly costs into each trip?

### What the math actually does (and does correctly)

In `src/hooks/useCostProfile.ts → computeCostProfileCPM`, the formula already does the right thing:

```
fixed share per mile =
  (truck_payment + trailer_payment + insurance_monthly
   + permits_licensing_monthly + eld_software_monthly + other_fixed_monthly)
  / estimated_monthly_miles
```

That `fixed` number is then added into the total CPM, and `useProfitCheck.ts` multiplies that CPM by the load's total miles to estimate variable cost and net pay on every trip. So the engine is wired correctly.

Example with your numbers: $1,000 truck + $200 trailer + $600 insurance + $100 permits + $80 ELD = $1,980/mo. With 10,000 mi/mo → **$0.198/mi** of fixed cost baked into every trip.

### Where it actually breaks (the real bugs)

These are why your screenshot shows CPM = $0.08/mi with only `maintenance · tires · tolls` — and no `fixed` line, even though Truck/Trailer/Insurance/Permits/ELD are all filled in.

1. **Silent drop when `Estimated monthly miles` is missing or 0.**
   `computeCostProfileCPM` skips the entire fixed bucket if `monthly_miles <= 0`. No warning, no toast, no badge. Your monthly fixed costs are simply ignored. The field is also buried at the bottom of the "Fixed monthly costs" section, so most drivers never set it.

2. **Field labels are ambiguous — drivers enter per-mile values into monthly fields.**
   In the screenshot you have **Truck payment = 0.06** and **Trailer payment = 0.02**. Those are per-mile numbers, not monthly payments. The label says "Truck payment" with no `$/month` suffix and no helper text, and it sits in a section called "Fixed monthly costs (per mile)"-adjacent to the variable section. With 0.06 + 0.02 + 600 + 100 + 80 = $780.08/mo, the fixed share *should* be $0.078/mi — but because the form lets numbers like 0.06 through, drivers under-report by 1,000×.

3. **No per-input "this adds $X/mi" feedback.**
   Drivers can't intuit that "$1,800 truck payment ÷ 10,000 mi = $0.18/mi". The live preview rolls everything into a single `fixed` bucket — drivers can't see that the truck payment alone is most of their cost-per-mile.

4. **Profit Check on each trip doesn't show the breakdown either.**
   `useProfitCheck` consumes the total CPM but the UI in `ProfitCheckCard` does not display the per-bucket CPM (fuel / maintenance / tires / tolls / **fixed**) for the load, so a driver can't see "of the $0.18/mi cost on this trip, $0.10 is your truck payment."

5. **`days_per_1000_miles` defaults to 2.5 inside the function** but the form leaves it blank for most drivers — fine for per-day costs (meals/lodging), but worth surfacing.

### Conclusion

The calculation engine is correct. The system *does* spread fixed monthly costs across miles. The failure is in the **form UX + missing guardrails + missing breakdown** — which is exactly what makes it look like "it doesn't calculate."

---

## Plan

Scope: Settings → Cost Profile form, the CPM preview, and the per-trip Profit Check card. No DB schema changes, no new tables, no business-logic rewrites. Only labels, validation, breakdown rendering, and one small math guardrail.

### 1. `src/components/CostProfileSettings.tsx`

- Rename labels to make units explicit:
  - "Truck payment" → "Truck payment ($/month)"
  - "Trailer payment" → "Trailer payment ($/month)"
  - "Insurance" → "Insurance ($/month)"
  - "Permits/licensing" → "Permits/licensing ($/month)"
  - "ELD/software/phone" → "ELD / software / phone ($/month)"
  - "Other fixed" → "Other fixed ($/month)"
- Add a one-line helper under the Fixed section: "Enter the dollar amount you pay every month. We divide by your monthly miles below to spread it across each trip."
- Promote **Estimated monthly miles** to the top of the Fixed section (not the bottom) and mark it required-for-fixed-costs.
- Add a soft validator: if any fixed field is > 0 and `estimated_monthly_miles` is empty/0, show an inline warning badge in the preview card: "Your fixed monthly costs aren't being applied — set Estimated monthly miles to spread them across each trip."
- Add a soft validator: if any fixed field is between 0 and 20 (looks like a per-mile entry, not a monthly bill), show a small hint under that input: "Looks low for a monthly bill. Enter the full $/month (e.g. 1800)."
- In the live CPM preview, expand the breakdown line so fixed is itemized:
  `fuel: $X · maintenance: $X · tires: $X · tolls: $X · truck: $X · trailer: $X · insurance: $X · permits: $X · eld: $X · other fixed: $X · per-day: $X`
  Only show buckets > 0.

### 2. `src/hooks/useCostProfile.ts → computeCostProfileCPM`

- Split the single `fixed` breakdown entry into per-line entries (`truck`, `trailer`, `insurance`, `permits`, `eld`, `otherFixed`) using the same `/ monthly_miles` formula. Keep total CPM identical.
- Add an optional return field `warnings: string[]` so the preview and Profit Check card can surface "Fixed costs ignored — set monthly miles" when applicable.
- Function signature stays backwards compatible (`cpm`, `breakdown` keep working; `warnings` is additive).

### 3. `src/components/ProfitCheckCard.tsx` (per-trip card)

- Already consumes `useProfitCheck`. Extend the card to render the per-bucket CPM breakdown for the load, using the same itemized list as the Settings preview, plus the **total $ cost on this trip per bucket** (CPM × total miles).
- If `warnings` includes "fixed share missing," show an amber notice with a "Fix in Settings → My Cost Profile" link.

### 4. `src/hooks/useProfitCheck.ts`

- Forward `breakdown` and `warnings` from `computeCostProfileCPM` into the `ProfitCheckResult` so `ProfitCheckCard` can render them. No formula changes.

### 5. Smoke test additions (optional, light)

- Add a unit test in `src/test/` for `computeCostProfileCPM` covering:
  - fixed share applied correctly when monthly_miles is set
  - fixed share dropped + warning emitted when monthly_miles is 0
  - per-bucket breakdown sums to total CPM

### Out of scope

- No schema changes.
- No changes to recurring expenses, fuel logs, or actual expense classification.
- No changes to user_settings, lane stats, broker stats, or alerts.
- No notification, email, or pricing changes.

### Verification

- Enter Truck = 1800, Trailer = 200, Insurance = 600, Permits = 100, ELD = 80, Monthly miles = 10000 → preview shows total ≈ $0.28/mi with itemized buckets including `truck: $0.18`.
- Clear Monthly miles → preview shows variable buckets only AND an amber "fixed not applied" warning.
- Open Profit Check on a load → card shows per-bucket CPM and per-bucket trip cost, fixed line included.
- Build passes. Existing Profit Check tests still pass.
