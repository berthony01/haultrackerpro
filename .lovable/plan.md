## Phase 29 — Multi-Stop Final Drop-Off Date Repair

**Problem.** Multi-stop loads can't store per-stop dates, so the final delivery date never reaches `loads.dropoff_date`. On submit, `LoadForm` writes `dropoff_date: form.dropoff_date || form.load_date`, and the drop-off input visually displays `form.dropoff_date || form.load_date` — masking blank values. Result: a load picked up May 29 / delivered May 30 silently bucket-files under May 29.

**Rule we are enforcing (no second formula).**
Financial Reporting Date = `getEffectiveDate(load) = load.dropoff_date ?? load.load_date` — unchanged. The fix is making sure `loads.dropoff_date` is correctly populated from the final stop on save.

---

### Audit confirmed

1. `getEffectiveDate` in `src/lib/loadUtils.ts` returns `dropoff_date ?? load_date`. ✔ keep as-is.
2. Dashboard / Reports / Alerts / WeeklySummaries / CSV exports all already route through `getEffectiveDate` (verified in `loadUtils.ts`, `reportAggregator.ts`, `useSmartAlerts.ts`).
3. `load_stops` schema (in supabase tables): `id, user_id, load_id, stop_order, location, stop_type, detention_minutes, created_at, updated_at` — **no stop_date column**.
4. `MultiStopEditor.tsx` exposes only stop_type, location, detention_minutes — no date input.
5. `LoadForm.handleSubmit` (line 304) writes `dropoff_date: form.dropoff_date || form.load_date`.
6. `<DateInput id="dropoff_date" value={form.dropoff_date || form.load_date} ...>` (line 569) — masks blank dropoff with load_date.
7. Paste (`parseLoadText`) and Scan (`ScanLoadModal`) detect multi-stop locations but do not associate dates with individual stops.

---

### Plan

**1. DB migration — add `stop_date` to `load_stops**`

- `ALTER TABLE public.load_stops ADD COLUMN stop_date date NULL;` (nullable, no backfill)
- No RLS / grant changes.

**2. `src/hooks/useLoadStops.ts**`

- Extend `LoadStop` and `LoadStopInput` with `stop_date?: string | null`.
- Include in select * (auto), insert mapping in `saveStopsForLoad` (`stop_date: s.stop_date ?? null`).

**3. `src/components/MultiStopEditor.tsx**`

- Add a `DateInput` (label "Stop Date", placeholder "MM/DD/YYYY") per stop row.
- Helper text above the list: "The final drop-off stop date controls dashboard, reports, weekly totals, and exports."
- Emphasize the date field when `stop_type === 'Drop'` (subtle ring/border using existing tokens — no redesign).

**4. `src/lib/loadUtils.ts` — add `deriveFinalDropoffDate` helper (single source of truth)**

```ts
export function deriveFinalDropoffDate(
  stops: { stop_order: number; stop_type: string; stop_date?: string | null }[]
): string | null {
  if (!stops?.length) return null;
  const dropDated = stops.filter(s => s.stop_type?.toLowerCase() === 'drop' && s.stop_date);
  if (dropDated.length) return dropDated.sort((a,b) => b.stop_order - a.stop_order)[0].stop_date!;
  const anyDated = stops.filter(s => s.stop_date);
  if (anyDated.length) return anyDated.sort((a,b) => b.stop_order - a.stop_order)[0].stop_date!;
  return null;
}
```

**5. `src/components/LoadForm.tsx` — save-path fix**

- In `handleSubmit`, before calling `onSubmit`:
  ```ts
  const finalStopDate = multiStop ? deriveFinalDropoffDate(formattedStops) : null;
  const resolvedDropoff = finalStopDate ?? (form.dropoff_date || form.load_date);
  ```
  Use `resolvedDropoff` for `dropoff_date`.
- **Remove UX masking** on the Drop-off Date input:
  - Change `value={form.dropoff_date || form.load_date}` → `value={form.dropoff_date}`.
  - Adjust the pickup-onChange sync at line 561 (which writes pickup date into blank dropoff) — keep it ONLY when not multi-stop and the user hasn't typed a dropoff.
  - Add helper text under the input: "Used for dashboard, weekly totals, reports, and exports. For multi-stop loads, the final stop date will be used."
  - When `multiStop` is on and a `finalStopDate` is derived, show an inline note: "Final stop date {date} will be used for reporting."

**6. Multi-stop save warning (inline, non-blocking)**

- In `validate()` (or just before submit), if `multiStop && stops.length >= 2 && !deriveFinalDropoffDate(stops) && (!form.dropoff_date || form.dropoff_date === form.load_date)`:
  - Set a warning state and render an inline alert above the submit button: "Final stop date is missing. This load may be counted on the pickup date instead of the delivery date. Save anyway?"
  - First submit click sets the warning + returns; second click (with `acknowledgedDropWarning` true) proceeds. Matches existing quick-entry behavior — not a hard block.

