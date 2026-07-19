# Phase 1H-A2 Closeout — Hermetic Tests, Idempotency/Consent/Privacy/Error Runtime Proofs

## Scope

Verification-and-test-only closeout. No production code changes unless a new runtime test exposes a real defect. All work is confined to two test files plus one narrow, deterministic test-utility. Migration, generated types, `package.json`, `bun.lockb`, referral production code, `ApplyNowDialog.tsx`, `OpportunityDetail.tsx`, and Supabase client remain untouched.

## Files to change

1. `src/test/phase1hA2OpportunityDetail.test.tsx` — expand integration coverage; keep `ReferDriverDialog` mocked at the module boundary; add hermetic + post-success rerender proofs.
2. `src/test/phase1hA2ApplyNow.test.tsx` — expand with deterministic UUID mock and explicit named cases for every FIX 2/3/4/5/7 proof.

No new test files are created unless one of the two above cannot host the case cleanly; if added, it will appear in the focused command.

## Approach per FIX

### FIX 1 — Hermetic OpportunityDetail

- `vi.mock('@/components/opportunities/ReferDriverDialog', ...)` is already in place; verify it hoists before the `OpportunityDetail` import (top-of-file, before the SUT import). No production changes.
- Add a first-in-file test that simply mounts the page and asserts Apply Now is present, guaranteeing the module graph loads with all `VITE_SUPABASE_*` vars unset. Verified by running the exact `env -u ...` command.

### FIX 2 — Idempotency lifecycle (deterministic UUIDs)

- Install a `vi.spyOn(crypto, 'randomUUID')` sequence returning `k1, k2, k3, ...`. Reset per test.
- Separate named cases:
  - `opens dialog → generates exactly one UUID`
  - `rerender with dialog open preserves the same UUID` (submit, assert payload key === k1, spy call count === 1)
  - `field mutations (message, method, consent, attestations) preserve UUID` (submit, assert k1, spy count === 1)
  - `mutateAsync rejects then second submit reuses same key` (two payloads, both k1)
  - `cancel then reopen assigns a fresh UUID` (k1 then k2 in payload)
  - `success then reopen assigns a fresh UUID` (k1 used, then k2 on reopen)
  - `Apply Again after rejected status assigns a new UUID` (rendered via `OpportunityDetail` with rejected app; open dialog; submit; assert new key distinct from any prior)
  - `Apply Again after withdrawn status assigns a new UUID`

### FIX 3 — Contact method & consent

Named runtime cases interacting with the real Radix Select and Checkbox:

- missing email → email option disabled; in-app remains
- missing phone → phone and SMS options disabled
- email + consent → payload `preferred_contact_method: 'email'`
- phone + consent → `'phone'`
- SMS + consent → `'sms'`
- toggle consent off while email/phone/SMS selected → method resets to `in_app` (three tests)
- in-app path submits with `contact_sharing_consent: false` and no consent required
- assert no editable email/phone/SMS destination text input is rendered (`queryByRole('textbox', { name: /email|phone|sms/i })` returns null)

### FIX 4 — Privacy copy & exact SMS payload allowlist

- Assert `getByText` for the visible privacy statement (matcher tolerates split nodes via a function matcher; the dialog currently renders the required wording verbatim in `DialogDescription`).
- Complete an SMS submission; capture `submitMutateAsync.mock.calls[0][0]`.
- `expect(Object.keys(payload).sort()).toEqual([...allowlist])`.
- Assert none of the forbidden fields (driver_user_id, recruiter_id, profile_id, full_name, email, phone digits, cdl_class, years_experience, endorsements, trailer, snapshot, snapshot_version, status, application_type, submitted timestamp, subscription/load/expense/fuel/tax data) appear via a stringified-payload substring scan against the actual profile fixture values ([jane@example.com](mailto:jane@example.com), 5551234567, "A", "Jane Driver", etc.).

### FIX 5 — Success toast & reset

- `sonner` is already mocked. Assert `toast.success` called with `'Application submitted'` and a description property matching the approved copy.
- Assert dialog closes (`onOpenChange(false)`).
- Reopen (parent-controlled `open` toggled true again): assert message empty, all checkboxes unchecked, select back to In-app, no error region, spy shows a new UUID for the new attempt (k2 ≠ k1).

### FIX 6 — Post-success OpportunityDetail state

- Render `OpportunityDetail` with no formal apps → assert Apply Now enabled.
- Open dialog, complete, submit successfully.
- Re-invoke `renderPage({ apps: [{...active formal apply...}] })` to simulate React Query refresh (the mocked hook already reads from `driverApplicationsRef.current`; toggle it and rerender).
- Assert Apply Now no longer actionable (renders "Application Submitted" disabled) and Request Info remains independently classified. No production changes.

### FIX 7 — Full error matrix

Table-driven test iterating over the 8 result codes plus a raw unknown error:

- `duplicate_same_type`, `opportunity_unavailable`, `self_opportunity`, `profile_required`, `restricted`, `invalid_input`, `empty_response`, unknown.
- For each: reject `submitMutateAsync` with `new Error('submission_failed:<code>')` (unknown uses a bare `Error('boom')`), submit, then assert:
  - The public-safe message from `applicationSubmission.ts` is visible.
  - Dialog stays open (`onOpenChange(false)` not called after failure).
  - Message appears inside the `role="status"` live region.
  - The rendered text does not contain `submission_failed:`, `SQL`, table names, policy names, or `[object Object]`.
- Add a distinct retry-preserves-key assertion inside the same open attempt (already covered by FIX 2 retry case; cross-reference only).

## Determinism & hygiene

- All UUID generation controlled by a `randomUUID` spy; restore in `afterEach`.
- Reset mocks in `beforeEach`; no `.only`/`.skip`; no source-string assertions; no environment-dependent branches.
- Radix pointer-capture polyfill retained.

## Verification (run separately, in order)

```text
bun install --frozen-lockfile
env -u VITE_SUPABASE_URL -u VITE_SUPABASE_ANON_KEY -u VITE_SUPABASE_PUBLISHABLE_KEY \
  bunx vitest run src/test/phase1hA2OpportunityDetail.test.tsx
bunx vitest run \
  src/test/phase1hA1FoundationRuntime.test.ts \
  src/test/phase1hA1SubmissionIdempotency.test.ts \
  src/test/phase1hA2ApplyNow.test.tsx \
  src/test/phase1hA2OpportunityDetail.test.tsx
bunx vitest run
bunx tsgo -p tsconfig.app.json --noEmit
bunx tsgo -p tsconfig.node.json --noEmit
bun run build
grep -RInE '\.(only|skip)\(' src/test/phase1hA2ApplyNow.test.tsx src/test/phase1hA2OpportunityDetail.test.tsx
```

Expected: hermetic command exits 0; full Vitest count > 1,341; TypeScript and build succeed; grep returns no matches.

## Stop conditions honored

If the hermetic command still requires a Supabase variable, if any A1/A2 test regresses, if a proof would require production referral changes, or if a runtime test uncovers a real production defect, work stops and the failure plus root cause is reported instead of expanding scope or beginning A3.

## Out of scope (untouched)

- `ApplyNowDialog.tsx`, `OpportunityDetail.tsx`, `useOpportunityApplications.ts`, `useDriverReferrals.ts`, `ReferDriverDialog.tsx`
- `supabase/integrations/*`, `supabase/migration-candidates/*`, `supabase/config.toml`
- `package.json`, `bun.lockb`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`
- Any live DB write, migration application, publish, or deploy
- A3 (Ask Recruiter)

APPROVED. EXECUTE THE PHASE 1H-A2 HERMETIC TEST CLOSEOUT NOW.

Do not produce another plan, checklist, proposed approach, or restatement of requirements.

You have already completed the assessment and described the intended implementation. Proceed immediately with the actual file edits and verification commands.

STARTING COMMIT:

ef29ce2bdb41f95022e8ab9a43d95de6dbb333c6

STRICT SCOPE:

This remains a test-only closeout unless a newly added runtime test proves a real production defect.

Expected changed files:

- src/test/phase1hA2ApplyNow.test.tsx

- src/test/phase1hA2OpportunityDetail.test.tsx

No production source changes are authorized unless a new runtime test demonstrates a confirmed defect. If that occurs, stop before changing production code and report:

1. The failing test

2. The observed production behavior

3. The exact source defect

4. The smallest proposed production correction

Do not begin A3.

==================================================

IMPLEMENT NOW

==================================================

Complete every item from the approved plan:

1. Hermetic OpportunityDetail test isolation

2. Deterministic UUID lifecycle tests

3. Rerender key preservation

4. Field-change key preservation

5. Failed-submit retry key preservation

6. Cancel-and-reopen fresh key

7. Success-and-reopen fresh key

8. Rejected Apply Again fresh key

9. Withdrawn Apply Again fresh key

10. Missing-email behavior

11. Missing-phone and SMS behavior

12. Email consent behavior

13. Phone consent behavior

14. SMS consent behavior

15. Consent-off reset for email

16. Consent-off reset for phone

17. Consent-off reset for SMS

18. In-app submission without consent

19. No editable contact-destination inputs

20. Visible privacy statement

21. Exact mutation payload allowlist

22. No PII or snapshot values in payload

23. Success toast assertion

24. Success form-reset assertion

25. Post-success OpportunityDetail rerender state

26. Actual rendered public-safe error matrix

27. Accessible live-region error behavior

28. No internal error leakage

The OpportunityDetail test must mock the unrelated referral component at the module boundary before importing the component under test:

```ts

vi.mock('@/components/opportunities/ReferDriverDialog', () => ({

  ReferDriverDialog: () => null,

}));

&nbsp;