# Pay-Model–Aware Load Form & Profit Engine

Upgrade HaulTrackerPro so loads work for owner-operators, lease-purchase, and 1099 contractor drivers — not just loaded-miles drivers. Strictly additive. No removal of existing fields, routes, or behaviors.

---

## Phase 1 — Audit (read-only, complete)

Confirmed current state:

- **`loads` table**: `loaded_miles`, `deadhead_miles`, `rate_per_mile`, `wait_fee`, `detention_fee`, `other_fees`, `gross_revenue`, `estimated_pay`, `actual_pay_received`. **No** `total_miles`, **no** `pay_model`, **no** separate deadhead rate column.
- **`user_settings`**: has `pay_type` (`cpm` | `percentage`), `pay_percentage`, `default_rate_per_mile`, `default_dh_pay_status` (`unpaid`|`same`|`custom`), `default_dh_pay_rate`. **No** `default_pay_model` column.
- **Deadhead pay** is currently encoded as a tag in `loads.notes`: `[dh_pay:unpaid|same|custom:RATE]`. Works but limited.
- **`calculateEstimatedPay`** in `src/lib/types.ts` = `loaded_miles × rate + fees`. The form adds a separate "deadheadRevenue" layer on top.
- **Parser** (`src/lib/parseLoadText.ts`) already handles loaded/deadhead well, has `needsMileageReview`. **Does not** detect or surface explicit "Total miles" as its own value, **does not** detect flat rate, **does not** detect a separate DH rate.
- **Scanner** (`ScanLoadModal.tsx` + `ai-insight` edge function): extracts `loaded_miles`, `deadhead_miles`, `rate_per_mile`, `estimated_pay`. **No** total miles, no flat rate, no pay model suggestion.
- **Calculations consuming miles/pay**: `loadUtils.ts` (week summaries, CSV/PDF export, profit CSV — uses `loaded_miles + deadhead_miles` as total), `useLoads`, `ReportsView`, `DashboardView`, `WeeklyCloseout`, `DriverScorecard`, `SmartLoadAdvisor`, `PersonalIntelligenceBlocks`, plus `recompute_lane_stats` / `recompute_operating_metrics` SQL functions (use `loaded_miles + deadhead_miles` as denominator).

---

## Phase 2 — Internal pay-model concept

Introduce a typed enum used everywhere on the client. **No DB change required for storage** — value lives alongside the DH tag inside `notes` to stay backward-compatible.

```ts
// src/lib/payModels.ts
export type PayModel =
  | 'loaded_miles_only'   // default for current users — no behavior change
  | 'total_miles'         // 1099 company / contractor paid all miles
  | 'loaded_plus_deadhead'// lease-purchase: loaded rate + DH rate
  | 'flat_rate'           // fixed pay per load
  | 'manual';             // user types expected gross directly

export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  loaded_miles_only: 'Loaded Miles Only',
  total_miles: 'Total Miles Paid',
  loaded_plus_deadhead: 'Loaded + Deadhead Pay',
  flat_rate: 'Flat Rate',
  manual: 'Manual',
};
```

A pure calculator returns:
```ts
computeLoadPay({ payModel, loadedMiles, deadheadMiles, totalMiles, loadedRpm, dhRpm, flatRate, manualGross, fees })
  → { paidMiles, totalOperatingMiles, expectedGrossPay, effectiveRpm, paidRpm, deadheadPct, warnings: string[] }
```

This is the single source of truth used by the form preview, dashboard, and reports.

## Phase 3 — Database (minimal, additive only)

To stay safe and shippable, **no destructive migration**. We add only what we cannot reasonably encode otherwise:

```sql
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS total_miles numeric,
  ADD COLUMN IF NOT EXISTS pay_model text,           -- nullable; null = legacy loaded_miles_only
  ADD COLUMN IF NOT EXISTS flat_rate_amount numeric;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS default_pay_model text;   -- nullable
```

- `loaded_rate_per_mile` reuses existing `rate_per_mile` (no new column).
- `deadhead_rate_per_mile` keeps using existing `default_dh_pay_rate` setting + the `[dh_pay:custom:RATE]` notes tag (no new column needed; lossless).
- `expected_gross_pay` continues to use existing `estimated_pay` (computed server-side trigger today is unchanged because we still write `estimated_pay` from the client — see Phase 8).
- All existing loads with `pay_model = NULL` are treated as `loaded_miles_only` (current behavior, zero regression).

## Phase 4 — Load form redesign (additive sections)

Reorganize `LoadForm.tsx` into clearer collapsible sections without losing any current field:

