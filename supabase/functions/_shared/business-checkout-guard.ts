// Phase 1R-D1 — Pure cross-context business checkout guard.
//
// Runtime-neutral: NO Deno globals, NO Stripe, NO Supabase, NO React, NO
// environment reads, NO clock, NO network. Directly importable by Vitest and
// by both business checkout edge functions.
//
// Purpose: a user must never be able to hold recruiter premium billing and
// agency billing at the same time. Agency premium already includes recruiter
// premium, so an agency owner with a live agency entitlement must not start a
// second recruiter subscription, and a recruiter with a non-terminal paid
// subscription must not start agency billing.
//
// LIMITATION (explicit): this guard closes sequential overlap and normal
// retry/concurrency duplication. It does NOT provide atomic prevention of two
// truly simultaneous recruiter-versus-agency requests issued before either
// billing row exists. That database-coordination problem is reserved for
// Phase 1R-D2.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type AgencyGuardPlanKey =
  | "agency_starter"
  | "agency_team"
  | "agency_growth";

export const RECOGNIZED_AGENCY_PLAN_KEYS: readonly AgencyGuardPlanKey[] = [
  "agency_starter",
  "agency_team",
  "agency_growth",
] as const;

export type AgencyGuardSource = "stripe" | "manual" | "admin_seed";

export const RECOGNIZED_AGENCY_SOURCES: readonly AgencyGuardSource[] = [
  "stripe",
  "manual",
  "admin_seed",
] as const;

export type AgencyGuardStatus =
  | "manual_beta"
  | "trialing" // trial-allowlist: Stripe subscription status literal
  | "active"
  | "past_due"
  | "cancelled";

export const RECOGNIZED_AGENCY_STATUSES: readonly AgencyGuardStatus[] = [
  "manual_beta",
  "trialing", // trial-allowlist: Stripe subscription status literal
  "active",
  "past_due",
  "cancelled",
] as const;

export type RecruiterGuardPlan = "starter" | "growth" | "fleet";

export const RECOGNIZED_RECRUITER_PLANS: readonly RecruiterGuardPlan[] = [
  "starter",
  "growth",
  "fleet",
] as const;

/** Recruiter subscription statuses that must block agency checkout. */
export const RECRUITER_BLOCKING_STATUSES: readonly string[] = [
  "active",
  "trialing", // trial-allowlist: Stripe subscription status literal
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
] as const;

/** Recruiter subscription statuses that permit agency checkout. */
export const RECRUITER_ALLOWING_STATUSES: readonly string[] = [
  "canceled",
  "incomplete_expired",
  "inactive",
] as const;

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface AgencyEntitlementFacts {
  /** True when an agency_entitlements row exists for an agency the user owns. */
  readonly hasRow: boolean;
  readonly planKey: string | null;
  readonly status: string | null;
  readonly source: string | null;
  /** True only when the user has an ACTIVE agency_owner membership. */
  readonly hasActiveOwnerMembership: boolean;
}

export interface RecruiterBillingFacts {
  readonly hasRow: boolean;
  readonly plan: string | null;
  readonly status: string | null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type CrossContextBlockCode =
  | "agency_entitlement_exists"
  | "agency_billing_requires_management"
  | "recruiter_subscription_exists"
  | "opposing_entitlement_unknown";

export type CrossContextDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: CrossContextBlockCode;
      readonly status: number;
      readonly message: string;
    };

/** Exact, stable, safe public messages. No IDs, URLs, emails, or raw errors. */
export const CROSS_CONTEXT_MESSAGES: Record<CrossContextBlockCode, string> = {
  agency_entitlement_exists:
    "Your agency plan already includes recruiter premium. Manage billing from the agency workspace.",
  agency_billing_requires_management:
    "Your agency subscription needs billing attention. Manage it from the agency workspace before starting recruiter billing.",
  recruiter_subscription_exists:
    "You already have recruiter premium billing. Manage or end that subscription before starting agency billing.",
  opposing_entitlement_unknown:
    "We could not safely confirm your existing business billing. Please contact support.",
};

