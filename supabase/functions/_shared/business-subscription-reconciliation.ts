// Phase 1R-D2-B4 — Webhook-side opposing-business reconciliation guard.
//
// Runtime-neutral by contract: no Deno globals, no Supabase client, no Stripe
// SDK, no URL imports, no environment access, no timers, no Date.now(), no
// fetch, no React, no storage. Every read flows through an injected gateway,
// so this module is directly importable and executable under Vitest.
//
// Purpose (defense in depth):
//   The Phase 1R-D2-B3 checkout claim is the checkout-time concurrency
//   authority. It cannot, however, see legacy subscriptions, stale Stripe
//   sessions, or separately keyed Stripe customers that never passed through
//   our checkout edges. This module runs on the webhook side, immediately
//   before any NON-TERMINAL recruiter/agency entitlement mutation, and
//   fails closed when an opposing paid business context already exists.
//
// Invariants:
//   - A user may hold at most ONE live paid business subscription context:
//     recruiter OR agency.
//   - Agency billing stays canonical in agency_entitlements; an agency plan is
//     NEVER mirrored into recruiter_billing_profiles. Included recruiter
//     access is derived by the effective-business-entitlement resolver.
//   - Terminal revocation is ALWAYS allowed. A guard must never be able to
//     strand a paid entitlement in an active state.
//   - Driver billing is untouched by this guard.
//   - Raw gateway/database error text is never surfaced.

import type { BillingContext } from "./stripe-webhook-identity.ts";
import { TERMINAL_STATUSES } from "./stripe-webhook-identity.ts";

/** Recruiter billing row, narrowed to only the fields this guard may read. */
export interface RecruiterBillingRowShape {
  recruiter_id: string | null;
  plan: string | null;
  status: string | null;
}

/** Agency entitlement row, narrowed to only the fields this guard may read. */
export interface AgencyEntitlementRowShape {
  agency_id: string | null;
  plan_key: string | null;
  status: string | null;
  source: string | null;
}

/**
 * All database access used by the reconciliation guard. Implemented in the
 * webhook edge with service-role READ-ONLY selects; implemented in tests with
 * a pure in-memory harness.
 */
export interface BusinessReconciliationGateway {
  /**
   * Resolve the canonical owning user for a business entity from database
   * relationships only — never from Stripe metadata.
   *   recruiter: recruiter_profiles.id -> recruiter_profiles.user_id
   *   agency:    agency_profiles.id -> owner_user_id, AND that same user must
   *              hold an active agency_members row with role agency_owner
   *   driver:    may return null; driver bypasses this business-only guard
   */
  resolveOwnerUserId(context: BillingContext, entityKey: string): Promise<string | null>;

  /** Every recruiter_billing_profiles row for the owner user. */
  loadRecruiterBillingRows(ownerUserId: string): Promise<RecruiterBillingRowShape[]>;

  /**
   * Every agency entitlement belonging to an agency for which this exact user
   * is BOTH agency_profiles.owner_user_id AND an active agency_owner member.
   */
  loadOwnedAgencyEntitlementRows(ownerUserId: string): Promise<AgencyEntitlementRowShape[]>;
}

export interface BusinessReconciliationInput {
  context: BillingContext;
  entityKey: string;
  eventType: string;
  incomingStatus: string | null;
  gateway: BusinessReconciliationGateway;
}

export type BusinessReconciliationRejectReason =
  | "business_owner_unresolved"
  | "opposing_business_subscription_active"
  | "opposing_business_state_unknown";

export type BusinessReconciliationDecision =
  | { kind: "allow" }
  | { kind: "reject"; reason: BusinessReconciliationRejectReason };

const ALLOW: BusinessReconciliationDecision = { kind: "allow" };

/** Incoming Stripe statuses that can maintain a live paid billing obligation.
 *  Anything else non-terminal is mapped by the existing writer to no premium
 *  (or a cancelled state), so it needs no opposing-context guard. */
const BILLING_MAINTAINING_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing", // trial-allowlist: Stripe subscription status literal, not user-facing copy
  "past_due",
]);

// -- Agency-side (opposing rows examined when the INCOMING event is recruiter) --

const RECOGNIZED_AGENCY_PLAN_KEYS: ReadonlySet<string> = new Set([
  "agency_starter",
  "agency_team",
  "agency_growth",
]);

const RECOGNIZED_AGENCY_SOURCES: ReadonlySet<string> = new Set([
  "stripe",
  "manual",
  "admin_seed",
]);

const RECOGNIZED_AGENCY_STATUSES: ReadonlySet<string> = new Set([
  "manual_beta",
  "trialing", // trial-allowlist: Stripe subscription status literal, not user-facing copy
  "active",
  "past_due",
  "cancelled",
]);

const BLOCKING_AGENCY_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing", // trial-allowlist: Stripe subscription status literal, not user-facing copy
]);

// -- Recruiter-side (opposing rows examined when the INCOMING event is agency) --

const RECOGNIZED_PAID_RECRUITER_PLANS: ReadonlySet<string> = new Set([
  "starter",
  "growth",
  "fleet",
]);

/** Recruiter statuses that carry no live billing obligation. A well-formed row
 *  in one of these does not block. */
const NON_BILLING_RECRUITER_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
  "inactive",
]);

/** Recruiter statuses that represent a live or recoverable paid obligation. */
const BLOCKING_RECRUITER_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing", // trial-allowlist: Stripe subscription status literal, not user-facing copy
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Per-row verdict. Combined setwise with deterministic precedence:
 *  unknown beats active, active beats allow. */
type RowVerdict = "allow" | "active" | "unknown";

