# Phase 1C-2 — Stripe Webhook Retry-Safe Idempotency (DEF-05)

## Difficulty & risk

- Complexity: medium. Single edge function + one migration + tests.
- Risk: high — this is the sole billing write path. A regression here silently loses billing events.
- Mitigation: state transitions live in atomic SECURITY DEFINER RPCs (Postgres serializes them); the edge function becomes a thin orchestrator around the Phase 1C validator; behavior proved by both mocked-adapter tests AND a real PGlite runtime harness.

## Preflight findings (live)

- HEAD contains full Phase 1C output: `_shared/stripe-webhook-identity.ts`, rewritten `stripe-webhook/index.ts`, and both Phase 1C test files.
- `public.stripe_webhook_events`: columns `id`, `stripe_event_id`, `event_type`, `processed_at`. Unique index on `stripe_event_id`. RLS enabled, zero policies. **0 rows**, 0 nulls, 0 dupes.
- No historical replay concern. Migration is greenfield-safe.

## Root cause of DEF-05

Ledger row is inserted *before* business logic. Any post-insert failure returns 500, Stripe retries, the unique constraint fires 23505, and the handler swallows the retry as a duplicate. The ledger has no state to distinguish "inserted" from "successfully processed".

## Files to change (expected boundary)

1. **New migration** `supabase/migrations/<ts>_stripe_webhook_events_state_machine.sql` — evolve table + add 3 RPCs.
2. **New** `supabase/functions/_shared/stripe-webhook-idempotency.ts` — runtime-neutral orchestration + typed ledger-client interface.
3. **Edit** `supabase/functions/stripe-webhook/index.ts` — route every event through claim → process → complete/fail; centralize terminal responses.
4. **Edit** `src/test/phase1cWebhookIdempotencyRetry.test.ts` — convert from documenting-defect to regression proving the fix.
5. **New** `src/test/phase1c2WebhookIdempotencyStateMachine.test.ts` — full 25-case orchestration coverage.
6. **New** `src/test/phase1c2WebhookLedgerRuntime.test.ts` — PGlite runtime harness for the migration + RPCs.
7. `.lovable/plan.md` — recorded automatically.

No changes to: pricing, checkout, account deletion, recruiter/agency capability, RLS on any other table, Dispatcher Pro, package.json, or lockfiles beyond a devDependency for `@electric-sql/pglite` if strictly required (checked first: if not already present, keep the harness Postgres-optional and gate it behind availability rather than adding a lock entry).

## Migration design

Evolve `public.stripe_webhook_events`:

```sql
ALTER TABLE public.stripe_webhook_events
  ALTER COLUMN processed_at DROP NOT NULL,
  ADD COLUMN processing_status text NOT NULL DEFAULT 'processed',
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN claim_token uuid,
  ADD COLUMN result_code text,
  ADD COLUMN last_failed_at timestamptz,
  ADD COLUMN last_error_code text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_status_ck
    CHECK (processing_status IN ('processing','processed','failed')),
  ADD CONSTRAINT stripe_webhook_events_attempt_ck
    CHECK (attempt_count >= 1),
  ADD CONSTRAINT stripe_webhook_events_processing_ck
    CHECK (processing_status <> 'processing'
           OR (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  ADD CONSTRAINT stripe_webhook_events_processed_ck
    CHECK (processing_status <> 'processed' OR processed_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_lease
  ON public.stripe_webhook_events (processing_status, lease_expires_at)
  WHERE processing_status = 'processing';
```

Historical rows (currently 0) default to `processing_status='processed'` with existing `processed_at` preserved — never replayed.

### `public.claim_stripe_webhook_event(p_event_id text, p_event_type text, p_lease_seconds int)`

SECURITY DEFINER, `SET search_path = public`, execute revoked from PUBLIC/anon/authenticated, granted to service_role. Bounded lease (30..900s, default 300). Returns `TABLE(result text, claim_token uuid, attempt integer)` where `result IN ('claimed','already_processed','in_progress','event_type_conflict')`.

