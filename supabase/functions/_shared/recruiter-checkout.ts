// Phase 1G-R1A2 — Runtime-neutral Recruiter Checkout orchestrator.
//
// This module has NO Deno globals, NO URL imports, NO Stripe SDK imports, NO
// Supabase imports, and NO environment reads. It is directly importable by
// Vitest. All I/O flows through the injected `Deps` interfaces.
//
// The public surface is:
//   - runRecruiterCheckout(input, deps): produces a typed result with a safe
//     HTTP status, a stable public code, a safe message, and an optional
//     Checkout URL. Raw dependency errors NEVER leak through the result.
//   - Idempotency-key helpers.
//   - The blocking/terminal subscription-status policy.
//
// The A1 SQL candidate defines the intent state machine consumed here through
// the IntentStore adapter.

export type RecruiterPlan = "starter" | "growth" | "fleet";
export const RECRUITER_PLANS: readonly RecruiterPlan[] = [
  "starter",
  "growth",
  "fleet",
] as const;

// ---------------------------------------------------------------------------
// Public result surface
// ---------------------------------------------------------------------------

export type RecruiterCheckoutPublicCode =
  | "checkout_ready"
  | "in_progress"
  | "not_owner"
  | "not_eligible"
  | "invalid_plan"
  | "invalid_origin"
  | "invalid_price"
  | "customer_conflict"
  | "customer_not_found"
  | "customer_ambiguous"
  | "subscription_exists"
  | "unknown_subscription_status"
  | "checkout_processing"
  | "session_invalid"
  | "transient_error"
  | "support_required"
  // Phase 1R-D1 — cross-context business billing guard codes. These are
  // produced by the edge adapter's precheck, never by the orchestrator flow.
  | "agency_entitlement_exists"
  | "agency_billing_requires_management"
  | "opposing_entitlement_unknown"
  | "internal_error";

