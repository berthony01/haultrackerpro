
# Pre-fix audit findings (Phase 1)

Confirmed by reading the actual source:

1. **Scanner privacy copy is misleading** — `src/components/ScanLoadModal.tsx:207` says: *"Image is processed on your device and never uploaded or stored."* But `parseWithAI` (line 16-48) sends OCR text to the `ai-insight` edge function. The image stays local; the **extracted text does not**. Copy must be corrected.
2. **Gallery vs camera capture** — already separate inputs (`galleryRef` accept=`image/*`, `cameraRef` adds `capture="environment"`). Both work. ✅
3. **AI schema does not include `deadhead_miles`** — `PARSE_RATECON_TOOL` in `supabase/functions/ai-insight/index.ts:71-105` lists `loaded_miles`, `rate_per_mile`, `estimated_pay`, etc., but **no `deadhead_miles`**. System prompt also doesn't mention it.
4. **Frontend AI mapping drops deadhead** — `parseWithAI` in `ScanLoadModal.tsx:26-40` maps `loaded_miles` but never reads `parsed.deadhead_miles`. Even if AI returned it, it would be lost.
5. **Scan preview lacks deadhead row** — preview grid (lines 261-298) shows pickup, dropoff, miles, rate, gross, date — no deadhead row.
6. **No warning when deadhead detected but loaded missing** — `PasteLoadParser` shows a `toast.warning` *only when* `parsed.deadhead_miles && !parsed.loaded_miles`. Scan modal has no such warning at all. Toasts are easy to miss; we need an inline warning.
7. **Paste parser "Total miles" ambiguity** — `parseLoadText.ts:322-328` falls back to `total\s*miles?` as loaded miles even when explicit deadhead exists. Combined with the explicit-line matcher (line 261-262) which lists `total\s+` as a loaded prefix, `Total miles: 282` + `Deadhead: 25` would currently set `loaded_miles=282`, which is wrong (282 likely already includes the 25 DH).
8. **Public copy overclaims "Deadhead Pay Parsing"** — `src/lib/featureList.ts:48` claims the parser "separates [deadhead pay] from line-haul revenue automatically." The parser only extracts deadhead **miles**, not deadhead **pay/rate split**. Overstated.
9. **`.env` is tracked, `.gitignore` does not exclude it** — `.gitignore` has `*.local` but not `.env`. `.env` exists at repo root with the Supabase publishable URL/key (publishable, not secret — but still should not be in shared exports).
10. **Tests** — `parseLoadText.test.ts` already has `Total Miles: 999\nTrip Miles: 257.10 → 257.10` and `Total miles: 267 mile\nDH 25 miles → 267`. The new ambiguity behavior (DH + bare "Total miles" → no confident loaded) needs new tests, and we must keep `Total miles: 267 + DH 25 → 267` as a deliberate "explicit total label" path OR update that test to expect a warning. Plan below resolves this by treating `total miles` as still-acceptable when no other candidate exists, but downgrading it so it never overrides an explicit `loaded`/`trip`/`linehaul`.

---

# Plan

## Phase 2 — Scanner privacy copy
**File:** `src/components/ScanLoadModal.tsx` (lines 204-209)

Replace the `ShieldCheck` panel copy with:
> *"Your image is read on your device. The extracted text may be sent to our AI to help fill the form. Nothing is saved until you review and confirm."*

Keep the same icon, layout, and styling so mobile + desktop visuals are unchanged.

## Phase 3 — AI deadhead support
**File:** `supabase/functions/ai-insight/index.ts`

- Add `deadhead_miles: { type: "number", description: "Empty/deadhead miles only — do not guess; omit if not explicitly present" }` to `PARSE_RATECON_TOOL.parameters.properties`. Leave `required` array unchanged (loaded miles + locations + pay only).
- Update `parse_ratecon` system prompt to: *"…Extract `loaded_miles` (line-haul/trip miles only) and `deadhead_miles` (empty/DH miles only) separately. Never guess deadhead — if absent, omit it. Never treat total miles as deadhead."*

**File:** `src/components/ScanLoadModal.tsx`

In `parseWithAI` result map, add: `deadhead_miles: parsed.deadhead_miles?.toString() || undefined,`. (`ParsedLoadData` already has `deadhead_miles?: string` — no type change.)

## Phase 4 — Show deadhead in scan preview
**File:** `src/components/ScanLoadModal.tsx`

- Rename "Miles" label → "Loaded Miles" in the existing `loaded_miles` cell (line 274-279).
- Add a new cell after it for `parsed.deadhead_miles`:
  ```
  <div className="rounded-lg bg-muted/50 p-2">
    <span className="text-label">Deadhead Miles</span>
    <p className="font-bold">{parsed.deadhead_miles}</p>
  </div>
  ```
- Update `fieldCount` filter (line 106-108) to keep counting it (already does — `deadhead_miles` is a non-excluded key).

## Phase 5 — Warn when DH detected but loaded missing
**File:** `src/components/ScanLoadModal.tsx`

In State 4 (parsed results), add an inline amber alert above the action buttons when `parsed.deadhead_miles && !parsed.loaded_miles`:
> *"Deadhead miles detected, but loaded (line-haul) miles were not. Please enter loaded miles before saving."*