**7. Paste parser — `src/lib/parseLoadText.ts**`

- Extend `ParsedStop` (if it exists; otherwise `ParsedLoadData.stops`) with optional `stop_date?: string`.
- Conservative regex: only capture a date adjacent to a stop line in `MM/DD`, `MM/DD/YYYY`, or `YYYY-MM-DD` shape. If parse confidence low, leave null.
- `LoadForm` paste handler maps parsed `stops[i].stop_date` into the new MultiStopEditor field.

**8. Scan/OCR — `src/components/ScanLoadModal.tsx` + `supabase/functions/parse-contract` (or scan edge function)**

- Add optional `stop_date` to AI extraction schema for each stop.
- Map returned `stop_date` into stops; if AI returns top-level `dropoff_date` only, keep current behavior.

**9. CSV import — `src/components/CSVImport.tsx**`

- No change needed. Existing `delivery_date` → `dropoff_date` mapping (Phase 29 prior work) stays. Multi-stop CSV import not in scope.

**10. Tests — `src/test/**`

- New `finalDropoffDate.test.ts`:
  - `deriveFinalDropoffDate` — drop+date wins; multiple drops → highest stop_order; no drops with date → highest dated stop; no dated stops → null.
  - Scenario: pickup May 29, final drop stop May 30 → saved `dropoff_date = '2026-05-30'`.
  - Dashboard range: same load appears in Mon-start week containing May 30, not pickup-only week.
- Extend `MultiStopEditor` render test: stop_date input renders and onChange propagates.
- `parseLoadText.test.ts`: parsed stop_date when present; null when absent (no crash).
- Regression: ensure `effectiveDateAndDuplicate.test.ts`, security tests, starter-kit tests, Phase 23 tests still pass.

**11. Verify**

- `npm run build`, `npm run test`. Lint via supabase linter for the migration.

---

### Files touched

- **Migration (new):** `supabase/migrations/<ts>_load_stops_stop_date.sql`
- **Edited:** `src/hooks/useLoadStops.ts`, `src/components/MultiStopEditor.tsx`, `src/components/LoadForm.tsx`, `src/lib/loadUtils.ts`, `src/lib/parseLoadText.ts`, `src/components/ScanLoadModal.tsx`
- **Tests (new/edited):** `src/test/finalDropoffDate.test.ts`, `src/test/parseLoadText.test.ts`, `src/test/multiStopEditor.test.tsx` (if not present, add small render test)

### Out of scope

Phase 23 pay formulas, recruiter security, starter kit, pricing/billing, SEO, UI redesign beyond the date input + helper text + warning, CSV multi-stop import.

### Open questions

None — proceeding with: warning is a confirm-then-save pattern (not a hard block), and stop_time is deferred.

ADD THESE REQUIREMENTS TO PHASE 29 BEFORE IMPLEMENTATION

1. Supabase generated types must be updated

After adding load_stops.stop_date, update the Supabase TypeScript types so stop_date exists in:

- Row

- Insert

- Update

Do not rely only on manual interface edits.

2. Validate stop_date format before using it

deriveFinalDropoffDate must ignore invalid dates.

Only use valid YYYY-MM-DD dates.

Do not allow malformed dates to become loads.dropoff_date.

3. Editing existing multi-stop loads must work

When editing an existing load:

- existing stop_date values must load into MultiStopEditor

- edited stop_date values must save correctly

- removing a stop must not leave stale stop_date data

- reordering stops must still use the highest stop_order dated drop stop

4. Duplicating a multi-stop load must not carry old stop dates

When duplicating a load:

- reset load_date to today

- reset dropoff_date to today or blank based on existing duplicate behavior

- reset all copied stop_date values to null or today

- do not duplicate an old final stop date into a new load

5. Final stop date must override manual dropoff_date only when multi-stop is enabled and a valid final stop date exists

Rule:

- if multiStop and valid final stop date exists: use final stop date

- else if manual dropoff_date exists: use manual dropoff_date

- else use load_date

6. Add explicit test for manual dropoff fallback

Test:

- multi-stop load with no stop dates but manual dropoff_date = May 30 saves dropoff_date = May 30

7. Add explicit test for duplicate behavior

Test:

- duplicated load does not keep old stop_date/dropoff_date from previous load

8. Add manual QA checklist

Verify:

- create one-stop load

- create two-stop load picked up May 29, delivered May 30

- create three-stop load with final drop May 30

- edit final stop date and confirm dashboard week changes

- duplicate old multi-stop load and confirm old drop date is not carried forward

- paste load with no stop dates and confirm warning appears

- scan load with stop dates and confirm final stop date is used