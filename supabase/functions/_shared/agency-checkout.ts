// Phase 1R-D1 — Runtime-neutral Agency Checkout orchestrator.
//
// This module has NO Deno globals, NO URL imports, NO Stripe SDK imports, NO
// Supabase imports, NO environment reads, NO React, and NO timers. It is
// directly importable by Vitest. All I/O flows through injected interfaces.
//
// Public errors NEVER leak Stripe IDs, URLs, emails, tokens, stacks, or raw
// dependency messages.

import {
  evaluateAgencyCheckoutCrossContext,
  type CrossContextDecision,
  type RecruiterBillingFacts,
} from "./business-checkout-guard.ts";

export {
  evaluateAgencyCheckoutCrossContext,
  type CrossContextDecision,
  type RecruiterBillingFacts,
};

// ---------------------------------------------------------------------------
// Plan vocabulary
// ---------------------------------------------------------------------------

export type AgencyPlanKey =
  | "agency_starter"
  | "agency_team"
  | "agency_growth";

export const AGENCY_PLAN_KEYS: readonly AgencyPlanKey[] = [
  "agency_starter",
  "agency_team",
  "agency_growth",
] as const;

export function isAgencyPlanKey(v: unknown): v is AgencyPlanKey {
  return (
    typeof v === "string" && (AGENCY_PLAN_KEYS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Public result surface
// ---------------------------------------------------------------------------

export type AgencyCheckoutPublicCode =
  | "checkout_ready"
  | "in_progress"
  | "checkout_processing"
  | "not_owner"
  | "not_eligible"
  | "invalid_plan"
  | "invalid_origin"
  | "invalid_price"
  | "recruiter_subscription_exists"
  | "opposing_entitlement_unknown"
  | "customer_conflict"
  | "customer_not_found"
  | "customer_ambiguous"
  | "subscription_exists"
  | "unknown_subscription_status"
  | "session_invalid"
  | "transient_error"
  | "support_required"
  | "internal_error";

export interface AgencyCheckoutResult {
  status: number;
  code: AgencyCheckoutPublicCode;
  message: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Dependency interfaces (narrow)
// ---------------------------------------------------------------------------

export interface AgencyCustomerLike {
  id: string;
  deleted?: boolean;
  metadata: Record<string, string>;
}

export interface AgencySubscriptionLike {
  id: string;
  status: string;
}

export interface AgencySessionLike {
  id: string;
  status: string; // "open" | "complete" | "expired" | other
  url: string | null;
  customer: string | null;
  expires_at: number; // epoch seconds
  metadata: Record<string, string>;
}

export interface AgencyEntitlementStore {
  loadCustomerId(input: {
    agencyId: string;
  }): Promise<{ stripeCustomerId: string | null }>;
  saveCustomerId(input: {
    agencyId: string;
    customerId: string;
  }): Promise<void>;
}

export interface AgencyStripeGateway {
  retrieveCustomer(id: string): Promise<AgencyCustomerLike | null>;
  searchCustomersByMetadata(q: {
    agencyId: string;
    ownerUserId: string;
  }): Promise<AgencyCustomerLike[]>;
  createCustomer(input: {
    agencyId: string;
    ownerUserId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<AgencyCustomerLike>;
  listAllSubscriptions(customerId: string): Promise<AgencySubscriptionLike[]>;
  listAllSessions(customerId: string): Promise<AgencySessionLike[]>;
  createSession(input: {
    customerId: string;
    priceId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
    idempotencyKey: string;
  }): Promise<AgencySessionLike>;
}

export interface AgencyClock {
  nowSeconds(): number;
}

export interface AgencyCheckoutDeps {
  store: AgencyEntitlementStore;
  stripe: AgencyStripeGateway;
  clock: AgencyClock;
}

export interface AgencyCheckoutInput {
  agencyId: string;
  ownerUserId: string;
  planKey: AgencyPlanKey;
  priceId: string;
  origin: string;
  /** Pre-evaluated opposing-context decision from the edge adapter. */
  crossContext?: CrossContextDecision;
}

// ---------------------------------------------------------------------------
// Policy tables
// ---------------------------------------------------------------------------

export const AGENCY_BLOCKING_SUBSCRIPTION_STATUSES: ReadonlySet<string> =
  new Set([
    "active",
    "trialing", // trial-allowlist: Stripe subscription status literal
    "past_due",
    "unpaid",
    "incomplete",
    "paused",
  ]);

export const AGENCY_TERMINAL_SUBSCRIPTION_STATUSES: ReadonlySet<string> =
  new Set(["canceled", "incomplete_expired"]);

// 30 minutes: within Stripe's allowed Checkout expiration bounds.
export const AGENCY_CHECKOUT_TTL_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// Metadata contract
// ---------------------------------------------------------------------------

/** Customer-level identity metadata (plan independent). */
export function agencyCanonicalMetadata(input: {
  agencyId: string;
  ownerUserId: string;
}): Record<string, string> {
  return {
    billing_context: "agency",
    billing_type: "agency",
    agency_id: input.agencyId,
    owner_user_id: input.ownerUserId,
  };
}

/** Session + subscription metadata (adds the plan). */
export function agencySessionMetadata(input: {
  agencyId: string;
  ownerUserId: string;
  planKey: AgencyPlanKey;
}): Record<string, string> {
  return {
    ...agencyCanonicalMetadata(input),
    plan_key: input.planKey,
  };
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

export function agencyCustomerIdempotencyKey(agencyId: string): string {
  return `htp:agency:customer:${agencyId}`;
}

export function agencyCheckoutBucket(nowSeconds: number): number {
  return Math.floor(nowSeconds / AGENCY_CHECKOUT_TTL_SECONDS);
}

export function agencyCheckoutIdempotencyKey(
  agencyId: string,
  planKey: AgencyPlanKey,
  nowSeconds: number,
): string {
  return `htp:agency:checkout:${agencyId}:${planKey}:${agencyCheckoutBucket(
    nowSeconds,
  )}`;
}

// ---------------------------------------------------------------------------
// Origins + URLs
// ---------------------------------------------------------------------------

export const AGENCY_ALLOWED_ORIGINS: readonly string[] = [
  "https://haultrackerpro.com",
  "https://www.haultrackerpro.com",
  "https://haultrackerpro.lovable.app",
];

export function isAllowedAgencyOrigin(origin: unknown): origin is string {
  return typeof origin === "string" && AGENCY_ALLOWED_ORIGINS.includes(origin);
}

export function agencySuccessUrl(origin: string): string {
  return `${origin}/agency?billing=success`;
}
export function agencyCancelUrl(origin: string): string {
  return `${origin}/agency?billing=cancelled`;
}

/** Exact-host validator for a returned Stripe Checkout URL. */
export function isSafeAgencyCheckoutUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  const m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(raw);
  if (!m) return false;
  return m[1].toLowerCase() === "checkout.stripe.com";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function customerMetadataMatches(
  customer: AgencyCustomerLike,
  input: { agencyId: string; ownerUserId: string },
): boolean {
  const m = customer?.metadata;
  if (!m) return false;
  return (
    m["billing_context"] === "agency" &&
    m["billing_type"] === "agency" &&
    m["agency_id"] === input.agencyId &&
    m["owner_user_id"] === input.ownerUserId
  );
}

function sessionMetadataMatches(
  session: AgencySessionLike,
  expected: Record<string, string>,
): boolean {
  for (const [k, v] of Object.entries(expected)) {
    if (session.metadata?.[k] !== v) return false;
  }
  return true;
}

async function safeCall<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Result constructors — safe, stable, dependency-free messages
// ---------------------------------------------------------------------------

function r(
  status: number,
  code: AgencyCheckoutPublicCode,
  message: string,
  url?: string,
): AgencyCheckoutResult {
  return url ? { status, code, message, url } : { status, code, message };
}

const resultReady = (url: string) =>
  r(200, "checkout_ready", "Checkout session ready.", url);
const resultCheckoutProcessing = () =>
  r(409, "checkout_processing", "Checkout is finalizing. Try again shortly.");
const resultSubscriptionExists = () =>
  r(
    409,
    "subscription_exists",
    "This agency already has an active subscription.",
  );
const resultUnknownSubStatus = () =>
  r(
    409,
    "unknown_subscription_status",
    "Subscription in an unrecognized state. Contact support.",
  );
const resultCustomerConflict = () =>
  r(409, "customer_conflict", "Billing identity conflict. Contact support.");
const resultCustomerNotFound = () =>
  r(409, "customer_not_found", "Billing profile is out of date. Contact support.");
const resultCustomerAmbiguous = () =>
  r(409, "customer_ambiguous", "Multiple billing profiles found. Contact support.");
const resultSessionInvalid = () =>
  r(
    409,
    "session_invalid",
    "Existing checkout is no longer valid. Try again shortly.",
  );
const resultTransient = () =>
  r(503, "transient_error", "Temporary billing error. Please try again.");
const resultSupport = () =>
  r(409, "support_required", "Billing requires support intervention.");
const resultInvalidPlan = () => r(400, "invalid_plan", "Unknown agency plan.");
const resultInvalidPrice = () =>
  r(400, "invalid_price", "Plan price is not configured.");
const resultInvalidOrigin = () =>
  r(400, "invalid_origin", "Request origin is not permitted.");
const resultNotOwner = () =>
  r(403, "not_owner", "Only the agency owner can manage billing.");

function resultFromCrossContext(
  decision: CrossContextDecision,
): AgencyCheckoutResult | null {
  if (decision.allowed) return null;
  if (decision.code === "recruiter_subscription_exists") {
    return r(decision.status, "recruiter_subscription_exists", decision.message);
  }
  // Any other opposing-context block is surfaced as the fail-closed code.
  return r(decision.status, "opposing_entitlement_unknown", decision.message);
}

// ---------------------------------------------------------------------------
// Subscription guard
// ---------------------------------------------------------------------------

export type AgencySubscriptionGuardOutcome =
  | { kind: "ok" }
  | { kind: "blocking" }
  | { kind: "unknown" }
  | { kind: "transient" };

export async function evaluateAgencySubscriptionGuard(
  deps: AgencyCheckoutDeps,
  customerId: string,
): Promise<AgencySubscriptionGuardOutcome> {
  const call = await safeCall(() => deps.stripe.listAllSubscriptions(customerId));
  if (!call.ok) return { kind: "transient" };
  for (const sub of call.value) {
    const s = sub?.status;
    if (typeof s !== "string") return { kind: "unknown" };
    if (AGENCY_BLOCKING_SUBSCRIPTION_STATUSES.has(s)) return { kind: "blocking" };
    if (AGENCY_TERMINAL_SUBSCRIPTION_STATUSES.has(s)) continue;
    return { kind: "unknown" };
  }
  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// Customer resolution
// ---------------------------------------------------------------------------

type CustomerOk = { kind: "ok"; customer: AgencyCustomerLike };
type CustomerErr = { kind: "err"; result: AgencyCheckoutResult };

async function resolveOrProvisionCustomer(
  input: AgencyCheckoutInput,
  deps: AgencyCheckoutDeps,
): Promise<CustomerOk | CustomerErr> {
  const loadCall = await safeCall(() =>
    deps.store.loadCustomerId({ agencyId: input.agencyId }),
  );
  if (!loadCall.ok) return { kind: "err", result: resultTransient() };

  const canonicalId = loadCall.value?.stripeCustomerId ?? null;

  // Case 1 — canonical customer already stored. It is authoritative and is
  // never silently replaced.
  if (canonicalId) {
    const cust = await safeCall(() => deps.stripe.retrieveCustomer(canonicalId));
    if (!cust.ok) return { kind: "err", result: resultTransient() };
    const c = cust.value;
    if (!c || c.deleted) {
      return { kind: "err", result: resultCustomerNotFound() };
    }
    if (!customerMetadataMatches(c, input)) {
      return { kind: "err", result: resultCustomerConflict() };
    }
    return { kind: "ok", customer: c };
  }

  // Case 2 — exact metadata search. Never email.
  const search = await safeCall(() =>
    deps.stripe.searchCustomersByMetadata({
      agencyId: input.agencyId,
      ownerUserId: input.ownerUserId,
    }),
  );
  if (!search.ok) return { kind: "err", result: resultTransient() };

  const exact = (search.value ?? []).filter(
    (c) => !!c && !c.deleted && customerMetadataMatches(c, input),
  );
  if (exact.length > 1) {
    return { kind: "err", result: resultCustomerAmbiguous() };
  }
  if (exact.length === 1) {
    const persisted = await persistCustomer(deps, input.agencyId, exact[0].id);
    if (persisted) return { kind: "err", result: persisted };
    return { kind: "ok", customer: exact[0] };
  }

  // Case 3 — create with a stable idempotency key.
  const created = await safeCall(() =>
    deps.stripe.createCustomer({
      agencyId: input.agencyId,
      ownerUserId: input.ownerUserId,
      idempotencyKey: agencyCustomerIdempotencyKey(input.agencyId),
      metadata: agencyCanonicalMetadata(input),
    }),
  );
  if (!created.ok) return { kind: "err", result: resultTransient() };
  const c = created.value;
  if (
    !c ||
    typeof c.id !== "string" ||
    c.id === "" ||
    c.deleted ||
    !customerMetadataMatches(c, input)
  ) {
    return { kind: "err", result: resultCustomerConflict() };
  }
  const persisted = await persistCustomer(deps, input.agencyId, c.id);
  if (persisted) return { kind: "err", result: persisted };
  return { kind: "ok", customer: c };
}

/** Returns a safe transient result on failure, or null on success. */
async function persistCustomer(
  deps: AgencyCheckoutDeps,
  agencyId: string,
  customerId: string,
): Promise<AgencyCheckoutResult | null> {
  const save = await safeCall(() =>
    deps.store.saveCustomerId({ agencyId, customerId }),
  );
  return save.ok ? null : resultTransient();
}

// ---------------------------------------------------------------------------
// Open-session reuse
// ---------------------------------------------------------------------------

type SessionScan =
  | { kind: "reuse"; url: string }
  | { kind: "processing" }
  | { kind: "none" }
  | { kind: "support" }
  | { kind: "invalid" }
  | { kind: "transient" };

async function scanExistingSessions(
  input: AgencyCheckoutInput,
  deps: AgencyCheckoutDeps,
  customerId: string,
): Promise<SessionScan> {
  const list = await safeCall(() => deps.stripe.listAllSessions(customerId));
  if (!list.ok) return { kind: "transient" };

  const expected = agencySessionMetadata(input);
  const now = deps.clock.nowSeconds();

  const exact = (list.value ?? []).filter(
    (s) => !!s && sessionMetadataMatches(s, expected),
  );

  const openValid: AgencySessionLike[] = [];
  let sawComplete = false;

  for (const s of exact) {
    const status = typeof s.status === "string" ? s.status : "";
    if (status === "complete") {
      sawComplete = true;
      continue;
    }
    if (status === "expired") continue;
    if (status !== "open") {
      // Unknown / malformed exact session state fails closed.
      return { kind: "invalid" };
    }
    // Open session: it must be fully well-formed to be considered at all.
    if (typeof s.expires_at !== "number" || s.expires_at <= 0) {
      return { kind: "invalid" };
    }
    if (s.customer !== customerId) return { kind: "invalid" };
    if (s.expires_at <= now) continue; // expired in practice — ignore
    if (!isSafeAgencyCheckoutUrl(s.url)) return { kind: "invalid" };
    openValid.push(s);
  }

  if (openValid.length > 1) return { kind: "support" };
  if (openValid.length === 1) {
    return { kind: "reuse", url: openValid[0].url as string };
  }
  if (sawComplete) return { kind: "processing" };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runAgencyCheckout(
  input: AgencyCheckoutInput,
  deps: AgencyCheckoutDeps,
): Promise<AgencyCheckoutResult> {
  // 0. Cross-context guard first — zero dependency work when blocked.
  if (input.crossContext) {
    const blocked = resultFromCrossContext(input.crossContext);
    if (blocked) return blocked;
  }

  // 1. Static validation before any dependency call.
  if (!input.agencyId || !input.ownerUserId) return resultNotOwner();
  if (!isAgencyPlanKey(input.planKey)) return resultInvalidPlan();
  if (typeof input.priceId !== "string" || input.priceId.trim() === "") {
    return resultInvalidPrice();
  }
  if (!isAllowedAgencyOrigin(input.origin)) return resultInvalidOrigin();

  // 2. Canonical customer identity.
  const customer = await resolveOrProvisionCustomer(input, deps);
  if (customer.kind !== "ok") return customer.result;
  const customerId = customer.customer.id;

  // 3. Same-context subscription guard.
  const guard = await evaluateAgencySubscriptionGuard(deps, customerId);
  if (guard.kind === "blocking") return resultSubscriptionExists();
  if (guard.kind === "unknown") return resultUnknownSubStatus();
  if (guard.kind === "transient") return resultTransient();

  // 4. Reuse an existing open Checkout Session when exactly one is valid.
  const scan = await scanExistingSessions(input, deps, customerId);
  if (scan.kind === "transient") return resultTransient();
  if (scan.kind === "support") return resultSupport();
  if (scan.kind === "invalid") return resultSessionInvalid();
  if (scan.kind === "processing") return resultCheckoutProcessing();
  if (scan.kind === "reuse") return resultReady(scan.url);

  // 5. Create a new session with a deterministic idempotency key.
  const nowSec = deps.clock.nowSeconds();
  const expiresAt = nowSec + AGENCY_CHECKOUT_TTL_SECONDS;
  const metadata = agencySessionMetadata(input);
  const idempotencyKey = agencyCheckoutIdempotencyKey(
    input.agencyId,
    input.planKey,
    nowSec,
  );

  const createCall = await safeCall(() =>
    deps.stripe.createSession({
      customerId,
      priceId: input.priceId,
      metadata,
      successUrl: agencySuccessUrl(input.origin),
      cancelUrl: agencyCancelUrl(input.origin),
      expiresAt,
      idempotencyKey,
    }),
  );
  if (!createCall.ok) return resultTransient();

  const session = createCall.value;
  const returnedOk =
    !!session &&
    typeof session.id === "string" &&
    session.id !== "" &&
    session.status === "open" &&
    isSafeAgencyCheckoutUrl(session.url) &&
    session.customer === customerId &&
    typeof session.expires_at === "number" &&
    session.expires_at === expiresAt &&
    sessionMetadataMatches(session, metadata);
  if (!returnedOk) return resultSessionInvalid();

  return resultReady(session.url as string);
}
