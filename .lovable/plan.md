## What I found

- The mileage parser lives in `src/lib/parseLoadText.ts`.
- The form wiring in `src/components/LoadForm.tsx` already maps `loaded_miles` and `deadhead_miles` into separate fields, so the visible `25 / 25` result is most likely coming from the parser missing the Trip value in the real paste, not from the form swapping fields.
- The screenshot scan flow in `src/components/ScanLoadModal.tsx` still starts OCR immediately after file selection. That means the current UX is not a true “choose file -> preview -> confirm extraction” flow yet.
- The camera flow is also still tied to `capture="environment"`, so mobile behavior can still feel forced or inconsistent depending on which input gets triggered.

## Plan

1. Harden Telegram load-mile parsing in `src/lib/parseLoadText.ts`
   - Add a first-pass, line-level matcher for loaded-mile labels before the generic mileage classifier runs.
   - Explicitly support `Trip`, `Trip Miles`, `Trip Mileage`, `Trip Distance`, `Total Trip`, and `Loaded Trip`, including emoji-prefixed variants.
   - Keep `Trip ID` excluded by requiring a numeric mileage value after the label.
   - Preserve deadhead precedence separately so `DH 25 miles` never overwrites loaded miles.

2. Keep the existing parser as a fallback, not a rewrite
   - Use the new explicit Trip/Loaded line matcher as the highest-priority source.
   - Fall back to the current generic token/context logic for all the formats that already work today.
   - Add source tracking internally so development logs can show whether loaded miles came from `trip-line`, `loaded-line`, or generic context.

3. Strengthen regression coverage in `src/test/parseLoadText.test.ts`
   - Add exact tests for the user’s Telegram sample and the failing `Trip: 257.10mi` pattern.
   - Add guard tests for `Trip ID`, `DH 25 miles`, `Trip Distance`, and same-message mixed cases.
   - Add a regression asserting the final parsed result is:
     - `loaded_miles = 257.10`
     - `deadhead_miles = 25`

4. Fix the screenshot scan UX in `src/components/ScanLoadModal.tsx`
   - Change the flow to: select image -> preview image -> user taps `Extract Info` -> OCR/parsing starts.
   - Keep separate `Choose from Gallery` and `Take Photo` actions.
   - Ensure the gallery action opens the normal picker and the camera action is the only one that can request capture.
   - Keep the privacy behavior: image stays local to the device/browser session and only extracted text is parsed.
   - Add clearer loading, success, and failure states around the actual extraction step.

5. Verify end-to-end in the load form
   - Paste the exact Telegram message into `Paste Load Info` and verify the form shows `Loaded Miles = 257.10` and `Deadhead Miles = 25`.
   - Test the uploaded screenshot flow to confirm: gallery selection works, preview appears before extraction, replace works, and extraction feedback is visible.
   - Do not change navigation, tabs, load layout, payment tracking, or other working form behavior.

## Technical details

Files to update:
- `src/lib/parseLoadText.ts`
- `src/test/parseLoadText.test.ts`
- `src/components/ScanLoadModal.tsx`
- `src/components/LoadForm.tsx` only if a tiny UI integration tweak is needed for the new scan flow

Planned loaded-mile regex family:
```ts
/(?:🚛|🚚)?\s*(?:loaded\s*)?(?:total\s*)?(?:trip|trip\s*miles|trip\s*mileage|trip\s*distance)\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mi|mile|miles)\b/i
```

Acceptance criteria:
- `Trip: 257.10mi` fills Loaded Miles
- `DH 25 miles` still fills Deadhead Miles
- `Trip ID : T-1123J49SR` does not get mistaken for mileage
- Scan modal supports gallery upload, pre-parse preview, replace, loading state, and success/error feedback