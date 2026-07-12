import { describe, it, expect } from "vitest";
import {
  resolveDriverPlanKeyFromConfig,
  isDriverPriceIdInConfig,
  getDriverPriceAllowlistFromConfig,
  decideDriverCustomerResolution,
  validateDriverSubscription,
} from "../../supabase/functions/_shared/driver-billing-pure";
import {
  dedupePendingCancellations,
  isTerminalStripeStatus,
  validateSubscriptionContextForDeletion,
} from "../../supabase/functions/_shared/account-deletion-pure";

const CONFIG = { pro_monthly: "price_monthly_abc", pro_yearly: "price_yearly_xyz" };

describe("resolveDriverPlanKeyFromConfig", () => {
  it("resolves the configured monthly price", () => {
    expect(resolveDriverPlanKeyFromConfig("price_monthly_abc", CONFIG)).toBe("pro_monthly");
  });
  it("resolves the configured yearly price", () => {
    expect(resolveDriverPlanKeyFromConfig("price_yearly_xyz", CONFIG)).toBe("pro_yearly");
  });
  it("returns null for an unknown price and never defaults to pro_monthly", () => {
    expect(resolveDriverPlanKeyFromConfig("price_totally_unknown", CONFIG)).toBeNull();
  });
  it("returns null for a recruiter-shaped price id that happens not to be configured as a driver price", () => {
    expect(resolveDriverPlanKeyFromConfig("price_recruiter_growth", CONFIG)).toBeNull();
  });
  it("returns null for an agency-shaped price id", () => {
    expect(resolveDriverPlanKeyFromConfig("price_agency_starter", CONFIG)).toBeNull();
  });
  it("returns null for null/undefined input", () => {
    expect(resolveDriverPlanKeyFromConfig(null, CONFIG)).toBeNull();
    expect(resolveDriverPlanKeyFromConfig(undefined, CONFIG)).toBeNull();
  });
});

describe("isDriverPriceIdInConfig / getDriverPriceAllowlistFromConfig", () => {
  it("allowlist contains exactly the two configured driver prices", () => {
    expect(getDriverPriceAllowlistFromConfig(CONFIG).sort()).toEqual(["price_monthly_abc", "price_yearly_xyz"].sort());
  });
  it("flags configured prices as driver prices", () => {
    expect(isDriverPriceIdInConfig("price_monthly_abc", CONFIG)).toBe(true);
  });
  it("flags unknown prices as not driver prices", () => {
    expect(isDriverPriceIdInConfig("price_unknown", CONFIG)).toBe(false);
  });
});

describe("decideDriverCustomerResolution", () => {
  it("prefers the canonical subscriptions customer id when present", () => {
    const decision = decideDriverCustomerResolution(
      { stripe_customer_id: "cus_canonical", stripe_subscription_id: "sub_1" },
      { stripe_customer_id: "cus_legacy" },
    );
    expect(decision).toEqual({ action: "use_existing", customerId: "cus_canonical" });
  });
  it("derives from the stored subscription id when no customer id is stored yet", () => {
    const decision = decideDriverCustomerResolution(
      { stripe_customer_id: null, stripe_subscription_id: "sub_1" },
      null,
    );
    expect(decision).toEqual({ action: "derive_from_subscription", subscriptionId: "sub_1" });
  });
  it("falls back to the legacy profiles mirror only when nothing canonical exists", () => {
    const decision = decideDriverCustomerResolution(
      { stripe_customer_id: null, stripe_subscription_id: null },
      { stripe_customer_id: "cus_legacy", stripe_subscription_id: "sub_legacy" },
    );
    expect(decision).toEqual({ action: "adopt_legacy_profile", customerId: "cus_legacy", requiresSubscriptionValidation: "sub_legacy" });
  });
  it("reports none_available when nothing exists anywhere", () => {
    expect(decideDriverCustomerResolution(null, null)).toEqual({ action: "none_available" });
  });
});

