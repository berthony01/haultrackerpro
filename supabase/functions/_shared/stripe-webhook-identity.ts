// Phase 1C — Stripe webhook canonical billing identity validator.
//
// Runtime-neutral (no Deno globals, no URL imports, no HTTP). Consumed by
// the stripe-webhook edge function and directly executable under Vitest.
//
// This module is the single source of truth for whether a Stripe webhook
// event is allowed to mutate driver, recruiter, or agency billing state.
// Metadata is treated as routing evidence ONLY. Canonical billing identity
// (existing stripe_customer_id / stripe_subscription_id per entity) is
// authoritative. See docstrings on each decision path below for the exact
// rules from Phase 1C parts 3–11.

export type BillingContext = "driver" | "recruiter" | "agency";

export type ResolvedPrice =
  | { context: "driver"; planKey: "pro_monthly" | "pro_yearly" }
  | { context: "recruiter"; planKey: "starter" | "growth" | "fleet" }
  | { context: "agency"; planKey: "agency_starter" | "agency_team" | "agency_growth" };

export type PriceResolver = (priceId: string) => ResolvedPrice | null;

export type WebhookEventType =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

export interface CanonicalBinding {
  context: BillingContext;
  entity_key: string;                    // user_id | recruiter_id | agency_id
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
}

/** Statuses that intentionally revoke or terminate an entitlement.
 *  A subscription.updated event landing in one of these statuses is treated
 *  as a revocation, and revocation is allowed even for unrecognized (legacy)
 *  price IDs — provided the incoming customer and subscription exactly
 *  match the canonical binding for the target entity. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
  "unpaid",
]);

export interface WebhookMetadata {
  declaredContext: BillingContext | null;
  user_id: string | null;
  recruiter_id: string | null;
  agency_id: string | null;
  owner_user_id: string | null;
  plan_key: string | null; // used only for logging / diagnostics, never trusted for entitlement
}

export interface WebhookDataGateway {
  /** All canonical bindings that already reference this Stripe customer id,
   *  across all three billing contexts. Used for cross-context collision
   *  detection and canonical-first routing. */
  findByCustomerId(customerId: string): Promise<CanonicalBinding[]>;
  /** All canonical bindings that already reference this Stripe subscription
   *  id, across all three billing contexts. */
  findBySubscriptionId(subscriptionId: string): Promise<CanonicalBinding[]>;
  /** Load the canonical binding for a specific (context, entity_key). */
  loadCanonical(context: BillingContext, entity_key: string): Promise<CanonicalBinding | null>;
  /** True iff recruiter_profiles(id=recruiter_id).user_id === user_id. */
  recruiterOwnerIs(recruiter_id: string, user_id: string): Promise<boolean>;
  /** True iff the agency has an active agency_owner. When owner_user_id is
   *  non-null, it must equal the real owner. */
  agencyOwnerIs(agency_id: string, owner_user_id: string | null): Promise<boolean>;
  /** True iff a driver identity exists for user_id (auth user resolved via
   *  profiles or subscriptions). */
  driverExists(user_id: string): Promise<boolean>;
}

export type RejectReason =
  | "customer_mismatch"
  | "subscription_mismatch"
  | "target_relationship_mismatch"
  | "cross_context_customer_collision"
  | "metadata_context_conflict"
  | "unknown_price_context"
  // Phase 1R-D2-B4 — stable reasons produced by the webhook-side opposing
  // business reconciliation guard. validateWebhookIdentity itself never
  // returns these; they are declared here so the webhook can preserve the
  // existing { ok: false, decision } result shape.
  | "business_owner_unresolved"
  | "opposing_business_subscription_active"
  | "opposing_business_state_unknown";


export type IdentityDecision =
  | {
      kind: "allow_existing_binding";
      context: BillingContext;
      entity_key: string;
      resolvedPrice: ResolvedPrice;
      canonical: CanonicalBinding;
    }
  | {
      kind: "allow_initial_binding";
      context: BillingContext;
      entity_key: string;
      resolvedPrice: ResolvedPrice;
    }
  | {
      kind: "allow_revoke";
      context: BillingContext;
      entity_key: string;
      canonical: CanonicalBinding;
    }
  | { kind: "reject"; reason: RejectReason };