Body performs `INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING` then a single `UPDATE ... WHERE stripe_event_id=$1 AND (status='failed' OR (status='processing' AND lease_expires_at < now()))` returning the new token/attempt. If insert wins → `claimed`. Otherwise re-`SELECT ... FOR UPDATE` and branch on current state → `already_processed` / `in_progress` / `event_type_conflict`. Postgres row lock serializes concurrent claims.

### `public.complete_stripe_webhook_event(p_event_id text, p_claim_token uuid, p_result_code text)`

Only transitions `processing → processed` **AND** `claim_token = p_claim_token`. Sets `processed_at=now()`, `result_code`, clears `claim_token`, `lease_expires_at`. Returns boolean. Accepts `result_code IN ('applied','rejected','ignored')`.

### `public.fail_stripe_webhook_event(p_event_id text, p_claim_token uuid, p_error_code text)`

Only `processing → failed` AND matching token. Clears lease + token, sets `last_failed_at`, `last_error_code`. Attempt count preserved. Returns boolean. `p_error_code` truncated/validated to `^[a-z0-9_]{1,64}$`.

Stale-worker protection is intrinsic: token mismatch → no rows updated → returns false.

## Orchestration module (`_shared/stripe-webhook-idempotency.ts`)

```ts
export type ClaimResult =
  | { kind: 'claimed'; claimToken: string; attempt: number }
  | { kind: 'already_processed' }
  | { kind: 'in_progress' }
  | { kind: 'event_type_conflict' };

export type TerminalResult = 'applied' | 'rejected' | 'ignored';

export interface LedgerClient {
  claim(eventId: string, eventType: string, leaseSeconds: number): Promise<ClaimResult>;
  complete(eventId: string, token: string, result: TerminalResult): Promise<boolean>;
  fail(eventId: string, token: string, errorCode: string): Promise<boolean>;
}

export async function withIdempotency<T>(deps: {
  ledger: LedgerClient;
  eventId: string;
  eventType: string;
  leaseSeconds?: number; // clamped 30..900, default 300
  process: (ctx: { attempt: number }) => Promise<{ result: TerminalResult; body: T }>;
}): Promise<
  | { kind: 'ok'; status: 200; body: T; result: TerminalResult }
  | { kind: 'duplicate'; status: 200 }
  | { kind: 'in_progress'; status: 409 }
  | { kind: 'conflict'; status: 200 }              // event_type_conflict, safe log
  | { kind: 'transient_failure'; status: 500; errorCode: string }
  | { kind: 'complete_failed'; status: 500 }
  | { kind: 'claim_failed'; status: 500 }
>;
```

Handler contract: if `process` throws → call `fail`, return 500. If `process` resolves → call `complete`; on `false` return 500 (do NOT claim success). All state-changing branches inside the real webhook return by wrapping in `withIdempotency`.

## Webhook handler changes

- Replace the pre-check `insert into stripe_webhook_events` + business switch with a single `withIdempotency` wrap around the Phase 1C-validated processor.
- Processor returns `{ result: 'applied' | 'rejected' | 'ignored', body }`:
  - Successful mutations → `applied`
  - Identity/type/checkout mismatches (Phase 1C rejections) → `rejected` (existing safe response body preserved)
  - `invoice.*`, unhandled types, no-op branches → `ignored`
- Phase 1C validator, canonical routing, cross-context checks, log shapes: unchanged.

## Testing

### `phase1cWebhookIdempotencyRetry.test.ts` (rewritten)

Now proves: first call transient-fails → status `failed`; retry re-processes and succeeds. Uses the same `withIdempotency` + fake `LedgerClient` the real handler uses.

### `phase1c2WebhookIdempotencyStateMachine.test.ts`

All 25 cases from Part 14 against an in-memory `LedgerClient` that mirrors the Postgres semantics (token, lease, attempt counter, status).

### `phase1c2WebhookLedgerRuntime.test.ts`

PGlite harness: apply the migration verbatim, then drive `claim/complete/fail` through actual SQL. Verifies serialization, token stale-guard, lease reclaim, historical-row preservation, and privilege revocation. If `@electric-sql/pglite` is not resolvable at test time, the test is skipped with a loud `console.warn` — but preflight will install it as a devDependency first (single, narrowly justified dep; no lock rewrite otherwise).

### Preserved

Existing `phase1cWebhookIdentityValidator.test.ts` and DEF-04 exploit assertions unchanged. Full suite must remain ≥ 827 + new tests.

