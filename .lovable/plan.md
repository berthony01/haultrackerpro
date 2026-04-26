# Trial Removal — Hardening, Verification & Audit

## Pre-audit findings (already verified read-only)

- **Phase 1 scan**: `rg` across all `.tsx/.ts/.md/.json/.html` (excluding `node_modules`, lockfiles, `supabase/migrations/**`, and `src/integrations/supabase/types.ts`) returned **0 user-facing matches** for any of the 9 trial phrases. Only one safe match: a comment in `src/pages/Index.tsx:71` (`"Free vs Pro only; no trials"`) which explicitly marks legacy intent — keep.
- **Phase 2 CTAs**: Landing, Pricing, StarterKit already use **"Start Tracking Free"** + **"Create Free Account"** + **"Upgrade to Pro"** consistently. No "Start Free Trial"-style CTAs remain.
- **Dead code**: `src/components/TrialBanner.tsx` still exists but has **zero imports**. It contains the strings "Pro Trial", "trial has ended", "days left" — it would fail the new test.
- **Legacy `trialing` references** (defensive, NOT user-facing):
  - `supabase/functions/create-checkout/index.ts` (blocks duplicate checkout if Stripe still has a trialing sub) — keep, it's safety code.
  - `supabase/functions/check-subscription/index.ts` (`isTrial` mapped to free path) — keep.
  - `src/components/ProInsightCard.tsx:35` — comment only.
- **Phase 4 DB audit (already run)**:
  - `subscriptions.status = 'trialing'` → **0 rows**
  - `profiles.subscription_status = 'trialing'` → **0 rows**
  - Rows with leftover `trial_start`/`trial_end` timestamps → **2 rows** (cosmetic; status is correct)
  - Active Pro: 1 · Free: 11 · Other: 0

---

## Phase 1 — Trial-language detection test

Create `src/test/noTrialLanguage.test.ts`:

- Recursively walk `src/`, `public/`, `index.html`, top-level `.md` files.
- File extensions: `.tsx`, `.ts`, `.md`, `.json`, `.html`.
- Excludes: `node_modules`, `dist`, `src/integrations/supabase/types.ts`, `supabase/migrations/**`, `bun.lock*`, `package-lock.json`, the test file itself, and `src/components/TrialBanner.tsx` (will be deleted in Phase 2).
- Patterns (case-insensitive, regex):
  - `\b14[- ]day\b`, `\bfree trial\b`, `\btrial ends\b`, `\btrial expired\b`, `\bstart trial\b`, `\btrialing\b`, `\bdays left\b`, `\btrial period\b`
- Per-line allowlist: skip a line if it contains the marker `// trial-allowlist` (used for the one Index.tsx comment and any defensive backend code we keep — but those are under `supabase/functions/`, outside scan scope; we'll only need it to remain absent from `src/`).
- For the Index.tsx comment we'll just rephrase it to remove the word "trials" rather than allowlist (cleaner).
- Test asserts the matches array is empty; on failure, prints file:line:match for each hit.
- Self-verification: temporarily add `// FREE TRIAL` to a scratch line, run, confirm fail; remove, confirm pass.

## Phase 2 — Cleanup pass (minimal)

Surgical edits only — no behavioral change:

1. **Delete `src/components/TrialBanner.tsx**` (verified unused: `rg "TrialBanner"` returns only the file itself).
2. `**src/pages/Index.tsx:71**` — rewrite comment from `"Free vs Pro only; no trials"` → `"Free vs Pro plans only"` (avoids the substring "trials").
3. `**src/components/ProInsightCard.tsx:35**` — rewrite comment `"Don't compute for Pro or trialing users"` → `"Don't compute for Pro users"` (matches current logic since trialing no longer exists).
4. **No CTA changes needed** — already verified consistent.
5. **No backend edits** — the `trialing` references in `create-checkout` and `check-subscription` are defensive guards for Stripe-side state and are outside the scan scope.

## Phase 3 — Pro-gating end-to-end verification (read-only audit)

No code changes. Verify and report on:

- **Frontend gating**: re-confirm all 28+ components using `useSubscription` rely on `isPro` (not `isTrialing`). Spot-check `Parking.tsx`, `DriverScorecard`, `WeeklyCloseout`, `SmartLoadAdvisor`, `AlertsView`, `RecurringExpensesView`, `PasteLoadParser`, `CSVImport`.
- **Backend gating**: confirm `check-pro-access`, `generate-recurring-expenses`, `admin-api`, `stripe-webhook`, `check-subscription` all require `status = 'active'` for Pro.
- **RLS**: confirm `subscriptions` table is read-only for users (own row) + admins; `admin_users` gated by `is_admin()`. Already in schema.
- **Routing**: `/admin` requires `useAdmin`, `/parking` is auth-gated. No new public routes.
- **Edge cases**: walk through Free → upgrade → cancel state transitions in `useSubscription.ts` to confirm `isPro` flips correctly without any `trialing` shortcut.

## Phase 4 — Light trial-user audit (one-time SQL, no UI)

Already executed read-only. Will optionally include a **single migration** to null out the 2 stale `trial_start`/`trial_end` cosmetic timestamps:

```sql
UPDATE public.subscriptions
SET trial_start = NULL, trial_end = NULL
WHERE trial_start IS NOT NULL OR trial_end IS NOT NULL;
```

This is safe — `useSubscription` no longer reads these columns and `status` is already correct. Will ask for confirmation before applying via migration; if you'd rather leave the timestamps as historical record, we skip it.

## Phase 5 — Final audit

- Run `bunx vitest run` — confirm `noTrialLanguage.test.ts` and existing tests pass.
- Run `tsc --noEmit` — confirm zero errors.
- Re-run the manual `rg` scan — confirm 0 matches.
- Mobile QA (375px + 715px): visual sanity check of `/`, `/pricing`, `/starter-kit`, `/admin` since no layout changed, this is a quick spot-check.

## Files touched

- **Added**: `src/test/noTrialLanguage.test.ts`
- **Deleted**: `src/components/TrialBanner.tsx`
- **Edited (comment-only)**: `src/pages/Index.tsx`, `src/components/ProInsightCard.tsx`
- **Optional migration**: null stale `trial_start`/`trial_end` (2 rows) — pending your call

## Risk

Very low. No runtime logic changes. The deleted component has zero imports. The new test only reads files. Optional migration only nulls cosmetic columns on 2 rows whose `status` is already correct.

## Final report (to be delivered after execution)

Will include: scan result, files modified, test output, tsc output, gating verification table, DB audit numbers, mobile QA notes, and an explicit confirmation that no trial language remains, CTAs are correct, Pro gating is intact, and nothing was broken. Proceed with Phases 1, 2, 3, and 5. Skip the optional migration for now. Do not modify backend trialing defensive guards.