# HaulTrackerPro — Launch-Readiness Hardening Plan

Targeted, surgical fixes only. No UI redesign, no route renames, no broad refactors. Each phase is verified before moving on.

## Audit findings (from read-only inspection)

- **Scripts present** in `package.json`: `build`, `lint`, `test`, `seo:audit` — all four exist.
- `**useAuth` shim**: `src/hooks/useAuth.ts` re-exports from `./useAuth.tsx`. All 36 importers use `@/hooks/useAuth` (extension-less), which Vite resolves to `useAuth.tsx` first. The `.ts` shim is only useful as a defensive 404 catch for stale HMR module URLs after the rename. **Recommendation: keep it as documented safety net** — removing it risks reintroducing the blank-preview HMR 404. Cost is zero.
- **Admin seed**: Migration `20260228060534_…sql` does `INSERT … FROM auth.users WHERE email = 'berthonyxyz@gmail.com' ON CONFLICT DO NOTHING`. If the owner account didn't exist at migration time, the seed silently inserted nothing. There is no fallback in `useAdmin`.
- `**send-transactional-email**`: Function comment claims `verify_jwt = true` but `supabase/config.toml` has no entry for it (defaults vary; we cannot rely on the gateway). The function has **no in-code auth check, no recipient validation, no template allowlist**. Callers: `src/pages/Auth.tsx` (signup, pre-confirmation — no session), `send-lifecycle-emails` (server, service role), `admin-api` (server, service role).
- `**SettingsView**`: Lines 109-123 call `setState` during render guarded by `!initialized`. This is a known anti-pattern that can warn and cause an extra render; needs to move into `useEffect`.

## Phase 1 — Baseline audit

Run `npm install && npm run build && npm run lint && npm run test && npm run seo:audit`. Capture failures with file/line and stop if anything blocks. (Lovable's harness runs build/typecheck automatically; we'll only re-run lint/test/seo manually.)

## Phase 2 — `useAuth` shim

- Keep `src/hooks/useAuth.ts` as-is (already a 2-line re-export with a comment). No code change needed beyond confirming the comment is clear.
- Verify no duplicate `AuthProvider` instances by confirming all imports resolve to the same module (they do — both `.ts` and `.tsx` paths point to the same `useAuth.tsx` symbols).

## Phase 3 — Owner/admin fallback for `berthonyxyz@gmail.com`

Edit `src/hooks/useAdmin.ts`:

- After the DB lookup, if the row is missing **and** `user.email?.toLowerCase() === 'berthonyxyz@gmail.com'`, set `isAdmin = true`, `role = 'super_admin'`.
- DB role still wins when present.
- Add a clear comment: "Permanent platform-owner fallback — do not remove."

Add a new migration `…_owner_admin_backfill.sql`:

- Re-run the same `INSERT … ON CONFLICT DO NOTHING` for `berthonyxyz@gmail.com` so that once the auth user exists server-side, RLS-protected admin queries work too. Idempotent.

Note: server-side admin checks (RLS via `is_admin()`) still require the DB row, so non-owners cannot bypass anything. The client fallback only unlocks the `/admin` route render; all admin data calls go through `admin-api` / RLS which enforce DB roles. We will document this clearly in the comment.

## Phase 4 — Harden `send-transactional-email`

Constraints: must NOT break the signup welcome email in `Auth.tsx`, which fires **before** email confirmation (user has anon JWT only, no authenticated session).

Edit `supabase/functions/send-transactional-email/index.ts`:

1. **Template allowlist** — define `ALLOWED_TEMPLATES` (keys of `TEMPLATES` registry already act as one; explicitly enforce and 400 on unknown — already returns 404, change to 400 with neutral message).
2. **Per-template policy** — add a small policy map:
  - `lifecycle-day0`, `lifecycle-day2`, `lifecycle-day7`, `welcome`: allow **anonymous** (signup pre-confirmation). Recipient is taken from request body but rate-limited per email + per IP.
  - All other templates: require an authenticated user JWT; recipient **must equal** the authenticated user's email (case-insensitive), unless the template defines a fixed `to` (admin notifications).
3. **Auth verification** — read `Authorization` header, call `supabase.auth.getClaims(token)`. If present, capture `sub` + email. If absent and template is not in the anon-allowed list, return 401.
4. **Service-role bypass** — accept calls from `send-lifecycle-emails` and `admin-api` by checking for `x-internal-secret` header equal to `SUPABASE_SERVICE_ROLE_KEY` env (never logged). Both internal callers already have this; we'll add the header in those two callers.
5. **Anti-abuse rate limit** — for anon templates, query `email_send_log` for the last 60s by `recipient_email + template_name`. If a `pending`/`sent` exists, return `200 { success: true, queued: false, reason: 'rate_limited' }` (no info leak about whether the email exists).
6. **Add `verify_jwt = false**` entry in `config.toml` for this function so the in-code auth logic is the single source of truth (avoids gateway rejecting the anon signup call).
7. Keep all existing suppression / unsubscribe / enqueue logic unchanged.