describe("validateDriverSubscription", () => {
  it("rejects a subscription tagged billing_context=recruiter", () => {
    const result = validateDriverSubscription(
      { id: "sub_1", status: "active", customer: "cus_1", metadata: { billing_context: "recruiter" }, items: { data: [{ price: { id: "price_monthly_abc" } }] } },
      CONFIG,
    );
    expect(result.valid).toBe(false);
  });
  it("rejects a subscription tagged billing_context=agency", () => {
    const result = validateDriverSubscription(
      { id: "sub_1", status: "active", customer: "cus_1", metadata: { billing_context: "agency" }, items: { data: [{ price: { id: "price_monthly_abc" } }] } },
      CONFIG,
    );
    expect(result.valid).toBe(false);
  });
  it("rejects a subscription on an unconfigured price even with no context tag", () => {
    const result = validateDriverSubscription(
      { id: "sub_1", status: "active", customer: "cus_1", items: { data: [{ price: { id: "price_recruiter_growth" } }] } },
      CONFIG,
    );
    expect(result.valid).toBe(false);
  });
  it("accepts a genuine untagged driver subscription on a configured driver price", () => {
    const result = validateDriverSubscription(
      { id: "sub_1", status: "active", customer: "cus_1", items: { data: [{ price: { id: "price_yearly_xyz" } }] } },
      CONFIG,
    );
    expect(result).toEqual({ valid: true, customerId: "cus_1", priceId: "price_yearly_xyz" });
  });
});

describe("dedupePendingCancellations", () => {
  it("removes duplicate subscription ids while preserving first occurrence order", () => {
    const result = dedupePendingCancellations([
      { context: "driver", subscriptionId: "sub_a" },
      { context: "recruiter", subscriptionId: "sub_b" },
      { context: "driver", subscriptionId: "sub_a" },
    ]);
    expect(result).toEqual([
      { context: "driver", subscriptionId: "sub_a" },
      { context: "recruiter", subscriptionId: "sub_b" },
    ]);
  });
});

describe("isTerminalStripeStatus", () => {
  it("treats canceled and incomplete_expired as terminal", () => {
    expect(isTerminalStripeStatus("canceled")).toBe(true);
    expect(isTerminalStripeStatus("incomplete_expired")).toBe(true);
  });
  it("treats active/trialing/past_due as non-terminal", () => {
    expect(isTerminalStripeStatus("active")).toBe(false);
    expect(isTerminalStripeStatus("trialing")).toBe(false);
    expect(isTerminalStripeStatus("past_due")).toBe(false);
  });
});

describe("validateSubscriptionContextForDeletion", () => {
  it("stops a driver cancellation when the stored subscription is actually tagged recruiter", () => {
    const result = validateSubscriptionContextForDeletion(
      "driver",
      { id: "sub_1", status: "active", metadata: { billing_context: "recruiter" }, items: { data: [{ price: { id: "price_monthly_abc" } }] } },
      CONFIG,
    );
    expect(result.ok).toBe(false);
  });
  it("stops a driver cancellation when the price is not a configured driver price", () => {
    const result = validateSubscriptionContextForDeletion(
      "driver",
      { id: "sub_1", status: "active", items: { data: [{ price: { id: "price_recruiter_growth" } }] } },
      CONFIG,
    );
    expect(result.ok).toBe(false);
  });
  it("allows a genuine driver subscription", () => {
    const result = validateSubscriptionContextForDeletion(
      "driver",
      { id: "sub_1", status: "active", items: { data: [{ price: { id: "price_monthly_abc" } }] } },
      CONFIG,
    );
    expect(result.ok).toBe(true);
  });
  it("stops a recruiter cancellation when tagged agency", () => {
    const result = validateSubscriptionContextForDeletion(
      "recruiter",
      { id: "sub_2", status: "active", metadata: { billing_context: "agency" } },
      CONFIG,
    );
    expect(result.ok).toBe(false);
  });
  it("allows a genuine agency cancellation", () => {
    const result = validateSubscriptionContextForDeletion(
      "agency",
      { id: "sub_3", status: "active", metadata: { billing_context: "agency" } },
      CONFIG,
    );
    expect(result.ok).toBe(true);
  });
});