const ALLOW: CrossContextDecision = { allowed: true };

function block(code: CrossContextBlockCode): CrossContextDecision {
  return {
    allowed: false,
    code,
    status: 409,
    message: CROSS_CONTEXT_MESSAGES[code],
  };
}

// ---------------------------------------------------------------------------
// Validators (never mutate input)
// ---------------------------------------------------------------------------

export function isRecognizedAgencyPlanKey(v: unknown): v is AgencyGuardPlanKey {
  return (
    typeof v === "string" &&
    (RECOGNIZED_AGENCY_PLAN_KEYS as readonly string[]).includes(v)
  );
}

export function isRecognizedAgencySource(v: unknown): v is AgencyGuardSource {
  return (
    typeof v === "string" &&
    (RECOGNIZED_AGENCY_SOURCES as readonly string[]).includes(v)
  );
}

export function isRecognizedAgencyStatus(v: unknown): v is AgencyGuardStatus {
  return (
    typeof v === "string" &&
    (RECOGNIZED_AGENCY_STATUSES as readonly string[]).includes(v)
  );
}

export function isRecognizedRecruiterPlan(v: unknown): v is RecruiterGuardPlan {
  return (
    typeof v === "string" &&
    (RECOGNIZED_RECRUITER_PLANS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Recruiter checkout decision — "may this user start RECRUITER billing?"
// ---------------------------------------------------------------------------

export function evaluateRecruiterCheckoutCrossContext(
  facts: AgencyEntitlementFacts,
): CrossContextDecision {
  // Not an active owner, or no entitlement row at all → the agency context
  // cannot grant recruiter premium, so recruiter checkout is permitted.
  if (!facts || facts.hasActiveOwnerMembership !== true) return ALLOW;
  if (facts.hasRow !== true) return ALLOW;

  // The row is relevant. Every field must be recognized or we fail closed.
  if (
    !isRecognizedAgencyPlanKey(facts.planKey) ||
    !isRecognizedAgencySource(facts.source) ||
    !isRecognizedAgencyStatus(facts.status)
  ) {
    return block("opposing_entitlement_unknown");
  }

  const status = facts.status;

  // Live agency premium (any recognized source) already includes recruiter
  // premium — never let the user pay twice.
  if (status === "active" || status === "trialing") {
    // trial-allowlist: Stripe subscription status literal
    return block("agency_entitlement_exists");
  }

  // A failing agency subscription must be resolved in the agency workspace
  // rather than routed around by opening recruiter billing.
  if (status === "past_due") {
    return block("agency_billing_requires_management");
  }

  // manual_beta and cancelled confer no live agency premium.
  return ALLOW;
}

// ---------------------------------------------------------------------------
// Agency checkout decision — "may this user start AGENCY billing?"
// ---------------------------------------------------------------------------

export function evaluateAgencyCheckoutCrossContext(
  facts: RecruiterBillingFacts,
): CrossContextDecision {
  if (!facts || facts.hasRow !== true) return ALLOW;

  const status = facts.status;
  if (typeof status !== "string" || status === "") {
    return block("opposing_entitlement_unknown");
  }

  // Terminal / absent billing states permit agency checkout regardless of the
  // plan value recorded on the dead row.
  if ((RECRUITER_ALLOWING_STATUSES as readonly string[]).includes(status)) {
    return ALLOW;
  }

  // Any status outside the closed policy sets fails closed.
  if (!(RECRUITER_BLOCKING_STATUSES as readonly string[]).includes(status)) {
    return block("opposing_entitlement_unknown");
  }

  // Blocking status: the plan must be a recognized paid recruiter plan,
  // otherwise the row is malformed and we cannot safely reason about it.
  if (!isRecognizedRecruiterPlan(facts.plan)) {
    return block("opposing_entitlement_unknown");
  }

  return block("recruiter_subscription_exists");
}
