## What I found (root-cause investigation)

I reproduced your Telegram paste against the parser. Three findings:

**Finding 1 — Mileage parsing actually works in isolation.**
Running `parseLoadText` against the full Telegram message you screenshotted (including `🚛 𝗧𝗿𝗶𝗽: 257.10mi` with the bold-unicode "Trip" and `mi` glued to the number) returns the correct values:
```
{ deadhead_miles: '25', loaded_miles: '257.10' }
```
I tested every variant you listed — `257.10mi`, `257.10 mi`, `257.10mile`, `257.10 mile`, `257.10miles`, `257.10 miles`, bold digits, sans-bold digits, NBSP-spaced — all return `loaded_miles: 257.10`. The existing regex `(\d+(?:\.\d+)?)\s*(mi|mile|miles)\b` already handles them.

**Finding 2 — The 25/25 in your screenshot has a different cause.**
The parser never returns `loaded=25, dh=25`. The most likely real-world causes:
- You pasted only the **pinned-message preview** (which truncates at "Loaded - P..." and contains no `Trip: 257.10mi` line), so `loaded_miles` came back undefined and the form kept whatever was previously typed there (you may have manually typed 25 first to test).
- Or a stale form state from a previous paste.

There is no bug where DH gets copied into Loaded automatically — I traced every `update('loaded_miles', …)` call site.

**Finding 3 — Real gaps worth fixing anyway.**
- The pinned-message preview line (`📍1#: 111DF4KFK Loaded - P...`) gets counted as a 4th stop, polluting `pickup_location` with `"111DF4KFK Loaded - P..."`.
- There is **no global "do you get paid for deadhead?"** setting. The per-load form already has `dh_pay_status: 'unpaid' | 'same' | 'custom'` (LoadForm.tsx:151–157), but every new load defaults to `unpaid`, forcing manual selection every time.
- A defensive guard is missing: if the parser ever did extract only one mileage value classified as deadhead, we should at minimum never let `loaded_miles === deadhead_miles` silently.

---

## Plan

### 1. Lock in the mileage-unit handling with explicit tests
File: `src/test/parseLoadText.test.ts`

Add a dedicated test block covering every unit-attachment variant the user listed, so regressions are impossible:
```
257.10mi   257.10 mi
257.10mile 257.10 mile
257.10miles 257.10 miles
+ bold-digit and sans-bold-digit variants
+ NBSP between number and unit
```
No production code change needed here — this codifies that the existing regex must keep working.

### 2. Add defensive guards to the parser
File: `src/lib/parseLoadText.ts`

- **Drop duplicates**: if `loaded` and `dh` end up equal numerically AND there is only one `mi`-token total in the source, treat the value as `loaded` only and clear `dh` (because a single number can't be both).
- **Telegram pinned-preview filter**: when scanning multi-stop blocks, skip any block whose body is shorter than ~25 chars or ends with `...` / `…` (the preview marker). This prevents the truncated `📍1#: 111DF4KFK Loaded - P...` from becoming stop #1.
- Surface a `parseWarnings: string[]` field for cases where only a deadhead value was found (so `PasteLoadParser` can warn the user "Loaded miles not detected — please enter manually").

### 3. Add global "Deadhead Pay" preference in Settings
Files: `src/components/SettingsView.tsx`, `src/hooks/useUserSettings.ts`, new migration

- New column `user_settings.default_dh_pay_status text default 'unpaid'` (values: `unpaid` | `same` | `custom`) and `default_dh_pay_rate numeric` (nullable).
- Settings UI: new section under "Pay Defaults" → radio group:
  - "I am not paid for deadhead miles" (default)
  - "I am paid the same rate as loaded miles"
  - "I am paid a custom rate for deadhead" → numeric input
- `LoadForm` initial state reads `settings.default_dh_pay_status` / `default_dh_pay_rate` instead of hardcoding `'unpaid'`. Per-load override still works exactly as today.

### 4. Tighten the form's parse handler
File: `src/components/LoadForm.tsx`

- After applying parsed values, if `data.deadhead_miles && !data.loaded_miles`, show a small inline warning under the Loaded Miles field: "Trip mileage not detected in paste — please enter loaded miles."
- If the parser returns `loaded === dh`, refuse to populate either and show the same warning (defensive — won't trigger today but protects against future regex changes).

### 5. QA
- Run vitest (existing 18 tests + new ~8 unit-variant tests must pass).
- `tsc --noEmit`.
- Manual paste of your exact Telegram sample → expect Loaded=257.10, DH=25.
- Manual paste of just the pinned-preview snippet → expect Loaded=blank with the new warning, DH=25.
- Toggle the new Settings preference to "same rate" → create a new load → DH-pay defaults to "Same as loaded rate" automatically.

---

## What I will NOT change
- Estimated Pay formula and the per-load DH override (already correct).
- Stripe / auth / Pro gating.
- The `parseLoadText` core regex (it already passes every case you described).
- Existing 18 parser tests.

## Files touched
- `src/lib/parseLoadText.ts` — defensive guards + warnings
- `src/test/parseLoadText.test.ts` — new unit-variant test block
- `src/components/SettingsView.tsx` — new "Deadhead Pay" settings card
- `src/hooks/useUserSettings.ts` — new fields
- `src/components/LoadForm.tsx` — read defaults from settings + warning UI
- `src/components/PasteLoadParser.tsx` — surface parse warnings (toast)
- `supabase/migrations/<new>` — add `default_dh_pay_status` and `default_dh_pay_rate` to `user_settings`

Approve and I'll implement in one pass.