export interface RecruiterCheckoutResult {
  status: number;
  code: RecruiterCheckoutPublicCode;
  message: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Dependency interfaces (narrow)
// ---------------------------------------------------------------------------

export interface IntentClaimResult {
  outcome:
    | "claimed"
    | "ready_candidate"
    | "in_progress"
    | "not_owner"
    | "not_eligible"
    | "invalid_plan";
  intent_id: string | null;
  claim_token: string | null;
  generation: number | null;
  checkout_url: string | null;
  checkout_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  reason: string | null;
}

export interface IntentSimpleResult {
  outcome: string;
  reason: string | null;
}

export interface IntentStore {
  claim(input: {
    recruiterId: string;
    userId: string;
    plan: RecruiterPlan;
  }): Promise<IntentClaimResult>;
  bind(input: {
    intentId: string;
    claimToken: string;
    customerId: string;
  }): Promise<IntentSimpleResult>;
  complete(input: {
    intentId: string;
    claimToken: string;
    customerId: string;
    sessionId: string;
    url: string;
    expiresAt: string;
  }): Promise<IntentSimpleResult>;
  fail(input: {
    intentId: string;
    claimToken: string;
    errorCode: string;
    terminal: boolean;
  }): Promise<IntentSimpleResult>;
  loadCanonicalCustomer(input: {
    recruiterId: string;
    userId: string;
  }): Promise<{ stripeCustomerId: string | null }>;
}

export interface StripeCustomerLike {
  id: string;
  deleted?: boolean;
  metadata: Record<string, string>;
}

export interface StripeSubscriptionLike {
  id: string;
  status: string;
}

export interface StripeSessionLike {
  id: string;
  status: string; // "open" | "complete" | "expired" | other
  url: string | null;
  customer: string | null;
  expires_at: number; // epoch seconds
  metadata: Record<string, string>;
}

export interface StripeGateway {
  retrieveCustomer(id: string): Promise<StripeCustomerLike | null>;
  searchCustomersByMetadata(q: {
    recruiterId: string;
    userId: string;
  }): Promise<StripeCustomerLike[]>;
  createCustomer(input: {
    recruiterId: string;
    userId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<StripeCustomerLike>;
  listAllSubscriptions(customerId: string): Promise<StripeSubscriptionLike[]>;
  retrieveSession(id: string): Promise<StripeSessionLike | null>;
  createSession(input: {
    customerId: string;
    priceId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }): Promise<StripeSessionLike>;
}

export interface Clock {
  nowSeconds(): number;
}

export interface RecruiterCheckoutDeps {
  intents: IntentStore;
  stripe: StripeGateway;
  clock: Clock;
}

export interface RecruiterCheckoutInput {
  userId: string;
  recruiterId: string;
  plan: RecruiterPlan;
  priceId: string;
  origin: string; // already validated allowlisted origin
}

// ---------------------------------------------------------------------------
// Policy tables
// ---------------------------------------------------------------------------

export const BLOCKING_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing", // trial-allowlist
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

export const TERMINAL_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
]);

// 30 minutes: within Stripe's allowed Checkout expiration bounds
// (min 30 min, max 24 h).
export const RECRUITER_CHECKOUT_TTL_SECONDS = 30 * 60;

// Metadata contract shared across customer + session + subscription_data.
export function recruiterCanonicalMetadata(input: {
  userId: string;
  recruiterId: string;
  plan: RecruiterPlan;
}): Record<string, string> {
  return {
    billing_type: "recruiter",
    billing_context: "recruiter_premium",
    user_id: input.userId,
    recruiter_id: input.recruiterId,
    plan: input.plan,
  };
}

export function recruiterSessionMetadata(input: {
  userId: string;
  recruiterId: string;
  plan: RecruiterPlan;
  intentId: string;
  generation: number;
}): Record<string, string> {
  return {
    ...recruiterCanonicalMetadata(input),
    checkout_intent_id: input.intentId,
    checkout_generation: String(input.generation),
  };
}

export function recruiterCustomerIdempotencyKey(recruiterId: string): string {
  return `htp:recruiter:customer:${recruiterId}`;
}

export function recruiterCheckoutIdempotencyKey(
  recruiterId: string,
  generation: number,
): string {
  return `htp:recruiter:checkout:${recruiterId}:${generation}`;
}

export function recruiterSuccessUrl(origin: string): string {
  return `${origin}/dashboard?page=opportunities&view=recruiter&recruiter_checkout=success`;
}
export function recruiterCancelUrl(origin: string): string {
  return `${origin}/dashboard?page=opportunities&view=recruiter&recruiter_checkout=cancel`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isRecruiterPlan(v: unknown): v is RecruiterPlan {
  return v === "starter" || v === "growth" || v === "fleet";
}

// Origin allowlist for the app. The edge adapter validates before invoking
// the orchestrator, but the orchestrator re-validates as a defense in depth.
export const RECRUITER_ALLOWED_ORIGINS: readonly string[] = [
  "https://haultrackerpro.com",
  "https://www.haultrackerpro.com",
  "https://haultrackerpro.lovable.app",
  // Phase 1R-D2-B6-B1 — exact trusted Lovable project preview origin. Exact
  // string match only: no wildcard preview hosts, no arbitrary id-preview--*,
  // no localhost, no lovable.dev editor origins, no suffix matching.
  "https://id-preview--6d28fa14-57dc-418b-9196-19e144f0e8df.lovable.app",
];


export function isAllowedRecruiterOrigin(origin: string): boolean {
  return RECRUITER_ALLOWED_ORIGINS.includes(origin);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function customerMetadataMatches(
  customer: StripeCustomerLike,
  input: { userId: string; recruiterId: string },
): boolean {
  if (!customer.metadata) return false;
  return (
    customer.metadata["billing_type"] === "recruiter" &&
    customer.metadata["recruiter_id"] === input.recruiterId &&
    customer.metadata["user_id"] === input.userId
  );
}

function sessionMetadataMatches(
  session: StripeSessionLike,
  expected: Record<string, string>,
): boolean {
  for (const [k, v] of Object.entries(expected)) {
    if (session.metadata?.[k] !== v) return false;
  }
  return true;
}

// Never leak raw dependency errors. Callers translate specific outcomes to
// stable public codes; unknown throwables become `transient_error`.
async function safeCall<T>(fn: () => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false }
> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

// Result constructors — all messages are short, human-safe, and never
// interpolate dependency data.

function resultReady(url: string): RecruiterCheckoutResult {
  return {
    status: 200,
    code: "checkout_ready",
    message: "Checkout session ready.",
    url,
  };
}
function resultInProgress(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "in_progress",
    message: "A checkout is already in progress for this account.",
  };
}
function resultSubscriptionExists(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "subscription_exists",
    message: "This account already has an active recruiter subscription.",
  };
}
function resultUnknownSubStatus(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "unknown_subscription_status",
    message: "Subscription in an unrecognized state. Contact support.",
  };
}
function resultCustomerConflict(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "customer_conflict",
    message: "Billing identity conflict. Contact support.",
  };
}
function resultCustomerNotFound(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "customer_not_found",
    message: "Billing profile is out of date. Contact support.",
  };
}
function resultCustomerAmbiguous(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "customer_ambiguous",
    message: "Multiple billing profiles found. Contact support.",
  };
}
function resultCheckoutProcessing(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "checkout_processing",
    message: "Checkout is finalizing. Try again shortly.",
  };
}
function resultSessionInvalid(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "session_invalid",
    message: "Existing checkout is no longer valid. Try again shortly.",
  };
}
function resultTransient(): RecruiterCheckoutResult {
  return {
    status: 503,
    code: "transient_error",
    message: "Temporary billing error. Please try again.",
  };
}
function resultSupport(): RecruiterCheckoutResult {
  return {
    status: 409,
    code: "support_required",
    message: "Billing requires support intervention.",
  };
}
function resultInvalidPlan(): RecruiterCheckoutResult {
  return {
    status: 400,
    code: "invalid_plan",
    message: "Unknown recruiter plan.",
  };
}
function resultInvalidPrice(): RecruiterCheckoutResult {
  return {
    status: 400,
    code: "invalid_price",
    message: "Plan price is not configured.",
  };
}
function resultInvalidOrigin(): RecruiterCheckoutResult {
  return {
    status: 400,
    code: "invalid_origin",
    message: "Request origin is not permitted.",
  };
}
function resultNotOwner(): RecruiterCheckoutResult {
  return {
    status: 403,
    code: "not_owner",
    message: "Recruiter profile does not belong to this account.",
  };
}
function resultNotEligible(): RecruiterCheckoutResult {
  return {
    status: 403,
    code: "not_eligible",
    message: "Recruiter is not eligible for checkout.",
  };
}

