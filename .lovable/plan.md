## Plan

1. Fix the screenshot upload flow in `ScanLoadModal.tsx`
- Remove the forced camera behavior from the hidden file input so mobile users get the normal image picker with access to Photos/Gallery as well as Camera.
- Keep the same modal, OCR flow, AI fallback, and user behavior after a file is selected.
- Mirror the safe pattern already used elsewhere in the app, but without forcing capture mode.

2. Harden pasted mileage parsing in `parseLoadText.ts`
- Expand text normalization before regex parsing to handle Telegram-specific paste artifacts such as invisible separators, non-standard spaces, and styled characters.
- Tighten mileage classification so deadhead-labeled values cannot win as loaded miles when trip/loaded/route/total mileage is also present.
- Add an explicit precedence rule for messages like the user’s sample:
  - `DH 25 miles`
  - `Trip: 257.10mi`
  - possible total mileage mentions such as `267 mile`
- Preserve current deadhead support and keep deadhead separate from loaded miles.

3. Strengthen the form autofill application in `LoadForm.tsx`
- Keep the atomic form update approach already in place.
- Add one more defensive guard so parser results from paste and screenshot flows are applied consistently, including when one mileage field is missing.
- Ensure the UI summary reflects exactly what was detected so the user can catch issues before saving.

4. Add regression coverage in `src/test/parseLoadText.test.ts`
- Add tests based on the exact Telegram sample from the screenshots.
- Add tests for total-mile wording variants and Telegram formatting edge cases.
- Add tests that prove deadhead and loaded miles never collapse into the same value when both are present.

5. Verify without changing product behavior
- Re-run the parser-focused test cases.
- Confirm the fix is limited to parsing and upload entry behavior only.
- Do not change routes, analytics, providers, backend behavior, or the existing deadhead-pay business logic.

## Expected outcome
- Pasting the Telegram load should populate loaded miles from the trip mileage instead of repeating deadhead.
- Deadhead miles should remain separate and continue to support the existing pay-status logic.
- Tapping “Scan Rate Con Screenshot” on mobile should open a normal image chooser that allows selecting screenshots from the photo library.

## Technical details

Files to update:
- `src/components/ScanLoadModal.tsx`
- `src/lib/parseLoadText.ts`
- `src/components/LoadForm.tsx`
- `src/test/parseLoadText.test.ts`

Key implementation notes:
- The current photo-upload bug is caused by `capture="environment"` on the hidden file input in `ScanLoadModal.tsx`.
- The current parser already supports `257.10mi` in tests, so the remaining fix should focus on real pasted Telegram normalization and stricter candidate selection rather than replacing the whole parser.
- No backend changes are needed for this fix.