function worst(a: RowVerdict, b: RowVerdict): RowVerdict {
  if (a === "unknown" || b === "unknown") return "unknown";
  if (a === "active" || b === "active") return "active";
  return "allow";
}

/** Evaluate one owned agency entitlement row as an opposing context. */
function evaluateAgencyRow(row: unknown): RowVerdict {
  if (!isPlainRow(row)) return "unknown";

  const planKey = row.plan_key;
  const source = row.source;
  const status = row.status;

  if (!isNonEmptyString(planKey) || !RECOGNIZED_AGENCY_PLAN_KEYS.has(planKey)) return "unknown";
  if (!isNonEmptyString(source) || !RECOGNIZED_AGENCY_SOURCES.has(source)) return "unknown";
  if (!isNonEmptyString(status) || !RECOGNIZED_AGENCY_STATUSES.has(status)) return "unknown";

  if (BLOCKING_AGENCY_STATUSES.has(status)) return "active";

  if (status === "past_due") {
    // A Stripe-owned past_due agency plan is still a live billing obligation.
    // A past_due row from any other source is not something this guard can
    // reason about safely, so it fails closed as unknown.
    return source === "stripe" ? "active" : "unknown";
  }

  // manual_beta and cancelled never block.
  return "allow";
}

/** Evaluate one recruiter billing row as an opposing context. */
function evaluateRecruiterRow(row: unknown): RowVerdict {
  if (!isPlainRow(row)) return "unknown";

  const plan = row.plan;
  const status = row.status;

  if (!isNonEmptyString(status)) return "unknown";

  // Phase 1R-D2-B4-R2 — `none` is the canonical NON-PAID recruiter plan. The
  // webhook revoke writer sets recruiter_billing_profiles.plan = "none" together
  // with a terminal status, and the Phase 1R-D2-B2 checkout state machine allows
  // agency checkout after that terminal recruiter state. A revoked row must
  // therefore stay benign, or a paid agency checkout would succeed and then be
  // rejected at webhook activation. A non-paid plan paired with a live or
  // recoverable status is contradictory, so it fails closed as unknown.
  if (plan === "none") {
    return NON_BILLING_RECRUITER_STATUSES.has(status) ? "allow" : "unknown";
  }

  // Only starter/growth/fleet are recognized recruiter PAID plans. Every other
  // value — null, empty, or anything unrecognized such as `enterprise` — is
  // unknown and fails closed, regardless of status.
  if (!isNonEmptyString(plan) || !RECOGNIZED_PAID_RECRUITER_PLANS.has(plan)) {
    return "unknown";
  }

  if (BLOCKING_RECRUITER_STATUSES.has(status)) return "active";
  if (NON_BILLING_RECRUITER_STATUSES.has(status)) return "allow";

  return "unknown";
}

/**
 * Decide whether a non-terminal recruiter/agency entitlement mutation may
 * proceed, given the opposing business context already recorded in our own
 * database. Pure and deterministic apart from the injected gateway; never
 * mutates its input.
 */
export async function reconcileBusinessSubscriptionActivation(
  input: BusinessReconciliationInput,
): Promise<BusinessReconciliationDecision> {
  const context = input.context;
  const entityKey = input.entityKey;
  const eventType = input.eventType;
  const incomingStatus = input.incomingStatus;
  const gateway = input.gateway;

  // Rule 1 — driver billing is out of scope for this business-only guard.
  if (context === "driver") return { ...ALLOW };

  // Rule 2 — revocation is never blocked, and reads no opposing rows.
  const isTerminal =
    eventType === "customer.subscription.deleted" ||
    (typeof incomingStatus === "string" && TERMINAL_STATUSES.has(incomingStatus));
  if (isTerminal) return { ...ALLOW };

  // Rule 4 — only statuses that can maintain a paid obligation are guarded.
  // Every other non-terminal status is already mapped by the existing writer
  // to no premium; broadening here would change writer semantics.
  if (typeof incomingStatus !== "string" || !BILLING_MAINTAINING_STATUSES.has(incomingStatus)) {
    return { ...ALLOW };
  }

  // Rule 3 — canonical owner must come from database relationships.
  let ownerUserId: string | null;
  try {
    ownerUserId = await gateway.resolveOwnerUserId(context, entityKey);
  } catch {
    // Rule 8 — never expose raw gateway/database error text.
    return { kind: "reject", reason: "opposing_business_state_unknown" };
  }
  if (!isNonEmptyString(ownerUserId)) {
    return { kind: "reject", reason: "business_owner_unresolved" };
  }

  let verdict: RowVerdict = "allow";

  if (context === "recruiter") {
    let rows: AgencyEntitlementRowShape[];
    try {
      rows = await gateway.loadOwnedAgencyEntitlementRows(ownerUserId);
    } catch {
      return { kind: "reject", reason: "opposing_business_state_unknown" };
    }
    if (!Array.isArray(rows)) return { kind: "reject", reason: "opposing_business_state_unknown" };
    for (const row of rows) verdict = worst(verdict, evaluateAgencyRow(row));
  } else {
    let rows: RecruiterBillingRowShape[];
    try {
      rows = await gateway.loadRecruiterBillingRows(ownerUserId);
    } catch {
      return { kind: "reject", reason: "opposing_business_state_unknown" };
    }
    if (!Array.isArray(rows)) return { kind: "reject", reason: "opposing_business_state_unknown" };
    for (const row of rows) verdict = worst(verdict, evaluateRecruiterRow(row));
  }

  // Rule 7 — deterministic setwise precedence: unknown > active > allow.
  if (verdict === "unknown") return { kind: "reject", reason: "opposing_business_state_unknown" };
  if (verdict === "active") return { kind: "reject", reason: "opposing_business_subscription_active" };
  return { ...ALLOW };
}
