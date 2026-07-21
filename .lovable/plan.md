## Disclosure first — read before approving

Two things you should know before greenlighting this plan, because they change what "PASS" for this audit means:

1. **The create_agency JSON defect is already fixed and live.** In the previous turn (build mode) I applied a migration to `create_agency` that switched `_defaults` from `jsonb` to `record` and trimmed the contact email before regex validation. The current network log confirms it: `POST …/rpc/create_agency` returned `200` at `2026-07-19T14:50:25Z` and produced agency `7657c655-…`. This turn's instruction says "do not apply a live migration"; that instruction arrived after the fix was already applied, so I'm disclosing rather than hiding it. No further live writes are proposed below.
2. **A different live defect just surfaced in the same session.** `get_my_managed_drivers` returns `400 / 42703 / "column p.full_name does not exist"` on every call from `/agency`. I confirmed the function body references `COALESCE(p.display_name, p.full_name, lower(u.email))` while `public.profiles` has no `full_name` column (only `display_name`). This blocks the Assistant driver switcher and any surface that lists managed drivers.

Given your standing protocol (narrow scope, one focused implementation run, honest split rather than overreach), I do **not** recommend attempting the full 51-scenario, 12-part audit in a single turn. I'm proposing a scoped Pass A that closes both confirmed defects with real tests, and explicitly deferring the rest into a Pass B execution packet.

## Scope of this plan (Pass A only)

**In scope**
- Candidate migration fixing `public.get_my_managed_drivers` to drop the non-existent `p.full_name` reference.
- PGlite runtime test that reproduces the `42703` error against the current function body and proves the candidate fixes it.
- Reproduction note + evidence for the already-applied `create_agency` fix (no code change; test already exists at `src/test/phase1iAgencyCreateJsonCast.test.ts`).
- Full verification gates: `bunx vitest run`, `bunx tsgo` on both configs, `bun run build`, forbidden-test grep.

**Explicitly deferred to Pass B** (out of scope this turn)
- Parts 2–10 of the audit prompt: profile/settings, members, service packages, delegation, assistant invitation lifecycle, permission enforcement, workspace switching, driver control, RLS cross-tenant proofs, full JSON/JSONB contract inventory.
- Parts 47–51 driver-control tests and cross-agency isolation proofs.
- Any RLS or grants changes.

Reason for the split: each of those parts requires reading 5–15 live functions/policies and writing role-scoped PGlite fixtures. Attempting all in one turn violates your "one focused implementation run" rule and produces exactly the kind of self-graded PASS you've called out before.

## Root cause (confirmed by live reads)

`public.get_my_managed_drivers` body (verified via `pg_get_functiondef`):
```
COALESCE(p.display_name, p.full_name, lower(u.email))
LEFT JOIN public.profiles p ON p.user_id = da.driver_user_id
```
`public.profiles` columns (verified via `information_schema.columns`):
```
id, user_id, display_name, created_at, updated_at, subscription_status,
subscription_plan, stripe_customer_id, subscription_expires_at,
stripe_subscription_id, driver_handle, handle_emoji, handle_public,
last_seen_release_id, intended_role
```
No `full_name`. Function raises `42703` on every call. Canonical fix: remove `p.full_name` from the COALESCE — `display_name` already exists and `lower(u.email)` is the fallback.

## Files this turn will touch

- `supabase/migration-candidates/20260719160500_fix_get_my_managed_drivers_full_name.sql` — candidate only, not moved to `supabase/migrations/`.
- `src/test/phase1iGetManagedDriversColumn.test.ts` — new PGlite test: reproduces `42703` with current body, applies candidate, proves it returns rows without error.

No client code changes (the hook just calls the RPC). No changes to `package.json`, lockfile, RLS, grants, or unrelated migrations.

## Verification I will run and report verbatim

1. `bunx vitest run src/test/phase1iGetManagedDriversColumn.test.ts src/test/phase1iAgencyCreateJsonCast.test.ts`
2. `bunx vitest run` (full suite, single command, must exit 0)
3. `bunx tsgo -p tsconfig.app.json --noEmit`
4. `bunx tsgo -p tsconfig.node.json --noEmit`
5. `bun run build`
6. `grep -RInE '\.(only|skip)\(' src/test`

I will not apply the candidate migration. You can promote it in a follow-up turn.

## What I will NOT do this turn

- No live SQL execution (migration or insert).
- No RLS/grants changes.
- No touching Phase 1H, Stripe, recruiter, driver dashboard, or account deletion paths.
- No `package.json`/lockfile edits.
- No publish/deploy.
- No claim of PASS on any audit part I did not actually exercise — Parts 2–10 will be reported as DEFERRED, not PASS.

## Stop conditions honored

If the PGlite reproduction of `42703` fails to fire on the current body, or the full Vitest suite regresses, I stop and report FAIL rather than patch around it. If Pass B is needed, I'll return an execution packet naming the exact functions/policies/tests required instead of starting it inline.

Approve to proceed with Pass A, or tell me to reshape the split (e.g. include one more specific Part).