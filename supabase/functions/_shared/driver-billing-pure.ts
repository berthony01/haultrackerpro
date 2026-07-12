// Phase 1A — canonical driver Stripe billing identity: pure decision logic.
// No Deno, no network, no Supabase/Stripe SDK imports. This file must stay
// import-clean so it can be unit-tested directly from Vitest with zero
// runtime shims.

export const DRIVER_PLAN_PRICE_ENV: Record<string, string> = {
  pro_monthly: "STRIPE_PRO_MONTHLY_PRICE_ID",
  pro_yearly: "STRIPE_PRO_YEARLY_PRICE_ID",
};

export class DriverBillingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriverBillingConflictError";
  }
}

export interface DriverPriceConfig {
  pro_monthly?: string | null;
  pro_yearly?: string | null;
}

/** Resolve a plan key from a Stripe price ID against an explicit price
 *  config. Returns null for any price that is not a configured driver
 *  price — callers MUST NOT grant Pro for a null result. Never defaults to
 *  "pro_monthly".
 */
export function resolveDriverPlanKeyFromConfig(
  priceId: string | null | undefined,
  config: DriverPriceConfig,
): string | null {
  if (!priceId) return null;
  if (config.pro_monthly && priceId === config.pro_monthly) return "pro_monthly";
  if (config.pro_yearly && priceId === config.pro_yearly) return "pro_yearly";
  return null;
}

export function isDriverPriceIdInConfig(
  priceId: string | null | undefined,
  config: DriverPriceConfig,
): boolean {
  return resolveDriverPlanKeyFromConfig(priceId, config) !== null;
}

export function getDriverPriceAllowlistFromConfig(config: DriverPriceConfig): string[] {
  return [config.pro_monthly, config.pro_yearly].filter((v): v is string => !!v);
}

export type SubscriptionRow =
  | { stripe_customer_id?: string | null; stripe_subscription_id?: string | null }
  | null
  | undefined;

export type StripeSubscriptionLike = {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string> | null;
  items?: { data?: { price?: { id?: string | null } | null }[] };
};

export type DriverCustomerDecision =
  | { action: "use_existing"; customerId: string }
  | { action: "derive_from_subscription"; subscriptionId: string }
  | { action: "adopt_legacy_profile"; customerId: string; requiresSubscriptionValidation: string | null }
  | { action: "none_available" };

/**
 * Pure precedence decision for "which driver Stripe customer id should we
 * use", given already-fetched rows. Performs no I/O itself — callers
 * execute the indicated follow-up (e.g. retrieving a subscription from
 * Stripe, or checking cross-context tables).
 *
 * Precedence:
 *   1. subscriptions.stripe_customer_id (canonical) if present.
 *   2. subscriptions.stripe_subscription_id (canonical) with no customer id
 *      yet — derive from the live Stripe subscription.
 *   3. profiles.stripe_customer_id (legacy mirror) — only if nothing
 *      canonical exists yet.
 *   4. Nothing available.
 */
export function decideDriverCustomerResolution(
  subRow: SubscriptionRow,
  profileRow: SubscriptionRow,
): DriverCustomerDecision {
  if (subRow?.stripe_customer_id) {
    return { action: "use_existing", customerId: subRow.stripe_customer_id };
  }
  if (subRow?.stripe_subscription_id) {
    return { action: "derive_from_subscription", subscriptionId: subRow.stripe_subscription_id };
  }
  if (profileRow?.stripe_customer_id) {
    return {
      action: "adopt_legacy_profile",
      customerId: profileRow.stripe_customer_id,
      requiresSubscriptionValidation: profileRow.stripe_subscription_id ?? null,
    };
  }
  return { action: "none_available" };
}

/** Validate that a Stripe subscription is safely usable as the driver's
 *  canonical subscription: it must not be tagged recruiter/agency, and its
 *  price must be a configured driver price.
 */
export function validateDriverSubscription(
  sub: StripeSubscriptionLike,
  config: DriverPriceConfig,
): { valid: true; customerId: string; priceId: string } | { valid: false; reason: string } {
  const billingContext = sub.metadata?.billing_context;
  if (billingContext === "recruiter" || billingContext === "agency") {
    return { valid: false, reason: `subscription ${sub.id} is tagged billing_context="${billingContext}"` };
  }
  const priceId = sub.items?.data?.[0]?.price?.id ?? "";
  if (!isDriverPriceIdInConfig(priceId, config)) {
    return { valid: false, reason: `subscription ${sub.id} does not use a configured driver price` };
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return { valid: true, customerId, priceId };
}