1. **Load Basics** — date, status, pickup, dropoff, multi-stop, notes (unchanged).
2. **Miles** — `Loaded/Trip`, `Deadhead`, `Total`. If two are entered, the third auto-fills (visible "auto" hint, user can override). Inline conflict warning if `loaded + deadhead ≠ total` by >2 mi. Helper text: *"Trip miles = loaded miles. Total miles = loaded + deadhead."*
3. **Pay Model** — Select (defaults to `default_pay_model` setting, then `loaded_miles_only`). Conditional fields:
   - `loaded_miles_only`: Loaded rate $/mi → expected pay = loaded × rate
   - `total_miles`: Rate $/mi → expected = total × rate
   - `loaded_plus_deadhead`: Loaded rate + Deadhead rate → expected = loaded·r1 + DH·r2
   - `flat_rate`: Flat amount → effective RPM = flat / total operating miles
   - `manual`: Expected gross + (optional) actual pay
4. **Fees & Adjustments** — wait, detention, other, actual pay (existing).
5. **Profit Preview card** — paid miles, total operating miles, expected gross, effective RPM, paid RPM, DH %, warnings.

Backward compat: when editing a legacy load (no `pay_model`), form opens in `loaded_miles_only` with current values intact. The existing `[dh_pay:...]` tag still drives DH pay for that mode.

## Phase 5 — Parser upgrades (`parseLoadText.ts`)

Add to `ParsedLoadData`:
```ts
total_miles?: string;
flat_rate?: string;
deadhead_rate_per_mile?: string;
pay_model_suggestion?: PayModel;
mileage_warning?: string;
```

New detection rules:
- **Total miles**: `total miles?`, `total mile`, `total trip miles?`, `total distance`, `all miles`, `TOTAL MILE: 264 mile`. Captured as `total_miles`.
- **Reconciliation**:
  - Trip + DH + Total → store all three; if `|loaded+dh − total| > 2`, set `mileage_warning`.
  - Total + DH only → loaded = total − dh; mark via `mileage_warning: "Loaded miles calculated from total minus deadhead. Please verify."`
  - Trip only → loaded = trip; total left blank.
  - Total only → store as `total_miles`; **do not** silently put it into `loaded_miles` (caller decides via pay model).
  - DH > Total or Total < Loaded → set `mileage_warning`.
- **Flat rate**: `flat\s*(rate|pay)?\s*[:=]?\s*\$?N`, `flat\s+\$?N`. Captured as `flat_rate`.
- **DH rate**: `dh\s*rate`, `deadhead\s*rate`, `empty\s*rate` → `deadhead_rate_per_mile`.
- **Pay-model suggestion**:
  - flat present → `flat_rate`
  - DH rate + loaded rate → `loaded_plus_deadhead`
  - rate present + total miles + no loaded → `total_miles`
  - default → `loaded_miles_only`

The user's example `Trip: 174.75mi / dh 90 MILE / TOTAL MILE: 264 mile / Rate: 0.80 / mile` now yields `loaded=174.75, dh=90, total=264, rate=0.80, pay_model_suggestion=loaded_miles_only`, with no warning (174.75 + 90 ≈ 264.75, within 2 mi tolerance).

## Phase 6 — Scanner / AI extraction

Update `PARSE_RATECON_TOOL` in `supabase/functions/ai-insight/index.ts`:
```jsonc
{
  "loaded_miles":          { "type": "number" },
  "deadhead_miles":        { "type": "number" },
  "total_miles":           { "type": "number" },          // NEW
  "rate_per_mile":         { "type": "number" },
  "deadhead_rate_per_mile":{ "type": "number" },          // NEW
  "flat_rate":             { "type": "number" },          // NEW
  "estimated_pay":         { "type": "number" },
  "pay_model_suggestion":  { "type": "string", "enum": [...] }, // NEW
  "mileage_warning":       { "type": "string" }           // NEW
}
```

Tighten system prompt to never invent values. `ScanLoadModal` preview adds Total Miles cell, Suggested Pay Model badge, Flat Rate cell, and shows `mileage_warning` in the existing amber alert pattern. Camera capture and gallery selection paths are unchanged.

## Phase 7 — Driver default setting

Add to Settings UI a "Default Pay Model" dropdown (persists `user_settings.default_pay_model`). Used by:
- New Load form initial value
- Parser/scanner suggestion fallback when nothing detected

If null, behavior matches today (`loaded_miles_only`).

## Phase 8 — Calculation updates

Centralize via `computeLoadPay` and use it in:
- `LoadForm` preview + submit (writes `estimated_pay` = `expectedGrossPay` so server triggers and existing dashboards keep working).
- `loadUtils.ts` exports (CSV gains `Total Miles`, `Pay Model`, `Effective RPM` columns appended to end — old columns unchanged).
- `WeekSummary.totalLoadedMiles`/`totalDeadheadMiles` unchanged; new optional `totalOperatingMiles` and `totalPaidMiles` computed.
- `DriverScorecard`, `SmartLoadAdvisor`, `PersonalIntelligenceBlocks`: use `total_operating_miles` (= `loaded + deadhead`, fallback to `total_miles` when present) for RPM denominators when computing "effective RPM"; existing "loaded RPM" calculations retained.
- SQL `recompute_lane_stats` / `recompute_operating_metrics` left as-is for this release (they already use `loaded + deadhead`, which matches `total_operating_miles` for legacy + new data). No migration needed.

