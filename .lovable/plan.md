# Phase 29E — Align Manual Drop Semantics with Save Logic

## Problem recap
- `normalizeEditorStopsForSave` only promotes a **trailing** Drop row to the top-level `dropoff_date`.
- `deriveExplicitFinalDropDate` returns **any** Drop row's date (highest `stop_order`), and `LoadForm` uses it for the inline "Final Drop stop date X will be used" note and the missing-final-date warning.
- `MultiStopEditor` lets any row be typed `Drop`.
- Result: an interior Drop row can suppress the warning and show a note about a date that is never actually saved.

## Fix strategy

Keep `deriveExplicitFinalDropDate` as-is for paste/scan/legacy DB paths (it's used by tests and ingestion). Introduce a manual-editor–specific helper and tighten the editor UX so the three surfaces (save, warning, inline note) agree.

### 1. `src/lib/stopNormalization.ts`
- Add `deriveTrailingDropDate(stops)`:
  - returns `stop_date` only when the **last** row (by `stop_order`, with ties broken by array position) is typed `Drop` AND has a valid ISO `stop_date`.
  - returns `null` otherwise (interior Drop, last row is Stop, missing date, invalid date).
- Keep `deriveExplicitFinalDropDate` unchanged so paste/scan and existing tests still work.

### 2. `src/components/LoadForm.tsx`
- Replace both manual-editor call sites of `deriveExplicitFinalDropDate(...)` with `deriveTrailingDropDate(...)`:
  - line ~342 (warning gate `explicitFinalDrop`)
  - line ~647 (inline "Final Drop stop date … will be used" note)
- No change to save logic — it already uses `normalizeEditorStopsForSave`, which is trailing-only and now matches the helper.

### 3. `src/components/MultiStopEditor.tsx`
Prevent interior-Drop creation:
- Only allow `Drop` in the type `Select` when the row is the **last** row (or it's already a legacy typed Drop being edited).
- When the user clicks **Add Stop** while the current last row is typed `Drop`, auto-demote that row to `Stop` before appending the new row (least disruptive — keeps the location/date the driver entered, just changes the type). Show no modal; the visual chip change is feedback enough.
- Removing a row that exposes a new last row leaves types alone (driver may want last row Stop).

### 4. Tests — `src/test/phase29eTrailingDropSemantics.test.ts` (new)
1. `deriveTrailingDropDate` returns `null` when an interior row is Drop and last row is Stop.
2. Returns the date when the trailing row is Drop with a valid `stop_date`.
3. Returns `null` when trailing Drop has no/invalid date.
4. Adding a row after a Drop row demotes that Drop → Stop (component test, or pure helper if extracted).
5. Save + warning + note all agree on the same input (parametrized): interior-Drop-only triggers warning and no note; trailing-Drop drives both save and note.

Existing suites (`finalDropoffDate`, `phase29a/b/c/d`) keep using `deriveExplicitFinalDropDate` and must continue to pass.

### 5. Optional cleanup (only if trivial)
- Skip the duplicate/legacy-handler and badge-count cleanup from the prompt's Phase 5 unless I find them already partially wired; otherwise leave for a follow-up.

## Files changed
- `src/lib/stopNormalization.ts` — add `deriveTrailingDropDate`
- `src/components/LoadForm.tsx` — swap helper at 2 sites
- `src/components/MultiStopEditor.tsx` — last-row-only Drop + auto-demote on Add Stop
- `src/test/phase29eTrailingDropSemantics.test.ts` — new regression suite

## Verification
- `npm run build`
- `npm run test` (expect all prior 395+ tests still green plus the new suite)

## Before vs after
| Surface | Before | After |
|---|---|---|
| Save (`normalizeEditorStopsForSave`) | trailing Drop only | unchanged |
| Inline note | any Drop row | trailing Drop only |
| Missing-date warning | suppressed by any Drop | suppressed only by trailing Drop |
| Editor UX | any row can be Drop | only last row; demote-on-append |