export interface ValidateInput {
  eventType: WebhookEventType;
  incomingCustomerId: string;
  incomingSubscriptionId: string | null;
  incomingStatus: string | null;
  priceId: string;
  metadata: WebhookMetadata;
  resolvePrice: PriceResolver;
  gateway: WebhookDataGateway;
}

function dedupeBindings(bindings: CanonicalBinding[]): CanonicalBinding[] {
  const seen = new Set<string>();
  const out: CanonicalBinding[] = [];
  for (const b of bindings) {
    const k = `${b.context}:${b.entity_key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

function metadataEntityKeyFor(context: BillingContext, m: WebhookMetadata): string | null {
  if (context === "driver") return m.user_id;
  if (context === "recruiter") return m.recruiter_id;
  return m.agency_id;
}

async function validateTargetRelationship(
  context: BillingContext,
  entity_key: string,
  metadata: WebhookMetadata,
  gateway: WebhookDataGateway,
): Promise<boolean> {
  if (context === "driver") return gateway.driverExists(entity_key);
  if (context === "recruiter") {
    if (!metadata.user_id) return false;
    return gateway.recruiterOwnerIs(entity_key, metadata.user_id);
  }
  return gateway.agencyOwnerIs(entity_key, metadata.owner_user_id);
}

/**
 * Central decision function.
 *
 * Design notes (Phase 1C):
 *   - Metadata is routing evidence only. Canonical bindings (stripe_customer_id,
 *     stripe_subscription_id per entity) are authoritative.
 *   - For subscription.updated / subscription.deleted / subscription.created,
 *     we route by canonical identity first (subscription id, then customer id),
 *     falling back to metadata only for genuinely new initial bindings.
 *   - Revocation events (deleted, or updated landing in a TERMINAL_STATUS)
 *     are allowed to proceed against an exact canonical match even when the
 *     historical price ID is no longer recognized, so a stale plan
 *     configuration cannot leave a paid entitlement stuck active.
 *   - A recognized configured price is REQUIRED for any entitlement-granting
 *     or plan-changing action.
 */
export async function validateWebhookIdentity(input: ValidateInput): Promise<IdentityDecision> {
  const { eventType, incomingCustomerId, incomingSubscriptionId, incomingStatus, priceId, metadata, resolvePrice, gateway } = input;

  // ---------------- Canonical-first routing -----------------------------
  const [bySub, byCustomer] = await Promise.all([
    incomingSubscriptionId ? gateway.findBySubscriptionId(incomingSubscriptionId) : Promise.resolve<CanonicalBinding[]>([]),
    gateway.findByCustomerId(incomingCustomerId),
  ]);

  const dedupBySub = dedupeBindings(bySub);
  const dedupByCust = dedupeBindings(byCustomer);

  // A subscription id can only ever belong to one (context, entity_key).
  if (dedupBySub.length > 1) {
    return { kind: "reject", reason: "cross_context_customer_collision" };
  }
  // A customer id may legitimately appear only once across contexts.
  if (dedupByCust.length > 1) {
    return { kind: "reject", reason: "cross_context_customer_collision" };
  }
  // If both lookups produced a binding, they must agree.
  if (dedupBySub.length === 1 && dedupByCust.length === 1) {
    const a = dedupBySub[0];
    const b = dedupByCust[0];
    if (a.context !== b.context || a.entity_key !== b.entity_key) {
      return { kind: "reject", reason: "cross_context_customer_collision" };
    }
  }

  const canonicalMatch: CanonicalBinding | null = dedupBySub[0] ?? dedupByCust[0] ?? null;

  // ---------------- Determine target (context, entity_key) --------------
  let targetContext: BillingContext | null = null;
  let targetEntityKey: string | null = null;

  if (canonicalMatch) {
    targetContext = canonicalMatch.context;
    targetEntityKey = canonicalMatch.entity_key;
    // Metadata declared context must not contradict canonical context.
    if (metadata.declaredContext && metadata.declaredContext !== canonicalMatch.context) {
      return { kind: "reject", reason: "metadata_context_conflict" };
    }
    // Metadata entity key, when present for that context, must match.
    const metaKey = metadataEntityKeyFor(canonicalMatch.context, metadata);
    if (metaKey && metaKey !== canonicalMatch.entity_key) {
      return { kind: "reject", reason: "target_relationship_mismatch" };
    }
  } else {
    // No canonical binding — this must be a legitimate initial binding.
    // Metadata is our only routing signal; require it.
    if (!metadata.declaredContext) {
      return { kind: "reject", reason: "target_relationship_mismatch" };
    }
    targetContext = metadata.declaredContext;
    targetEntityKey = metadataEntityKeyFor(targetContext, metadata);
    if (!targetEntityKey) {
      return { kind: "reject", reason: "target_relationship_mismatch" };
    }
  }

  // ---------------- Revocation short-circuit ----------------------------
  // Revocation is allowed for exact canonical matches even when the price
  // is no longer recognized. This prevents a paid entitlement from being
  // stuck active if the environment price mapping has drifted.
  const isRevocation =
    eventType === "customer.subscription.deleted" ||
    (incomingStatus !== null && TERMINAL_STATUSES.has(incomingStatus));

  if (isRevocation) {
    if (!canonicalMatch) {
      // Nothing to revoke — no-op reject.
      return { kind: "reject", reason: "target_relationship_mismatch" };
    }
    if (canonicalMatch.stripe_customer_id && canonicalMatch.stripe_customer_id !== incomingCustomerId) {
      return { kind: "reject", reason: "customer_mismatch" };
    }
    if (
      canonicalMatch.stripe_subscription_id &&
      incomingSubscriptionId &&
      canonicalMatch.stripe_subscription_id !== incomingSubscriptionId
    ) {
      return { kind: "reject", reason: "subscription_mismatch" };
    }
    return {
      kind: "allow_revoke",
      context: canonicalMatch.context,
      entity_key: canonicalMatch.entity_key,
      canonical: canonicalMatch,
    };
  }

  // ---------------- Entitlement-granting / plan-changing path -----------
  const resolvedPrice = resolvePrice(priceId);
  if (!resolvedPrice) {
    return { kind: "reject", reason: "unknown_price_context" };
  }
  if (metadata.declaredContext && metadata.declaredContext !== resolvedPrice.context) {
    return { kind: "reject", reason: "metadata_context_conflict" };
  }
  if (targetContext !== resolvedPrice.context) {
    return { kind: "reject", reason: "metadata_context_conflict" };
  }

  // Cross-context customer collision: the incoming customer id must not
  // already exist in a DIFFERENT context.
  const otherContextCollision = dedupByCust.find((b) => b.context !== resolvedPrice.context);
  if (otherContextCollision) {
    return { kind: "reject", reason: "cross_context_customer_collision" };
  }
  // Same-context, different-entity collision.
  const sameContextOtherEntity = dedupByCust.find(
    (b) => b.context === resolvedPrice.context && b.entity_key !== targetEntityKey,
  );
  if (sameContextOtherEntity) {
    return { kind: "reject", reason: "cross_context_customer_collision" };
  }

  // Validate target relationship (recruiter ownership, agency ownership,
  // driver existence). Metadata must belong to the target entity.
  const relOk = await validateTargetRelationship(targetContext, targetEntityKey!, metadata, gateway);
  if (!relOk) {
    return { kind: "reject", reason: "target_relationship_mismatch" };
  }

  // Load the specific canonical row for (context, entity_key). This handles
  // the case where canonical lookup by sub/customer was empty but a row
  // already exists for this entity (e.g. recruiter with a pre-populated
  // stripe_customer_id from checkout).
  const canonical =
    canonicalMatch ??
    (await gateway.loadCanonical(targetContext, targetEntityKey!));

  if (canonical) {
    if (canonical.stripe_customer_id && canonical.stripe_customer_id !== incomingCustomerId) {
      return { kind: "reject", reason: "customer_mismatch" };
    }
    if (
      canonical.stripe_subscription_id &&
      incomingSubscriptionId &&
      canonical.stripe_subscription_id !== incomingSubscriptionId &&
      // A different subscription id is only permitted if the prior canonical
      // subscription is terminal (i.e. we are legitimately establishing a
      // new subscription for the same customer).
      canonical.status !== null &&
      !TERMINAL_STATUSES.has(canonical.status)
    ) {
      return { kind: "reject", reason: "subscription_mismatch" };
    }
    return {
      kind: "allow_existing_binding",
      context: targetContext,
      entity_key: targetEntityKey!,
      resolvedPrice,
      canonical,
    };
  }

  return {
    kind: "allow_initial_binding",
    context: targetContext,
    entity_key: targetEntityKey!,
    resolvedPrice,
  };
}