Update callers:

- `supabase/functions/send-lifecycle-emails/index.ts` and `supabase/functions/admin-api/index.ts`: add `headers: { 'x-internal-secret': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') }` to their two `invoke` calls.
- `src/pages/Auth.tsx`: no change (anon-allowed list covers it).

## Phase 5 — `SettingsView` state init

Edit `src/components/SettingsView.tsx`:

- Remove the `if (settings && !initialized) { setX(...); setInitialized(true); }` block at lines 109-123.
- Replace with a `useEffect(() => { if (!settings || initialized) return; … setInitialized(true); }, [settings, initialized])`.
- All other behavior (save buttons, defaults, validation, leaderboard handle, tax/pay-week/deadhead settings) untouched.

## Phase 6 — End-to-end verification (code-level review + manual smoke)

Code-level checks:

- Confirm `Auth.tsx` signup still fires welcome email through new auth function (anon-allowed).
- Confirm `useAdmin` returns `isAdmin=true` for owner email even when row missing; returns `false` for any other email when row missing.
- Confirm `SettingsView` initializes once, no React warnings, user edits not overwritten on settings refetch.
- Confirm Stripe upgrade flow untouched (`create-checkout`, `customer-portal`, `check-subscription`, `stripe-webhook` not edited).
- Confirm parser, dashboard, loads, expenses, fuel, public pages, sitemap not touched.

Manual smoke (user-visible) — agent will note these as "user must verify in production":

- Stripe sandbox upgrade end-to-end.
- Owner login → `/admin` access.
- Non-owner free + non-owner pro → `/admin` blocked.
- Signup → welcome email arrives.

## Phase 7 — Final scripts

Run: `npm run lint`, `npm run test`, `npm run seo:audit`. Build is auto-run by harness.

## Phase 8 — Final report

Verdict, files changed, issues fixed, intentional non-changes (e.g. `useAuth.ts` shim kept), exact script results, remaining risks (Stripe live keys, DNS, owner first login), and manual checks list.

## Files that will change

- `src/hooks/useAdmin.ts` — owner fallback
- `src/components/SettingsView.tsx` — move init to `useEffect`
- `supabase/functions/send-transactional-email/index.ts` — auth + recipient + allowlist + rate limit
- `supabase/functions/send-lifecycle-emails/index.ts` — add internal-secret header
- `supabase/functions/admin-api/index.ts` — add internal-secret header (2 call sites)
- `supabase/config.toml` — add `[functions.send-transactional-email] verify_jwt = false`
- `supabase/migrations/<new>_owner_admin_backfill.sql` — re-run idempotent owner seed

## Files explicitly NOT changed

- `src/hooks/useAuth.ts` / `useAuth.tsx` — shim retained as documented preview-stability safety net
- `src/App.tsx` — routes, redirects, providers untouched
- Stripe functions, parser, dashboard, settings save logic, pricing UI — untouched
- `index.html`, `public/sw.js` — service-worker cleanup left in place The plan is approved, but revise Phase 4 before implementation:
  1. Do not use SUPABASE_SERVICE_ROLE_KEY as the internal function-to-function shared secret.
  2. Add a separate environment variable named INTERNAL_FUNCTION_SECRET.
  3. Internal callers such as send-lifecycle-emails and admin-api must pass x-internal-secret: INTERNAL_FUNCTION_SECRET.
  4. send-transactional-email must validate x-internal-secret against INTERNAL_FUNCTION_SECRET.
  5. Never log the internal secret or Authorization header.
  For anonymous email sending:
  1. Only allow the signup welcome template anonymously if it is required by the current signup flow.
  2. Do not allow lifecycle-day2 or lifecycle-day7 anonymously unless there is a verified reason. Those should be internal/server-only lifecycle emails.
  3. Anonymous callers must not be allowed to choose arbitrary recipients for any template except the tightly controlled signup welcome case.
  4. Validate email format.
  5. Normalize recipient emails to lowercase before rate limit checks.
  6. Rate limit by normalized email and IP.
  7. Do not reveal whether an email exists.
  8. Do not allow the client to control subject, HTML body, sender, reply-to, or template internals.
  Also, explicitly run and report:
  - npm run build
  - npm run lint
  - npm run test
  - npm run seo:audit
  Do not mark the app public-ready unless all four pass or any warnings are clearly documented as non-blocking.