# Phase 1C — Stripe Webhook Canonical Billing Identity Remediation

## Difficulty & risk

- Complexity: **medium-high** (single edge function, but every branch changes control flow).
- Risk: **high** — this file is the sole write path for driver/recruiter/agency billing. Regression here silently corrupts entitlements.
- Mitigation: extract decision logic into a runtime-neutral, unit-tested validator; keep the edge-function file as a thin adapter that calls the validator + performs DB writes.

## Baseline confirmed

- HEAD = `3055ed4c423617488b083aa1af1ec5b70ef47c1a` (expected).
- Live collision preflight: `cross_ctx_customer_collisions=0`, `cross_ctx_subscription_collisions=0`, `driver_profile_mirror_conflicts=0`, `recruiter_ownership_mismatches=0`. No reconciliation needed.

## Root cause of DEF-04

`handleRecruiterSubscription`, `handleAgencySubscription`, and the driver `subscription.updated` branch all upsert on `recruiter_id` / `agency_id` / `user_id` using `subscription.customer` from the incoming event. When metadata names Recruiter B but `subscription.customer` is unrelated, the upsert overwrites Recruiter B's canonical `stripe_customer_id`. No pre-write comparison against the existing canonical row is performed. Same pattern exists for agency and driver branches, plus the driver update branch resolves via `stripe.customers.list({email})` fallback… actually the current driver update branch resolves by `stripe_customer_id` lookup (safer), but the recruiter/agency branches trust metadata unconditionally.

## Files to change (expected boundary)

1. **New**: `supabase/functions/_shared/stripe-webhook-identity.ts` — runtime-neutral validator.
2. **Edit**: `supabase/functions/stripe-webhook/index.ts` — route every state-changing event through the validator before any DB write; on rejection, log stable reason code and return 200 (no Stripe retry loop for permanent integrity rejections; retryable failures continue to return 500).
3. **New tests**:
  - `src/test/phase1cWebhookIdentityValidator.test.ts` — direct unit tests for the validator (all 30 cases, exploit regression).
  - `src/test/phase1cWebhookIdempotencyRetry.test.ts` — the focused idempotency-retry diagnostic (does NOT change idempotency behavior).

No migration. No pricing / capability / RLS / deletion / checkout changes. If checkout files need edits, stop and report first.

## Validator design (`stripe-webhook-identity.ts`)

```ts
export type BillingContext = "driver" | "recruiter" | "agency";
export type PriceContextResolver = (priceId: string) => BillingContext | null;

export interface CanonicalBinding {
  entity_key: string;           // user_id | recruiter_id | agency_id
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status?: string | null;
}

export interface CrossContextIndex {
  driverByCustomer:   (cid: string) => Promise<{ user_id: string } | null>;
  recruiterByCustomer:(cid: string) => Promise<{ recruiter_id: string } | null>;
  agencyByCustomer:   (cid: string) => Promise<{ agency_id: string } | null>;
}

export type IdentityDecision =
  | { kind: "allow_existing_binding";  context: BillingContext; entity_key: string; plan_key: string }
  | { kind: "allow_initial_binding";   context: BillingContext; entity_key: string; plan_key: string }
  | { kind: "reject"; reason:
      | "customer_mismatch"
      | "subscription_mismatch"
      | "target_relationship_mismatch"
      | "cross_context_customer_collision"
      | "metadata_context_conflict"
      | "unknown_price_context" };

export async function validateWebhookIdentity(input: {
  eventType: "checkout.session.completed"
           | "customer.subscription.created"
           | "customer.subscription.updated"
           | "customer.subscription.deleted";
  declaredContext: BillingContext | null;   // from metadata
  targetEntityKey: string | null;           // from metadata
  incomingCustomerId: string;
  incomingSubscriptionId: string | null;
  priceId: string;
  canonical: CanonicalBinding | null;       // current row, if any
  targetRelationshipValid: boolean;         // caller checks recruiter/agency ownership
  priceContextResolver: PriceContextResolver;
  crossContext: CrossContextIndex;
}): Promise<IdentityDecision>
```

Decision order:

1. Resolve `priceContext = priceContextResolver(priceId)`. If null → `unknown_price_context`.
2. If `declaredContext && declaredContext !== priceContext` → `metadata_context_conflict`.
3. If `!targetRelationshipValid` → `target_relationship_mismatch`.
4. If `canonical?.stripe_customer_id && canonical.stripe_customer_id !== incomingCustomerId` → `customer_mismatch`.
5. If `canonical?.stripe_subscription_id && incomingSubscriptionId && canonical.stripe_subscription_id !== incomingSubscriptionId` → `subscription_mismatch` (applies to updated/deleted; created may seed if canonical.sub is null OR canonical.status is terminal).
6. Cross-context check on `incomingCustomerId`: look up in the two other contexts; any hit → `cross_context_customer_collision`. Also reject if hit in same context under a different entity_key.
7. If canonical exists and customer matches → `allow_existing_binding`.
8. Otherwise → `allow_initial_binding`.

Pure module: no `Deno`, no HTTP, no URL imports, no `any`, discriminated unions, no full IDs in logs (webhook adapter handles logging with reason code only).

## Webhook adapter changes

For each of `checkout.session.completed`, `customer.subscription.created|updated|deleted`:

1. Determine `declaredContext` and `targetEntityKey` from metadata (+ session for checkout).
2. For `checkout.session.completed`: `stripe.subscriptions.retrieve(session.subscription)` and assert `retrieved.id === session.subscription && retrieved.customer === session.customer`; use retrieved for the rest.
3. Load canonical row from the appropriate table.
4. Verify `targetRelationshipValid`:
  - recruiter: `recruiter_profiles.id = recruiter_id AND user_id = metadata.user_id`.
  - agency: `agency_members` row `agency_id, role='agency_owner', status='active'`; if owner metadata present, must match.
  - driver: `subscriptions` (or profiles) row for `user_id` exists.
5. Call `validateWebhookIdentity`. On reject: log `{reason, event_type, context}` (no full IDs), return 200 `{received:true, rejected:true, reason}` so Stripe does not retry.
6. On allow: perform the existing upsert, but pass canonical customer/subscription so we never overwrite a non-null value with a different value (defense in depth — validator has already gated).

Agency branch also drops the "customer lookup fallback" that inferred agency ownership from `stripe_customer_id` when metadata was absent — replaced by explicit metadata + priceContext resolution.

## Tests

### `phase1cWebhookIdentityValidator.test.ts` (drives the pure validator)

Cases 1–30 from the prompt, each asserting decision `kind` + `reason` and that no side effects occur (validator is pure; a companion in-memory DB harness proves "no mutation on reject").

### `phase1cWebhookExploitRegression.test.ts` (integrated with in-memory DB shim)

Reproduces the exact DEF-04 exploit against a routing function extracted from the webhook. Snapshots recruiter row before/after and asserts byte-equal.

### `phase1cWebhookIdempotencyRetry.test.ts` (diagnostic only)

Simulates ledger-insert-then-crash by driving the adapter's core logic with a mock supabaseClient that:

1. First call: succeeds on ledger insert, throws in the recruiter upsert. Expect first response = 500.
2. Second call (same event id): supabaseClient reports `23505` on ledger insert. Assert whether the branch returns `{duplicate:true}` without reprocessing (=> defect) or reprocesses. Report result; do NOT change idempotency.

## Verification commands

- `bunx tsc -p tsconfig.app.json --noEmit`
- `bunx tsc -p tsconfig.node.json --noEmit`
- `bunx vitest run`  (expect ≥ 799 + new tests)
- `bun run build`

## Stop-and-report triggers

Any of: live collision found (none currently), migration needed, checkout files need edits, RLS change required, exploit still mutates after fix, unrelated tests break.

## Final report

Will include all 36 required items, live post-change collision counts, and Dispatcher Pro gate = **blocked** until every PASS criterion holds.

The plan is approved in principle, but make the following corrections before implementation. Do not start writing code until these corrections are incorporated into the plan.

1. Do not require a recognized current price ID before revoking an existing canonical entitlement.

The proposed validator currently resolves price context first and rejects `unknown_price_context` for every event type. That is unsafe for cancellation and terminal-status events.

A previously valid subscription may reference an older Stripe price ID that is no longer present in the current environment configuration. We must not leave paid access active merely because the price is now unknown.

Required rule:

- Unknown, recruiter, or agency prices must never grant or upgrade driver Pro.

- Unknown prices must never grant or upgrade recruiter or agency plans.

- However, when the incoming customer ID and subscription ID exactly match the existing canonical billing record, a `customer.subscription.deleted` event must still be permitted to revoke that entitlement even if the historical price ID is no longer recognized.

- The same principle applies to a canonical subscription update entering a terminal or non-entitled status such as `canceled`, `incomplete_expired`, or another intentionally revoking status.

- An unknown price may support revocation of an already-proven canonical subscription, but may never support initial binding, upgrade, plan selection, or paid entitlement.

The validator must therefore distinguish:

- entitlement-granting or plan-changing events, which require a recognized configured price

- entitlement-revoking events for an exact canonical customer and subscription, which may safely proceed without deriving a paid plan from the price

Do not derive a paid plan from metadata under any circumstances.

2. Route existing subscription events from canonical billing identity first, not metadata first.

For `customer.subscription.updated` and `customer.subscription.deleted`, the strongest routing evidence is:

1. exact canonical `stripe_subscription_id`

2. exact canonical `stripe_customer_id`

3. metadata only as corroborating evidence

Do not begin by trusting `metadata.recruiter_id`, `metadata.agency_id`, or `metadata.user_id` to choose the record that will be loaded.

Required behavior:

- Search canonical billing records by the incoming subscription ID first.

- If no subscription match exists, search by the incoming customer ID.

- If one exact canonical entity is found, that entity is the candidate target.

- Metadata, price context, and entity relationships must agree with that canonical target.

- Conflicting metadata must reject the event.

- Metadata must never redirect an existing canonical event to another user, recruiter, or agency.

- If the incoming customer or subscription resolves to more than one entity, fail closed as a collision.

- For a genuinely new initial binding with no canonical match, metadata plus recognized price context and verified ownership may establish the candidate target.

This allows legitimate existing subscription updates and deletions to continue even if metadata is absent, while preventing metadata from hijacking another entity.

3. Change the price resolver to return both context and plan.

The proposed `PriceContextResolver` returns only `BillingContext`, but `IdentityDecision` returns `plan_key`. That leaves plan selection ambiguous and creates a risk that the adapter continues trusting `metadata.plan` or `metadata.plan_key`.

Use a resolver shaped like:

```ts

type ResolvedPrice =

  | {

      context: "driver";

      planKey: "pro_monthly" | "pro_yearly";

    }

  | {

      context: "recruiter";

      planKey: "starter" | "growth" | "fleet";

    }

  | {

      context: "agency";

      planKey: "agency_starter" | "agency_team" | "agency_growth";

    };

type PriceResolver = (priceId: string) => ResolvedPrice | null;