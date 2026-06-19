## Goal

Stop silent self-conversion of `profiles.intended_role` when an existing driver visits `/?intent=recruiter`, without breaking real recruiter signups (email + Google).

## Approach

Keep the single `apply_recruiter_intent()` RPC and the BEFORE-UPDATE guard trigger we already added. Add a server-side eligibility check inside the RPC so that flipping `intended_role` to `recruiter` only succeeds for a genuine new-account signup — not for an established driver tampering with the URL. For ineligible callers, return a structured "not eligible" result instead of mutating the profile, and surface an explicit "Become a Recruiter" path in the UI.

No new table is needed — the existing `auth.users.created_at`, `profiles.intended_role`, `recruiter_profiles`, `loads`, `expenses`, and `fuel_logs` rows already let us tell "fresh signup" from "established driver".

## Eligibility rule inside the RPC

The RPC sets `intended_role = 'recruiter'` only if AT LEAST ONE of these is true for `auth.uid()`:

1. The user already has a `recruiter_profiles` row (idempotent re-confirmation for real recruiters).
2. The account is a brand-new signup, defined as ALL of:
   - `auth.users.created_at > now() - interval '30 minutes'`
   - `profiles.intended_role = 'driver'` (default from `handle_new_user`)
   - No rows in `loads`, `expenses`, or `fuel_logs` for this user.

Otherwise the RPC returns `{ applied: false, reason: 'not_eligible' }` and does NOT change `intended_role`. The BEFORE-UPDATE trigger continues to block any direct client write.

This means:
- Email recruiter signup keeps working (and is already handled by `handle_new_user` from `raw_user_meta_data.intended_role` — the RPC is only the Google parity path).
- Google recruiter signup keeps working — fresh user, default profile, no data → eligible.
- An existing driver appending `?intent=recruiter` → ineligible → no silent flip.

## Client behavior change

`useRoleIntentReconciler.ts`:
- Still triggered by `sessionStorage.htp_auth_intent === 'recruiter'` or `?intent=recruiter`.
- Calls `apply_recruiter_intent` exactly as today, but reads the new structured result.
- On `applied: true`: clears the session flag, invalidates role queries (current behavior).
- On `applied: false` (reason `not_eligible`): clears the session flag so we don't loop, and does NOT invalidate role queries. The user remains a driver in the DB.

`useUserRole.ts`:
- Remove the sessionStorage-based "treat as recruiter" short-circuit so client storage can no longer fake a role at render time. The session flag stays only as a hint for the reconciler.

Route handling in `App.tsx` / `pages/Index.tsx`:
- Keep the existing "if intent=recruiter, land on recruiter-access" initial-render guard, because the recruiter-access page is the right destination either way:
  - Eligible new recruiter: their durable role is now recruiter, and the recruiter onboarding/application starts here.
  - Ineligible existing driver: lands on recruiter-access page which already shows the "Become a Recruiter" CTA / application flow. They keep their driver role in the DB and only become a recruiter by completing the explicit recruiter application.

No new "convert me" RPC is added for existing drivers — the existing recruiter application flow (which creates `recruiter_profiles`) is the explicit path, and the RPC's first eligibility branch (`recruiter_profiles` exists) lets that flow flip `intended_role` durably afterward.

## Migration

Single migration that replaces `public.apply_recruiter_intent()`:
- `SECURITY DEFINER`, `SET search_path = public`.
- Returns `jsonb` of shape `{ applied: bool, reason: text }`.
- `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated`.
- Idempotent: a real recruiter calling repeatedly is a no-op.

The guard trigger `prevent_profile_intended_role_updates` from the previous migration is kept unchanged.

## Files

Inspected:
- `src/hooks/useRoleIntentReconciler.ts`
- `src/hooks/useUserRole.ts`
- `src/hooks/useAuth.tsx`
- `src/pages/Auth.tsx`
- `src/pages/Index.tsx`
- `src/App.tsx`
- `supabase/migrations/2026052523…_profiles_intended_role.sql`
- `supabase/migrations/20260619172727_…_apply_recruiter_intent.sql`
- `recruiter_profiles` + RLS, `handle_new_user` trigger.

Changed:
- New migration: `replace apply_recruiter_intent with eligibility gate`.
- `src/hooks/useRoleIntentReconciler.ts` — handle structured result, no role-query invalidation on `applied: false`.
- `src/hooks/useUserRole.ts` — remove sessionStorage role short-circuit.

Not changed:
- `useAuth.tsx` email signup metadata flow.
- `Auth.tsx` recruiter signup buttons and OAuth redirect (`/?intent=recruiter`).
- BEFORE-UPDATE trigger on `profiles`.
- RLS policies (unchanged; no loosening).
- Recruiter application / `recruiter_profiles` / verification logic.

## Verification scenarios

| # | Scenario | Expected |
|---|----------|----------|
| A | New email recruiter signup | Works via `handle_new_user`; reconciler RPC is a no-op or `applied: true` (eligible new user). |
| B | New Google recruiter signup | RPC eligible (fresh user, default profile, no data) → `applied: true`; routes to recruiter-access. |
| C | Existing driver hits `/?intent=recruiter` | RPC returns `applied: false`; `intended_role` stays `driver`; UI lands on recruiter-access with explicit "Become a Recruiter" CTA. |
| D | Existing approved recruiter logs in | `recruiter_profiles` branch → idempotent success; recruiter dashboard works. |
| E | Existing driver normal login | No reconciler call (no intent flag); driver dashboard works. |
| F | RPC error / network failure | Reconciler returns early; no role flip; no UI flash (existing `roleLoading` fallback). |
| G | Driver hits a recruiter-only route via URL | Same as today — recruiter RLS / route guards block; `intended_role` unaffected. |
| H | Recruiter hits a driver-only route via URL | Same as today — recruiter view redirects to recruiter-access. |

## Remaining risks

- A motivated attacker who signs up a brand-new account with Google could still self-identify as recruiter — that is the intended path and is gated by the real recruiter application + verification, not by `intended_role`.
- The 30-minute freshness window is a heuristic; it covers normal OAuth round-trips with plenty of margin but is not a cryptographic guarantee. The downside of being wrong is purely cosmetic (routing/onboarding) because posting power still requires `recruiter_profiles` + verification.
