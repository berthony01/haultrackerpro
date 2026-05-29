
## Phase 28D — Final Scanner Reconciliation

Most of these warnings are **already addressed** by prior phases (28, 28A, 28B, 28C). The scanner is asking us to either *verify* the current state or close a couple of small remaining gaps. No PII access changes, no UI redesign, no calculation/starter-kit/billing changes.

### Findings triage

| # | Finding | Action |
|---|---|---|
| 1 | `driver_referrals` driver SELECT exposes contact fields | **Verify only** — confirm no driver-side SELECT policy exists on the base table and that `list_my_driver_referrals()` excludes `referred_driver_email/phone/note`. Mark fixed with explanation. |
| 2 | `lead_magnet_signups` open INSERT to anon | **Small hardening** — keep anon INSERT (intentional lead capture) but tighten the existing `submit_lead_magnet_signup` RPC + revoke direct INSERT policy if any remains; add a per-email/IP rate-limit guard in the RPC. |
| 3 | `recruiter_profiles` SELECT gap | **Verify only** — scanner itself says "No action required". Mark fixed with explanation. |
| 4 | Edge functions leak raw `.message` | **Fix** — sanitize error responses in `upload-contract`, `confirm-contract-upload`, `sign-contract`, `review-contract`, `check-pro-access`, `ai-insight`. Log full error server-side, return generic client message. |
| 5 | `opportunity_applications` driver snapshots readable by recruiters | **Verify only** — Phase 28/28C already gated snapshots through `list_recruiter_applications_safe` RPC + consent-gated triggers, and recruiters do not have a direct SELECT policy returning these fields. Confirm and mark fixed. |

### Plan steps

1. **Audit (read-only)** — re-read the latest migrations on `driver_referrals`, `lead_magnet_signups`, `opportunity_applications`, plus `list_my_driver_referrals` and `list_recruiter_applications_safe` to confirm current shape.

2. **Migration: `phase_28d_hardening.sql`**
   - Defensive `DROP POLICY IF EXISTS` for any driver-side SELECT on `driver_referrals` (no-op if already gone).
   - Drop any remaining direct anon/authenticated INSERT policy on `lead_magnet_signups` (writes go through `submit_lead_magnet_signup` RPC only).
   - Add lightweight abuse guard inside `submit_lead_magnet_signup`: reject if same `email_lower` submitted >3 times in the last hour.
   - Re-assert `list_my_driver_referrals()` column list (recreate function) so it explicitly omits `referred_driver_email`, `referred_driver_phone`, `referred_driver_note`.

3. **Edge function error hygiene** (Finding #4)
   - In each listed function, wrap returned errors:
     - `console.error('[fn-name] step', err)` server-side.
     - Client response: `{ error: 'Operation failed. Please try again.' }` with appropriate status.
     - Keep specific known messages only for: 401 unauthorized, 402 credits exhausted, 403 forbidden, 409 conflict, 429 rate limit.
   - `ai-insight`: replace `"LOVABLE_API_KEY is not configured"` with generic 500 `{ error: 'AI service unavailable' }` and log internally.

4. **Tests** (`src/test/securityViewsShape.test.ts`)
   - Assert no `SELECT` policy on `driver_referrals` matches `referring_driver_id`.
   - Assert `lead_magnet_signups` has no anon/authenticated `INSERT` policy after migration.
   - Assert `list_my_driver_referrals` return shape excludes the 3 contact columns.

5. **Mark findings** via `security--manage_security_finding`:
   - #1, #3, #5 → `mark_as_fixed` with verification explanation.
   - #2, #4 → `mark_as_fixed` after the migration + edge function edits land.

6. **Verify**: `npm run build` + `npm run test` + `supabase--linter`.

### Files to change

- `supabase/migrations/<new>_phase_28d_hardening.sql` (new)
- `supabase/functions/upload-contract/index.ts`
- `supabase/functions/confirm-contract-upload/index.ts`
- `supabase/functions/sign-contract/index.ts`
- `supabase/functions/review-contract/index.ts`
- `supabase/functions/check-pro-access/index.ts`
- `supabase/functions/ai-insight/index.ts`
- `src/test/securityViewsShape.test.ts`

### Out of scope (per your constraints)

Phase 23 calculations, Phase 27 starter kit, UI redesign, pricing/billing, SEO, recruiter plan logic.
