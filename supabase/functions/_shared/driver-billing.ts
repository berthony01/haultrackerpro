// Phase 1A — canonical driver Stripe billing identity: Deno-environment
// orchestration built on top of ./driver-billing-pure.ts.
//
// subscriptions.stripe_customer_id / stripe_subscription_id are the
// canonical driver billing identifiers. profiles.stripe_customer_id /
// stripe_subscription_id are backward-compatibility mirrors ONLY and must
// never be treated as authoritative. Never look up a driver's Stripe
// customer by email.
import {
  DRIVER_PLAN_PRICE_ENV,
  DriverBillingConflictError,
  type DriverPriceConfig,
  resolveDriverPlanKeyFromConfig,
  isDriverPriceIdInConfig,
  getDriverPriceAllowlistFromConfig,
  decideDriverCustomerResolution,
  validateDriverSubscription,
  type StripeSubscriptionLike,
} from "./driver-billing-pure.ts";

export {
  DRIVER_PLAN_PRICE_ENV,
  DriverBillingConflictError,
  decideDriverCustomerResolution,
  validateDriverSubscription,
};
export type { DriverPriceConfig, StripeSubscriptionLike };

/** Minimal structural shape of the Stripe client methods this module
 *  actually calls. Deliberately not importing the full Stripe SDK type here
 *  (even as a type-only import) -- some module-graph resolvers attempt to
 *  resolve type-only URL imports anyway, which breaks importing this file
 *  under Vitest/Node. The real edge functions still construct a real
 *  `new Stripe(...)` client and pass it in; that is structurally compatible
 *  with this interface. */
export interface StripeClientLike {
  customers: {
    create(params: { email: string; metadata?: Record<string, string> }): Promise<{ id: string }>;
    update(id: string, params: { metadata?: Record<string, string> }): Promise<unknown>;
    del(id: string): Promise<unknown>;
  };
  subscriptions: {
    retrieve(id: string): Promise<any>;
  };
}

function readDriverPriceConfig(): DriverPriceConfig {
  return {
    pro_monthly: Deno.env.get(DRIVER_PLAN_PRICE_ENV.pro_monthly),
    pro_yearly: Deno.env.get(DRIVER_PLAN_PRICE_ENV.pro_yearly),
  };
}

export function resolveDriverPlanKey(priceId: string | null | undefined): string | null {
  return resolveDriverPlanKeyFromConfig(priceId, readDriverPriceConfig());
}

export function isDriverPriceId(priceId: string | null | undefined): boolean {
  return isDriverPriceIdInConfig(priceId, readDriverPriceConfig());
}

export function getDriverPriceAllowlist(): string[] {
  return getDriverPriceAllowlistFromConfig(readDriverPriceConfig());
}

async function isCustomerUsedByOtherContext(supabaseService: any, customerId: string): Promise<boolean> {
  const [{ data: recruiterRow }, { data: agencyRow }] = await Promise.all([
    supabaseService.from("recruiter_billing_profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle(),
    supabaseService.from("agency_entitlements").select("id").eq("stripe_customer_id", customerId).maybeSingle(),
  ]);
  return !!recruiterRow || !!agencyRow;
}

async function persistDriverCustomerId(supabaseService: any, userId: string, customerId: string) {
  const { error } = await supabaseService
    .from("subscriptions")
    .upsert({ user_id: userId, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`Failed to persist canonical driver customer id: ${error.message}`);
  await supabaseService.from("profiles").update({ stripe_customer_id: customerId }).eq("user_id", userId);
}

export async function resolveDriverStripeCustomerId(
  supabaseService: any,
  stripe: StripeClientLike,
  userId: string,
): Promise<string | null> {
  const { data: subRow } = await supabaseService
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: profileRow } = await supabaseService
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  const decision = decideDriverCustomerResolution(subRow, profileRow);
  const config = readDriverPriceConfig();

  if (decision.action === "use_existing") {
    if (await isCustomerUsedByOtherContext(supabaseService, decision.customerId)) {
      throw new DriverBillingConflictError(
        `Stored driver Stripe customer ${decision.customerId} is also present in a recruiter or agency billing context.`,
      );
    }
    return decision.customerId;
  }

  if (decision.action === "derive_from_subscription") {
    const sub = await stripe.subscriptions.retrieve(decision.subscriptionId);
    const validated = validateDriverSubscription(sub as unknown as StripeSubscriptionLike, config);
    if (!validated.valid) {
      throw new DriverBillingConflictError(validated.reason);
    }
    if (await isCustomerUsedByOtherContext(supabaseService, validated.customerId)) {
      throw new DriverBillingConflictError(
        `Derived driver Stripe customer ${validated.customerId} is also present in a recruiter or agency billing context.`,
      );
    }
    await persistDriverCustomerId(supabaseService, userId, validated.customerId);
    return validated.customerId;
  }

  if (decision.action === "adopt_legacy_profile") {
    if (await isCustomerUsedByOtherContext(supabaseService, decision.customerId)) {
      throw new DriverBillingConflictError(
        `Legacy profiles.stripe_customer_id ${decision.customerId} is also present in a recruiter or agency billing context.`,
      );
    }
    if (decision.requiresSubscriptionValidation) {
      const sub = await stripe.subscriptions.retrieve(decision.requiresSubscriptionValidation);
      const validated = validateDriverSubscription(sub as unknown as StripeSubscriptionLike, config);
      if (!validated.valid) {
        throw new DriverBillingConflictError(validated.reason);
      }
    }
    await persistDriverCustomerId(supabaseService, userId, decision.customerId);
    return decision.customerId;
  }

  return null;
}

async function safelyArchiveUnusedCustomer(stripe: StripeClientLike, customerId: string) {
  try {
    await stripe.customers.update(customerId, { metadata: { billing_context: "driver_unused_duplicate" } });
    await stripe.customers.del(customerId);
  } catch (_e) {
    // Best-effort compensation only; never let cleanup failure surface.
  }
}

export async function resolveOrCreateDriverStripeCustomerId(
  supabaseService: any,
  stripe: StripeClientLike,
  userId: string,
  userEmail: string,
): Promise<string> {
  const existing = await resolveDriverStripeCustomerId(supabaseService, stripe, userId);
  if (existing) return existing;

  await supabaseService
    .from("subscriptions")
    .upsert({ user_id: userId, plan_key: "free", status: "free" }, { onConflict: "user_id", ignoreDuplicates: true });

  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: { billing_context: "driver", user_id: userId },
  });

  const { data: claimed, error: claimError } = await supabaseService
    .from("subscriptions")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id")
    .maybeSingle();

  if (claimError) {
    await safelyArchiveUnusedCustomer(stripe, customer.id);
    throw new Error(`Failed to persist new driver Stripe customer: ${claimError.message}`);
  }

  if (!claimed) {
    await safelyArchiveUnusedCustomer(stripe, customer.id);
    const { data: winner } = await supabaseService
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!winner?.stripe_customer_id) {
      throw new Error("Concurrent driver customer creation could not be reconciled.");
    }
    return winner.stripe_customer_id;
  }

  await supabaseService.from("profiles").update({ stripe_customer_id: customer.id }).eq("user_id", userId);
  return customer.id;
}
