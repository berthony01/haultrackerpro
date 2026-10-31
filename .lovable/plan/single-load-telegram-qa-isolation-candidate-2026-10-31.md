# Single-load Telegram QA isolation candidate

## Authorized boundary
- Baseline: clean `f966d891a18c41b6d96e8feaca6e07de5e1b3162`.
- High-risk, staging only. Produce one unapplied SQL candidate and extend the existing disposable PostgreSQL tests.
- No database application, deployment, Telegram calls, activation, frontend changes, or financial changes.

## Proposed atomic change
Reuse the three current live RPC bodies, their existing workflow lock, poll lease, receipts, canonical reviewer authorization, proposal lifecycle, and outbox leases. Add service-only QA entry points that invoke those existing paths with a transaction-local QA scope; restore that scope on success and failure. Ordinary calls retain their existing behavior.

The candidate will validate the exact inspected live definitions before modifying any function. When separately applied, it will pin the QA load's exact relationship, recruiter workspace, and unique active group binding; missing or ambiguous provenance aborts application rather than selecting a group arbitrarily.

Inside the existing transactions, enforce:
- Only load `cb3d3a90-ac48-4d20-af52-d6710d854e81`, reference `HTP-QA-L2`, and proposed status `cancelled`.
- Exact pinned active group, workspace, relationship, and driver ownership, with row locks and current authorization.
- Absolute expiry at `2026-11-02 23:59:59 UTC`; recheck after lock waits and immediately before proposal creation, delivery claim, or canonical status update.
- Intake never changes a load. A genuine, authorized callback is still required for acceptance.
- Callback scope is checked before any proposal mutation, including expiry/stale handling.
- Outbox selection and both cleanup sweeps are limited to the exact QA proposal scope before any updates; unrelated rows remain byte-for-byte unchanged.
- Service-role-only execution and explicit `pg_catalog, public` search paths; no client grants or leaked identifiers.

The SQL candidate alone does not route Telegram events or activate processing. Both existing runtime gates remain unchanged, including global dispatch review OFF. No code activation hook is needed for this candidate stage.

## Exact file allowlist
1. `supabase/migration-candidates/20261031040000_qa_single_load_dispatch_review.sql` (new, unapplied).
2. `src/test/phaseTGG1BLocalPostgres.test.ts`.

## Verification
- Disposable PostgreSQL: QA intake, authorized cancellation confirmation, replay/concurrency, invalid lease, wrong load/group/proposal, revocation, stale/expired state, target-only claim/cleanup, exclusive delivery leases, locked grants, and no out-of-scope writes.
- Existing focused Telegram, paste-load, and financial smoke tests; diff check and preview build status.
- No live E2E claim. Report exact counts, changed paths, checkpoint, and limitations; credit cost only if measurable.

## Stop conditions
Stop without implementing speculative SQL if exact live-version checks, pinned provenance, canonical authorization reuse, post-lock expiry enforcement, or target-only outbox mutation cannot be preserved within these files. Any production application or real human Telegram QA requires separate approval.