// Best-effort fail; the outer result must not depend on this succeeding.
async function safeFail(
  deps: RecruiterCheckoutDeps,
  intentId: string | null,
  claimToken: string | null,
  errorCode: string,
  terminal: boolean,
): Promise<void> {
  if (!intentId || !claimToken) return;
  await safeCall(() =>
    deps.intents.fail({
      intentId,
      claimToken,
      errorCode,
      terminal,
    }),
  );
}

// ---------------------------------------------------------------------------
// Subscription guard
// ---------------------------------------------------------------------------

export type SubscriptionGuardOutcome =
  | { kind: "ok" }
  | { kind: "blocking" }
  | { kind: "unknown" }
  | { kind: "transient" };

export async function evaluateSubscriptionGuard(
  deps: RecruiterCheckoutDeps,
  customerId: string,
): Promise<SubscriptionGuardOutcome> {
  const call = await safeCall(() => deps.stripe.listAllSubscriptions(customerId));
  if (!call.ok) return { kind: "transient" };

  for (const sub of call.value) {
    const s = sub.status;
    if (BLOCKING_SUBSCRIPTION_STATUSES.has(s)) return { kind: "blocking" };
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(s)) continue;
    // Any status outside the closed policy set fails closed.
    return { kind: "unknown" };
  }
  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runRecruiterCheckout(
  input: RecruiterCheckoutInput,
  deps: RecruiterCheckoutDeps,
): Promise<RecruiterCheckoutResult> {
  // Defensive validation (edge adapter also validates).
  if (!isRecruiterPlan(input.plan)) return resultInvalidPlan();
  if (!input.priceId || input.priceId.trim() === "") return resultInvalidPrice();
  if (!isAllowedRecruiterOrigin(input.origin)) return resultInvalidOrigin();
  if (!input.userId || !input.recruiterId) return resultNotOwner();

  // 1. Claim intent
  const claimCall = await safeCall(() =>
    deps.intents.claim({
      recruiterId: input.recruiterId,
      userId: input.userId,
      plan: input.plan,
    }),
  );
  if (!claimCall.ok) return resultTransient();
  const claim = claimCall.value;

  switch (claim.outcome) {
    case "invalid_plan":
      return resultInvalidPlan();
    case "not_owner":
      return resultNotOwner();
    case "not_eligible":
      return resultNotEligible();
    case "in_progress":
      return resultInProgress();
    case "ready_candidate":
      return handleReadyCandidate(input, deps, claim);
    case "claimed":
      return handleClaimed(input, deps, claim);
    default:
      // Unknown outcome — fail closed without leaking anything.
      return resultTransient();
  }
}