Definitions enforced in code:
```
total_operating_miles = loaded + deadhead (or total_miles if explicitly set)
paid_miles depends on pay_model
effective_rpm = expected_gross / total_operating_miles
paid_rpm      = expected_gross / paid_miles
```

## Phase 9 — Validation & warnings

Inline, non-blocking amber alerts in form + parser/scanner preview:
- `loaded + deadhead ≠ total` (>2 mi tolerance)
- DH present but total/loaded missing
- Rate present but pay model not selected (auto-defaults but warn)
- `total < loaded`
- `dh > total`
- pay_model = `flat_rate` but flat amount missing
- pay_model = `total_miles` but total missing
- pay_model = `loaded_miles_only` but loaded missing

Hard validation only for: negative numbers, missing pickup/dropoff/date (existing rules unchanged).

## Phase 10 — Public copy

Surgical edits on Landing, Features, Pricing, FAQ, Pricing/copy on PasteLoadParser and ScanLoadModal:
- Add "Built for owner-operators, lease-purchase drivers, and 1099 contract drivers."
- Replace any blanket "loaded miles" claim with "trip miles, deadhead miles, and total miles."
- Add "Pick your pay model: loaded miles, total miles, loaded + deadhead, flat rate, or manual."

No new feature claims beyond what is implemented. `featureList.ts` updated accordingly.

## Phase 11 — Tests

Extend `src/test/parseLoadText.test.ts` and add `src/test/computeLoadPay.test.ts`:

Parser:
- Trip + DH + Total (the user's example) → all three fields, no warning
- Total + DH only → loaded derived, warning set
- Trip only
- Total only → `total_miles` only, `loaded_miles` undefined
- Loaded + DH mismatch with Total → warning
- DH > Total → warning
- Flat rate ("flat $850")
- Loaded rate + DH rate ("$2.10/mi loaded, $1.00/mi DH")
- Rate + total miles → suggestion = `total_miles`

Calculator: one test per pay model + edge cases (zero miles, manual override, flat with missing miles).

Regression: existing 55 tests must still pass; existing `parseLoadText` examples unchanged.

## Phase 12 — Final QA

- TypeScript check (`tsc --noEmit`)
- `bunx vitest run` (parser + calculator + no-trial language)
- `bun run build`
- Manual: log a load in each pay model; paste the user's Telegram-format example; scan a screenshot via gallery + camera capture; edit a legacy load; view dashboard, reports, CSV, PDF; viewport check at 375 / 715 / desktop.

---

## Files touched

**New**
- `src/lib/payModels.ts`, `src/lib/computeLoadPay.ts`
- `src/test/computeLoadPay.test.ts`
- one Supabase migration adding 3 columns on `loads` + 1 on `user_settings`

**Edited**
- `src/components/LoadForm.tsx` (sectioning, pay model select, profit preview)
- `src/components/PasteLoadParser.tsx`, `src/components/ScanLoadModal.tsx` (preview cells, warnings, pay-model badge)
- `src/lib/parseLoadText.ts` (+ tests)
- `src/components/SettingsView.tsx` (default pay model)
- `src/lib/loadUtils.ts` (CSV/PDF append-only columns; PDF totals row)
- `supabase/functions/ai-insight/index.ts` (extended tool schema + prompt)
- `src/lib/featureList.ts`
- `src/hooks/useUserSettings.ts` (new field in update type)
- Public copy: `src/pages/Landing.tsx`, `src/pages/Features.tsx`, `src/pages/Pricing.tsx`, `src/pages/FAQ.tsx` (small additions only)

**Untouched**
- Auth, Stripe edge functions, admin dashboard, parking, lead magnet, sitemap, RLS policies, SQL recompute functions, all existing column meanings.

## Final-report answers (after build)

The implementation will let the final report state truthfully:
- Owner-operators ✅ (loaded_miles_only default)
- Lease-purchase ✅ (loaded_plus_deadhead with separate DH rate)
- 1099 contractor drivers ✅ (total_miles)
- Telegram pasted load parses ✅ (with `total_miles` field surfaced)
- Screenshot upload from gallery ✅ (unchanged path, expanded preview)
- Camera capture ✅ (unchanged)
- Total / trip / deadhead miles all stored and reconciled ✅
- Pay calculations driven by selected pay model ✅
- Safe to promote ✅ once Phase 12 QA passes