## Verification

- `bunx tsc -p tsconfig.app.json --noEmit`
- `bunx tsc -p tsconfig.node.json --noEmit`
- `bunx vitest run`
- `bun run build`
- Post-migration DB inspection: schema, RPC definitions, `has_function_privilege`, RLS state, historical count = 0 (unchanged).

## Stop-and-report triggers

Historical rows appear during migration; duplicate event IDs; Phase 1C must change; scope extends beyond ledger + orchestration + tests; DEF-04 becomes reachable; unrelated tests break.

## Final report

Will include all 40 required items, live post-migration ledger snapshot, DEF-04/DEF-05 regression status, and Dispatcher Pro gate = **blocked** pending final driver/recruiter readiness review.

Lovable, the Phase 1C-2 plan is approved in principle, but incorporate the following corrections before implementation. Continue directly after updating the plan. Do not ask for another approval unless the scope expands, a migration beyond the webhook ledger is required, or a live-data inconsistency is discovered.

1. Rename the newly confirmed webhook retry defect.

The original production-readiness audit already assigned DEF-05 to the recruiter duplicate-subscription guard issue.

Do not reuse DEF-05.

Record the Stripe webhook retry/silent-drop defect as:

DEF-23 — Stripe webhook event can be permanently skipped after a post-ledger transient failure.

Keep the phase name Phase 1C-2 unchanged.

2. Do not default future webhook rows to `processed`.

The proposed migration currently uses:

`processing_status text NOT NULL DEFAULT 'processed'`

That is acceptable only as a temporary migration backfill mechanism for historical rows, not as the continuing default for new rows.

Required migration sequence:

- Add the new columns initially without unsafe terminal defaults where necessary.

- Explicitly backfill existing historical rows as `processed`.

- Preserve their existing `processed_at`.

- Assign a historical result such as `legacy_processed` if needed.

- After backfill, ensure new event rows cannot accidentally become terminal merely through a direct insert.

- The claim RPC must explicitly insert:

  - `processing_status = 'processing'`

  - `attempt_count = 1`

  - `processing_started_at = now()`

  - `lease_expires_at`

  - a new `claim_token`

  - `processed_at = null`

  - `result_code = null`

- Drop any inherited `processed_at DEFAULT now()` if it would automatically populate processing rows.

Prefer no default for `processing_status`, so all valid new rows must be established through the claim RPC.

3. Strengthen the state consistency constraints.

In addition to the planned constraints, enforce equivalent rules:

- `processing` requires:

  - non-null claim token

  - non-null processing start

  - non-null lease expiration

  - null processed timestamp

- `processed` requires:

  - non-null processed timestamp

  - non-null permitted terminal result code

  - null active claim token

  - null active lease

- `failed` requires:

  - non-null last-failed timestamp

  - non-null sanitized error code

  - null active claim token

  - null active lease

  - null processed timestamp

Historical rows may use a narrowly defined `legacy_processed` terminal result. Do not weaken all terminal result validation merely to support historical data.

4. Check event-type conflicts before reclaiming an existing row.

The planned claim flow must not reclaim a failed or expired row before confirming that its stored `event_type` equals the incoming `p_event_type`.

Otherwise, the same Stripe event ID could be reclaimed under a different event type.

Required behavior:

- Insert the new event explicitly as `processing`.

- On conflict, lock the existing row.

- Compare stored and incoming event types first.

- If they differ, return `event_type_conflict`.

- Do not update status, attempt count, token, lease, timestamps, or result fields.

- Only after event-type equality is proven may a failed or expired claim be reclaimed.

Keep the entire decision inside one atomic SECURITY DEFINER function and transaction.

5. Protect business processing from stale workers, not only ledger completion.

A claim token that is checked only during `complete` and `fail` prevents an old worker from changing the ledger, but it does not automatically prevent that old worker from performing billing writes after its lease expires and another worker reclaims the event.

Use one of these safe approaches:

Preferred narrow approach:

- Determine the actual maximum execution duration of the deployed Edge Function environment.

- Use a server-controlled lease that is longer than that execution ceiling plus a safety margin.

- Do not accept lease duration from the webhook request.

