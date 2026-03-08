/**
 * Centralized billing plan configuration.
 * All plan definitions, price IDs, and access helpers live here.
 */

export type PlanKey = 'free' | 'pro_monthly' | 'pro_yearly';

export interface PlanDefinition {
  key: PlanKey;
  label: string;
  priceId: string | null; // null for free
  monthlyPrice: number;
  interval: 'month' | 'year' | null;
  trialDays: number;
}

/**
 * Price IDs are safe to include client-side (they are publishable Stripe IDs).
 * Edge functions also read from STRIPE_PRO_MONTHLY_PRICE_ID / STRIPE_PRO_YEARLY_PRICE_ID secrets.
 */
export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: 'free',
    label: 'Free',
    priceId: null,
    monthlyPrice: 0,
    interval: null,
    trialDays: 0,
  },
  pro_monthly: {
    key: 'pro_monthly',
    label: 'Pro Monthly',
    priceId: 'price_1T6CKEI2TXbeuHi4TRGgvYlU',
    monthlyPrice: 15,
    interval: 'month',
    trialDays: 14,
  },
  pro_yearly: {
    key: 'pro_yearly',
    label: 'Pro Annual',
    priceId: 'price_1T6CKFI2TXbeuHi4ukgdi2Md',
    monthlyPrice: 10,
    interval: 'year',
    trialDays: 14,
  },
};

/** Subscription statuses that grant Pro access */
export const PRO_STATUSES = ['active', 'trialing'] as const;

/** Check if a subscription status grants Pro access */
export function isProStatus(status: string | null | undefined): boolean {
  return PRO_STATUSES.includes(status as any);
}

/** Get plan definition by Stripe price ID */
export function getPlanByPriceId(priceId: string): PlanDefinition | undefined {
  return Object.values(PLANS).find((p) => p.priceId === priceId);
}

/** Get plan key from a Stripe price ID */
export function getPlanKeyByPriceId(priceId: string): PlanKey {
  const plan = getPlanByPriceId(priceId);
  return plan?.key ?? 'free';
}

/** All paid plan keys */
export const PAID_PLAN_KEYS: PlanKey[] = ['pro_monthly', 'pro_yearly'];