// ---------------------------------------------------------------------------
// Ready-candidate revalidation path (no claim token)
// ---------------------------------------------------------------------------

async function handleReadyCandidate(
  input: RecruiterCheckoutInput,
  deps: RecruiterCheckoutDeps,
  claim: IntentClaimResult,
): Promise<RecruiterCheckoutResult> {
  const intentId = claim.intent_id;
  const generation = claim.generation;
  const storedCustomerId = claim.stripe_customer_id;
  const storedSessionId = claim.stripe_checkout_session_id;
  const storedUrl = claim.checkout_url;

  if (
    !intentId ||
    generation == null ||
    !storedCustomerId ||
    !storedSessionId ||
    !storedUrl
  ) {
    // Ready row is missing required identity — cannot revalidate.
    return resultSessionInvalid();
  }

  // 1. Resolve + validate canonical customer.
  const canonical = await resolveCanonicalCustomer(input, deps, storedCustomerId);
  if (canonical.kind !== "ok") return canonical.result;

  // 2. Subscription guard first.
  const guard = await evaluateSubscriptionGuard(deps, canonical.customer.id);
  if (guard.kind === "blocking") return resultSubscriptionExists();
  if (guard.kind === "unknown") return resultUnknownSubStatus();
  if (guard.kind === "transient") return resultTransient();

  // 3. Retrieve exact stored session.
  const sessCall = await safeCall(() => deps.stripe.retrieveSession(storedSessionId));
  if (!sessCall.ok) return resultTransient();
  const session = sessCall.value;
  if (!session) return resultSessionInvalid();

  // 4. Complete-with-lag case first.
  if (session.status === "complete") {
    return resultCheckoutProcessing();
  }

  // 5. All other conditions for reuse.
  if (session.status !== "open") return resultSessionInvalid();
  if (session.expires_at <= deps.clock.nowSeconds()) return resultSessionInvalid();
  if (session.customer !== canonical.customer.id) return resultSessionInvalid();

  const expectedMetadata = recruiterSessionMetadata({
    userId: input.userId,
    recruiterId: input.recruiterId,
    plan: input.plan,
    intentId,
    generation,
  });
  if (!sessionMetadataMatches(session, expectedMetadata)) {
    return resultSessionInvalid();
  }
  if (session.url == null || session.url !== storedUrl) {
    return resultSessionInvalid();
  }
  return resultReady(storedUrl);
}

// ---------------------------------------------------------------------------
// Claimed path — fresh session flow
// ---------------------------------------------------------------------------

