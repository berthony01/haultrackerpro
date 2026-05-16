Phase 2 verification failed. The uploaded code does not show the Phase 2 plan fully implemented.

Please complete Phase 2 exactly as scoped. Do not touch unrelated features.

Missing/failing items:

1. Deep-link sub-route support is not implemented.

In src/pages/Index.tsx, the pageParam parser still only checks:

pageParam === 'recruiter-access'

Update it to support:

- recruiter-access

- recruiter-access:reports

- recruiter-access:manager

- recruiter-access:applications

Use a safe allowlist or pageParam.startsWith('recruiter-access') plus validation.

Expected behavior:

- /dashboard?page=recruiter-access:reports as recruiter opens Reports panel.

- /dashboard?page=recruiter-access:manager as recruiter opens Manage Opportunities.

- /dashboard?page=recruiter-access:applications as recruiter opens Applications.

- /dashboard?page=recruiter-access:reports as driver redirects to driver dashboard.

2. Driver direct-URL guard must work with all recruiter-access subroutes.

The existing isRecruiterPageId helper is good, but it must work after the parser supports subroutes.

Confirm non-recruiter/non-admin users cannot land on any recruiter-access* page.

3. Clean stale internal trial doc.

In docs/MANUAL_QA_[CHECKLIST.md](http://CHECKLIST.md), remove:

"14-day auto-trial countdown banner shows for new users"

Replace with:

"Auto-trial system retired; verify billing pages do not reference trial language."

4. Add Supabase linter search_path sweep migration.

Create one migration that applies:

ALTER FUNCTION ... SET search_path = public

for every SECURITY DEFINER / volatile function currently flagged by the Supabase linter, except pgmq wrappers that must remain schema-agnostic.

Do not change function logic or signatures.

After migration, report the remaining Supabase linter warning count and list any warnings intentionally deferred.

5. Add featured sync regression coverage.

Add src/test/featuredSync.test.ts or an equivalent test/spec file.

It must document the expected matrix:

- Starter active/trialing = no priority

- Growth active/trialing = priority

- Fleet active/trialing = priority

- canceled/past_due/inactive = no priority

- upgrade Starter to Growth flips existing opportunities to featured=true

- downgrade Growth to Starter flips existing opportunities to featured=false

- normal recruiter/client updates cannot manually set featured

If the DB behavior cannot be unit-tested directly, create a clear test/spec around shared constants or a documented SQL assertion block and add a Vitest test that protects the matrix from being silently removed.

6. Verification required:

- Visit /dashboard?page=recruiter-access:reports as recruiter and confirm it opens Reports.

- Visit /dashboard?page=recruiter-access:reports as driver and confirm redirect to driver dashboard.

- Confirm docs no longer mention 14-day auto-trial.

- Confirm new featured sync test exists and passes.

- Confirm Supabase linter warning count is reduced.

- Run build and tests.

Do not proceed to Phase 3 until this is complete.

## Phase 2 — Polish & Hardening

Surgical, no behavior changes outside the listed items. Targets 9.4/10.

### 1. Deep-link sub-route support (`src/pages/Index.tsx`)

Extend the `pageParam` parser (~line 203-216) to accept `recruiter-access:reports`, `recruiter-access:manager`, `recruiter-access:applications`. Today only the bare `recruiter-access` matches, so `?page=recruiter-access:reports` lands on the hub. Use `pageParam.startsWith('recruiter-access')` and forward the full string to `setPage`. Recruiter gating is unchanged.

### 2. Driver→recruiter direct-URL guard (`src/pages/Index.tsx`)

If a non-recruiter, non-admin user navigates to any `recruiter-access*` page (URL or `setPage`), redirect to `/dashboard` once `roleLoading === false`. Mirrors the redirect already shipped for recruiters bouncing off driver-only pages. No RLS change — purely a UX/route guard.

### 3. Stale internal doc (`docs/MANUAL_QA_CHECKLIST.md`)

Remove the line referencing the "14-day auto-trial countdown banner" (line 65) and any sibling lines in that QA section that assume the removed trial flow. Replace with a one-line note that the auto-trial system is retired. Keeps `noTrialLanguage` test green and prevents QA confusion.

### 4. Supabase linter `search_path` sweep

Single migration: `ALTER FUNCTION ... SET search_path = public` for every `SECURITY DEFINER` / volatile function flagged by the linter that doesn't already pin it. No logic changes, no signature changes. After migration, re-run `supabase--linter` and confirm count drops to ~0 (excluding non-actionable infra warnings). Functions to skip: `pgmq.*` wrappers that must stay schema-agnostic.

### 5. Featured-sync regression test

Add `src/test/featuredSync.test.ts` (Vitest) that documents the matrix as assertions against a mock or, simpler, a markdown spec table embedded in the test file's comments + a pure-function unit test of `recruiter_has_priority_plan`'s JS mirror if one exists. If no JS mirror exists, instead add a SQL assertion block as a comment in the migration and a Vitest stub that imports the matrix from a shared constants file. Goal: prevent silent regression of the Starter↔Growth flip behavior.

### Out of scope (deferred to Phase 3)

- Bundle splitting beyond pdf.ts
- Lighthouse pass
- Final manual QA walkthrough
- Publish dry-run

### Files touched

- `src/pages/Index.tsx` (items 1 + 2)
- `docs/MANUAL_QA_CHECKLIST.md` (item 3)
- One new Supabase migration (item 4)
- `src/test/featuredSync.test.ts` new (item 5)

### Verification after implementation

- Manual: visit `/dashboard?page=recruiter-access:reports` as a recruiter → lands on Reports panel.
- Manual: visit same URL as a driver → redirected to driver dashboard.
- `supabase--linter` → warning count near zero.
- `bunx vitest run` → all green, including no-trial guard and new featured-sync test.

### Expected score after Phase 2

**9.4 / 10**. Remaining gap closed by Phase 3 (perf + final QA + publish dry-run).