Use existing `AlertCircle` icon and `bg-amber-500/10 border-amber-500/30` styling consistent with other warnings. Does **not** block confirm — user already reviews before saving.

**File:** `src/components/PasteLoadParser.tsx`

Already has a toast warning. Additionally, when the parsed result includes a new `needsMileageReview` flag (Phase 6), surface the same toast wording.

## Phase 6 — Fix "Total miles" ambiguity in paste parser
**File:** `src/lib/parseLoadText.ts`

- Add `needsMileageReview?: boolean` to `ParsedLoadData` interface.
- Remove `total` from `LOADED_CTX_RANKED` (line 152) and from `LOADED_PRIORITY` (line 156) so context-based scoring never picks a "total" token over plain unknown when DH is present.
- In the explicit-line matcher (line 261-262), drop the `total\s+` prefix from the keyword group so `Total Miles: 282` no longer wins via that path.
- Keep the **last-resort** "Total Miles" fallback (line 322-328) but gate it: *"only treat total miles as loaded if no deadhead value was found AND no other loaded candidate exists."* If DH is present and the only other mileage label is "total", set `result.needsMileageReview = true` and **do not** set `loaded_miles`.
- When `dh && !loaded` after all extraction steps, also set `needsMileageReview = true`.

This means:
- `Total miles: 500` alone → still `loaded=500` (back-compat for Test 7).
- `Total Miles: 999\nTrip Miles: 257.10` → still `loaded=257.10` (Trip wins).
- `Deadhead: 25\nTotal miles: 282` → `dh=25`, `loaded=undefined`, `needsMileageReview=true`. **This changes the existing test** `'uses 267 as loaded miles when only total wording is present'` (line 227-231). That test will be updated to expect `needsMileageReview=true` and no `loaded_miles`, matching the new safer behavior. The note in Phase 7 calls this out.

## Phase 7 — Parser tests
**File:** `src/test/parseLoadText.test.ts`

Add a new `describe('parseLoadText — deadhead + total ambiguity', ...)` block:
- `DH 25 miles\nTrip: 257.10mi` → loaded=257.10, dh=25, no warning.
- `Deadhead: 25 miles\nTotal miles: 282 miles` → dh=25, loaded=undefined, `needsMileageReview=true`.
- `Loaded miles: 257.10\nDeadhead: 25` → loaded=257.10, dh=25, no warning.
- Trip wording variants (`Trip 257.10 miles`, `Trip: 257.10mi`, `Trip miles: 257.10`, `Linehaul miles: 257.10`).
- Deadhead wording variants (`DH 25 miles`, `Deadhead 25 mi`, `Dead head: 25`, `Empty miles: 25`).

Update the existing test at line 227-231 to assert the new safer behavior (`needsMileageReview=true`, no loaded). Add a comment explaining why.

## Phase 8 — Public copy correction
**File:** `src/lib/featureList.ts:48`

Replace the "Deadhead Pay Parsing" feature with:
- title: *"Deadhead Mile Parsing"*
- description: *"Paste loads with deadhead miles and the parser separates them from line-haul miles automatically. Choose how deadhead is paid in the form before saving."*

Search the rest of the codebase (Landing, Pricing, FAQ, guide pages) with `rg "deadhead pay" -i` — initial scan returned no other matches, but plan a sweep during implementation to be safe.

## Phase 9 — Environment hygiene
**File:** `.gitignore`

Append:
```
# Local env files
.env
.env.local
.env.*.local
!.env.example
```

`.env` is auto-managed by Lovable Cloud and will continue to exist locally; this only prevents inclusion in shared exports. `.env.example` already contains safe placeholders only — no change needed.

## Phase 10 + 11 — Regression + build/test
- Run `bunx vitest run` to confirm parser tests + no-trial-language test pass.
- Run `tsc --noEmit` (TypeScript check).
- Manually verify Scan modal at 375 / 715 / desktop widths via the existing preview.
- Confirm: gallery upload, camera capture, paste parser, AI scan parsing, Pro gating, lead magnet, Stripe flow, admin dashboard untouched (no changes in those files).

---

# Files changed
- `src/components/ScanLoadModal.tsx` (privacy copy, AI deadhead mapping, preview row, inline warning)
- `supabase/functions/ai-insight/index.ts` (schema + prompt for deadhead_miles)
- `src/lib/parseLoadText.ts` (ambiguity fix + `needsMileageReview` flag)
- `src/components/PasteLoadParser.tsx` (surface `needsMileageReview` warning)
- `src/test/parseLoadText.test.ts` (new tests + one updated)
- `src/lib/featureList.ts` (corrected public claim)
- `.gitignore` (exclude .env)

# Risks
- The single existing test at `parseLoadText.test.ts:227-231` is intentionally rewritten — this is the documented behavior change. All other tests remain green.
- The AI edge function is auto-deployed; first call after deploy may be slower (cold start), but no breaking change for callers.
- No auth, Stripe, RLS, admin, parking, sitemap, lead-magnet, or Pro-gating code is touched.
