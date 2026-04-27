## Audit summary

I traced the load-paste flow end to end.

- The mileage parsing bug is not coming from the backend or edge functions. The actual extraction is fully client-side in `src/lib/parseLoadText.ts`.
- Backend involvement is limited to `parse_usage` tracking; no edge function is calculating or altering miles.
- The current parser already intends to support attached units like `257.10mi`, `257.10mile`, and `257.10miles`.
- The real weak points are:
  1. Telegram paste text can contain formatting characters the parser is not fully normalizing.
  2. `LoadForm.tsx` applies parsed values field-by-field and only updates a field when a value exists. If a new paste misses `loaded_miles`, the old value can remain in the form, which makes the result look duplicated or wrong.
  3. There is no strong end-to-end regression test for your exact Telegram format plus the UI application step.
- Your screenshots confirm the source message contains both `DH 25 miles` and `Trip: 257.10mi`, while the form ended up showing `25 / 25`. That means the current solution is not reliable enough.

## My recommendation

If I were maintaining HaulTrackerPro, I would solve this in two layers:

1. Fix the parser and form-application flow first.
2. Add address-based mileage calculation later only as a fallback, not as the primary source of truth.

Why: broker/dispatcher pasted miles are usually the operational number the driver is being quoted from. Free routing APIs can estimate road distance, but they are not guaranteed to match dispatch miles, paid miles, or truck routing.

So yes, there is a free-ish way to calculate miles later using a provider like OpenRouteService, but I would not use that to hide a parser bug. I would keep it as:
- manual “Calculate from addresses” fallback, or
- auto-fill only when pasted trip miles are missing.

## Plan

### Phase 1 — Reproduce the exact regression
- Add a regression test using the exact Telegram sample structure:
  - pinned preview line
  - numbered stops
  - `DH 25 miles`
  - `Trip: 257.10mi`
- Add a UI-level test or deterministic helper test for the paste application logic so we verify the form ends with:
  - loaded miles = `257.10`
  - deadhead miles = `25`
- Add a second regression case for the user-reported “267 total miles” variant so total/trip labels are handled predictably.

### Phase 2 — Harden text normalization
In `src/lib/parseLoadText.ts`:
- Normalize the full pasted string more aggressively before matching:
  - Unicode normalization (`NFKC`)
  - strip zero-width / formatting characters
  - normalize non-breaking and odd-width spaces to regular spaces
  - preserve decimal points and attached units
- Keep support for bold Telegram letters/digits, but expand normalization so clipboard quirks do not break matching.

### Phase 3 — Make mileage classification deterministic
Refactor mileage extraction so the same token cannot be reused incorrectly.

Rules:
- Capture all `number + unit` forms including:
  - `257.10mi`
  - `257.10 mi`
  - `257.10mile`
  - `257.10 miles`
- Classify tokens by nearby labels and line context.
- Prefer explicit loaded labels in this order:
  - `loaded`
  - `trip`
  - `linehaul`
  - `route`
  - `distance`
  - `total`
- Classify deadhead only from deadhead-specific context:
  - `dh`
  - `deadhead`
  - `empty`
  - `bobtail`
  - `reposition`
- Prevent one value from filling both loaded and deadhead.
- If both a trip/loaded number and a deadhead number exist, always keep them separate.
- If a `total miles` number appears in the same paste, use it as a fallback or cross-check, not something that can overwrite a stronger `trip/loaded` match.

### Phase 4 — Fix the paste-to-form application flow
In `src/components/LoadForm.tsx` and/or `src/components/PasteLoadParser.tsx`:
- Apply parsed data in one atomic form update instead of many individual field updates.
- On a new paste:
  - replace detected mileage fields intentionally
  - clear stale parsed mileage when the new paste does not provide that field
- Preserve user behavior:
  - no routing changes
  - no auth/billing changes
  - no backend dependency added
- Keep the existing warning when deadhead is detected but trip/loaded miles are missing, and make that warning dependable.

### Phase 5 — Strict verification
Run a strict audit after implementation:
- unit tests for parser variants
- regression tests for the Telegram sample
- verification that `257.10mi` and the other attached-unit formats all work
- verification that deadhead no longer duplicates into loaded miles
- verification that repeated paste actions do not leave stale mileage behind
- TypeScript check and existing test suite check

### Phase 6 — Optional free fallback after the parser is stable
If you still want automatic mileage calculation from addresses:
- add a lightweight manual fallback later
- use a free provider like OpenRouteService
- keep it out of the critical paste flow at first
- only use it when pasted miles are missing or when the user taps “Calculate from addresses”

This keeps the core product reliable and avoids silently replacing broker-provided miles with an estimate.

## Technical details

### Files I would update
- `src/lib/parseLoadText.ts`
- `src/test/parseLoadText.test.ts`
- `src/components/LoadForm.tsx`
- possibly `src/components/PasteLoadParser.tsx`

### What I would not touch
- auth flow
- routing
- Stripe logic
- edge functions
- load table structure for this parser fix

### Related audit note
The current deadhead-pay preference is separate from this parsing bug. I would not expand that logic further until the parser regression is fixed and verified. If we later keep paid-deadhead earnings in the UI, I would do a separate audit to ensure displayed calculations and stored analytics stay consistent.

## Expected outcome

After this work:
- pasted Telegram loads will correctly separate deadhead and trip miles
- attached-unit formats like `257.10mi` will parse reliably
- stale field values will no longer make the form look like miles were duplicated
- the app behavior outside this flow will remain unchanged