- Ensure an old invocation cannot still be executing when the lease becomes reclaimable.

If that guarantee cannot be established from the current environment:

- Add a narrowly scoped claim-renewal RPC and renew the lease before expensive external calls and before billing mutation.

- Every renewal must require the active claim token.

- A failed renewal must stop business processing before billing mutation.

Do not claim stale-worker protection is complete merely because stale completion and failure updates are blocked.

6. Add the missing completion-failure retry scenario.

The plan tests failure during business processing, but it must also test:

1. Claim succeeds.

2. Billing processing succeeds.

3. Ledger completion fails or its response is lost.

4. Handler returns 500.

5. Stripe retries.

6. The event is processed safely without duplicating or corrupting billing state.

Because this system provides at-least-once processing, every webhook branch must be safe when executed again after its earlier business mutation may already have succeeded.

Add explicit assertions that retry does not:

- create duplicate billing records

- replace canonical identities

- grant duplicate entitlements

- undo cancellation

- create duplicate side effects

- regress DEF-04

If any current webhook side effect is not safely repeatable, stop and report it as a separate defect rather than hiding it in this phase.

7. Do not allow the required PGlite runtime test to skip.

The plan currently says the PGlite test may skip with a warning if the package is unavailable.

That is not acceptable for Phase 1C-2 PASS.

Use one of these approaches:

- Run PGlite through a temporary isolated sandbox dependency without modifying `package.json` or lockfiles.

- Or, with explicit narrow justification, add it as a development dependency and include the resulting package changes in the declared scope.

Preferred approach: temporary sandbox installation, so production dependency files remain untouched.

If the real Postgres/PGlite migration and RPC harness cannot run, classify Phase 1C-2 as UNCONFIRMED or FAIL. Do not skip the critical runtime test and still declare PASS.

8. Execute the exact migration and RPC definitions in the runtime harness.

The PGlite harness must apply the actual migration file created for production.

Do not manually recreate a simplified version of:

- the table

- constraints

- claim RPC

- completion RPC

- failure RPC

- privilege grants

The runtime result must prove the exact production SQL.

A mocked or in-memory `LedgerClient` remains useful for orchestration tests, but it cannot replace the real Postgres state-machine test.

9. Clarify claim and retry response behavior.

For an unexpired `in_progress` claim:

- Return a retryable non-2xx response.

- Prefer a generic 500 unless there is a documented reason to use 409.

- Do not return `{duplicate:true}`.

- Do not mark the event failed.

- Do not steal the active claim.

For `already_processed`:

- Return 200 duplicate success.

- Do not rerun business logic.

For `event_type_conflict`:

- Perform zero billing mutation.

- Do not modify the original ledger row.

- Return a controlled permanent response.

- Log only a stable reason code.

10. Keep the function security strict.

All three RPCs must:

- be SECURITY DEFINER

- use schema-qualified object names

- use a pinned safe search path

- revoke execution from PUBLIC, anon, and authenticated

- grant execution only to service_role

- validate input lengths

- reject empty event IDs and event types

- clamp the lease internally

- sanitize error/result codes

- never return full Stripe identifiers in errors

After migration, verify privileges using `has_function_privilege` for anon, authenticated, and service_role.

11. Preserve Phase 1C exactly.

The new idempotency wrapper must surround the existing Phase 1C processor.

Do not duplicate or rewrite its identity rules.

The exact DEF-04 exploit must still be rejected through the production-used handler path after the idempotency change.

12. Update the final acceptance criteria.

Phase 1C-2 may be marked PASS only when:

- DEF-23 is fixed.

- Failed events can be reclaimed and processed.

- Expired leases can be reclaimed.

- Unexpired leases cannot be stolen.

- Stale workers cannot mutate billing after a reclaim.

- Completion failure followed by retry is safe.

- Permanent rejections are terminally recorded before returning 200.

- The exact production migration and RPCs pass a real PGlite/Postgres runtime test.

- No critical runtime test is skipped.

- DEF-04 remains fixed.

- All existing and new tests pass.

- Both TypeScript projects pass.

- Production build passes.

- Historical ledger rows are preserved and not replayed.

- No unrelated behavior changes.

Continue with the narrow implementation after incorporating these corrections.