async function handleClaimed(
  input: RecruiterCheckoutInput,
  deps: RecruiterCheckoutDeps,
  claim: IntentClaimResult,
): Promise<RecruiterCheckoutResult> {
  const intentId = claim.intent_id;
  const claimToken = claim.claim_token;
  const generation = claim.generation;

  if (!intentId || !claimToken || generation == null) {
    return resultTransient();
  }

  // Resolve customer identity.
  const canonical = await resolveOrProvisionCustomer(
    input,
    deps,
    claim.stripe_customer_id,
    intentId,
    claimToken,
  );
  if (canonical.kind !== "ok") return canonical.result;
  const customerId = canonical.customer.id;

  // Bind through A1 RPC.
  const bindCall = await safeCall(() =>
    deps.intents.bind({ intentId, claimToken, customerId }),
  );
  if (!bindCall.ok) {
    await safeFail(deps, intentId, claimToken, "bind_transient", false);
    return resultTransient();
  }
  const bind = bindCall.value;
  if (bind.outcome === "customer_conflict") {
    await safeFail(deps, intentId, claimToken, "bind_conflict", true);
    return resultCustomerConflict();
  }
  if (bind.outcome !== "bound") {
    // lease_invalid / not_found / invalid_customer — no useful retry.
    await safeFail(deps, intentId, claimToken, "bind_rejected", true);
    return resultCustomerConflict();
  }

  // Subscription guard AFTER bind so canonical customer is stable.
  const guard = await evaluateSubscriptionGuard(deps, customerId);
  if (guard.kind === "blocking") {
    await safeFail(deps, intentId, claimToken, "subscription_exists", true);
    return resultSubscriptionExists();
  }
  if (guard.kind === "unknown") {
    await safeFail(deps, intentId, claimToken, "subscription_unknown", true);
    return resultUnknownSubStatus();
  }
  if (guard.kind === "transient") {
    await safeFail(deps, intentId, claimToken, "subscription_transient", false);
    return resultTransient();
  }

  // Create the Checkout Session.
  const nowSec = deps.clock.nowSeconds();
  const expiresAt = nowSec + RECRUITER_CHECKOUT_TTL_SECONDS;
  const metadata = recruiterSessionMetadata({
    userId: input.userId,
    recruiterId: input.recruiterId,
    plan: input.plan,
    intentId,
    generation,
  });
  const idemKey = recruiterCheckoutIdempotencyKey(input.recruiterId, generation);

  const createCall = await safeCall(() =>
    deps.stripe.createSession({
      customerId,
      priceId: input.priceId,
      metadata,
      successUrl: recruiterSuccessUrl(input.origin),
      cancelUrl: recruiterCancelUrl(input.origin),
      expiresAt,
      idempotencyKey: idemKey,
    }),
  );
  if (!createCall.ok) {
    await safeFail(deps, intentId, claimToken, "session_create_transient", false);
    return resultTransient();
  }
  const session = createCall.value;
  // Full return-session identity contract. All conditions required; any
  // mismatch is terminal — the returned session must not be persisted.
  const returnedOk =
    !!session &&
    typeof session.id === "string" && session.id !== "" &&
    session.status === "open" &&
    typeof session.url === "string" && session.url.trim() !== "" &&
    session.customer === customerId &&
    typeof session.expires_at === "number" &&
    session.expires_at === expiresAt &&
    sessionMetadataMatches(session, metadata);
  if (!returnedOk) {
    await safeFail(deps, intentId, claimToken, "session_invalid_return", true);
    return resultSessionInvalid();
  }

  const completeCall = await safeCall(() =>
    deps.intents.complete({
      intentId,
      claimToken,
      customerId,
      sessionId: session.id,
      url: session.url as string,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    }),
  );
  if (!completeCall.ok || completeCall.value.outcome !== "completed") {
    // Session created in Stripe (idempotent), but DB failed to record it.
    // Preserve generation so retry reuses the same Stripe key.
    await safeFail(deps, intentId, claimToken, "complete_failed", false);
    return resultTransient();
  }

  return resultReady(session.url as string);
}

// ---------------------------------------------------------------------------
// Customer resolution
// ---------------------------------------------------------------------------

type CustomerResolveOk = { kind: "ok"; customer: StripeCustomerLike };
type CustomerResolveErr = { kind: "err"; result: RecruiterCheckoutResult };

/** For the ready-candidate path (no claim token) — canonical row is
 *  authoritative. Never falls back to the intent's stored customer. */
async function resolveCanonicalCustomer(
  input: RecruiterCheckoutInput,
  deps: RecruiterCheckoutDeps,
  storedCustomerId: string,
): Promise<CustomerResolveOk | CustomerResolveErr> {
  const canonCall = await safeCall(() =>
    deps.intents.loadCanonicalCustomer({
      recruiterId: input.recruiterId,
      userId: input.userId,
    }),
  );
  if (!canonCall.ok) return { kind: "err", result: resultTransient() };

  const canonicalId = canonCall.value.stripeCustomerId;
  // Canonical row must exist for a ready-state intent. No intent fallback.
  if (!canonicalId) {
    return { kind: "err", result: resultSupport() };
  }
  // Canonical must equal what the ready intent recorded.
  if (canonicalId !== storedCustomerId) {
    return { kind: "err", result: resultCustomerConflict() };
  }

  const custCall = await safeCall(() => deps.stripe.retrieveCustomer(canonicalId));
  if (!custCall.ok) return { kind: "err", result: resultTransient() };
  const cust = custCall.value;
  if (!cust || cust.deleted) {
    return { kind: "err", result: resultCustomerNotFound() };
  }
  if (!customerMetadataMatches(cust, input)) {
    return { kind: "err", result: resultCustomerConflict() };
  }
  return { kind: "ok", customer: cust };
}

/** For the claimed path — canonical-first, else metadata search, else create. */
async function resolveOrProvisionCustomer(
  input: RecruiterCheckoutInput,
  deps: RecruiterCheckoutDeps,
  intentCustomerId: string | null,
  intentId: string,
  claimToken: string,
): Promise<CustomerResolveOk | CustomerResolveErr> {
  const canonCall = await safeCall(() =>
    deps.intents.loadCanonicalCustomer({
      recruiterId: input.recruiterId,
      userId: input.userId,
    }),
  );
  if (!canonCall.ok) {
    await safeFail(deps, intentId, claimToken, "load_customer_transient", false);
    return { kind: "err", result: resultTransient() };
  }
  const canonicalId = canonCall.value.stripeCustomerId ?? intentCustomerId ?? null;

  // Case 1: canonical customer already stored.
  if (canonicalId) {
    const custCall = await safeCall(() => deps.stripe.retrieveCustomer(canonicalId));
    if (!custCall.ok) {
      await safeFail(deps, intentId, claimToken, "customer_retrieve_transient", false);
      return { kind: "err", result: resultTransient() };
    }
    const cust = custCall.value;
    if (!cust || cust.deleted) {
      await safeFail(deps, intentId, claimToken, "customer_missing", true);
      return { kind: "err", result: resultCustomerNotFound() };
    }
    if (!customerMetadataMatches(cust, input)) {
      await safeFail(deps, intentId, claimToken, "customer_metadata_conflict", true);
      return { kind: "err", result: resultCustomerConflict() };
    }
    return { kind: "ok", customer: cust };
  }

  // Case 2: search by exact metadata (never email).
  const searchCall = await safeCall(() =>
    deps.stripe.searchCustomersByMetadata({
      recruiterId: input.recruiterId,
      userId: input.userId,
    }),
  );
  if (!searchCall.ok) {
    await safeFail(deps, intentId, claimToken, "customer_search_transient", false);
    return { kind: "err", result: resultTransient() };
  }
  // Defense in depth: enforce the metadata contract even if the fake returned
  // extras.
  const exact = searchCall.value.filter(
    (c) => !c.deleted && customerMetadataMatches(c, input),
  );

  if (exact.length > 1) {
    await safeFail(deps, intentId, claimToken, "customer_ambiguous", true);
    return { kind: "err", result: resultCustomerAmbiguous() };
  }
  if (exact.length === 1) {
    return { kind: "ok", customer: exact[0] };
  }

  // Case 3: create a new customer with a stable idempotency key.
  const createCall = await safeCall(() =>
    deps.stripe.createCustomer({
      recruiterId: input.recruiterId,
      userId: input.userId,
      idempotencyKey: recruiterCustomerIdempotencyKey(input.recruiterId),
      metadata: recruiterCanonicalMetadata(input),
    }),
  );
  if (!createCall.ok) {
    await safeFail(deps, intentId, claimToken, "customer_create_transient", false);
    return { kind: "err", result: resultTransient() };
  }
  const created = createCall.value;
  if (
    !created ||
    created.deleted ||
    !customerMetadataMatches(created, input)
  ) {
    await safeFail(deps, intentId, claimToken, "customer_create_invalid", true);
    return { kind: "err", result: resultCustomerConflict() };
  }
  return { kind: "ok", customer: created };
}
