// Phase 1A — pure decision logic for billing-safe account deletion.
// No Deno/Stripe/Supabase SDK imports — directly unit-testable.
import { isDriverPriceIdInConfig, type DriverPriceConfig } from "./driver-billing-pure.ts";

export type PendingCancellation = { context: "driver" | "recruiter" | "agency"; subscriptionId: string };

export function dedupePendingCancellations(items: PendingCancellation[]): PendingCancellation[] {
  const seen = new Set<string>();
  const out: PendingCancellation[] = [];
  for (const item of items) {
    if (seen.has(item.subscriptionId)) continue;
    seen.add(item.subscriptionId);
    out.push(item);
  }
  return out;
}

export const TERMINAL_STRIPE_STATUSES = new Set(["canceled", "incomplete_expired"]);

export function isTerminalStripeStatus(status: string): boolean {
  return TERMINAL_STRIPE_STATUSES.has(status);
}

export type SubLike = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  items?: { data?: { price?: { id?: string | null } | null }[] };
};

/** Validate that a subscription slated for cancellation in a given context
 *  actually belongs to that context, before Stripe or the DB is touched.
 *  Returns ok:false (never throws) so callers decide how to log/stop.
 */
export function validateSubscriptionContextForDeletion(
  context: "driver" | "recruiter" | "agency",
  sub: SubLike,
  driverPriceConfig: DriverPriceConfig,
): { ok: true } | { ok: false; reason: string } {
  const metaContext = sub.metadata?.billing_context;
  if (context === "driver") {
    if (metaContext && metaContext !== "driver") {
      return { ok: false, reason: `driver subscription ${sub.id} is tagged billing_context="${metaContext}"` };
    }
    const priceId = sub.items?.data?.[0]?.price?.id ?? "";
    if (!isDriverPriceIdInConfig(priceId, driverPriceConfig)) {
      return { ok: false, reason: `driver subscription ${sub.id} does not use a configured driver price` };
    }
    return { ok: true };
  }
  if (metaContext && metaContext !== context) {
    return { ok: false, reason: `${context} subscription ${sub.id} is tagged billing_context="${metaContext}"` };
  }
  return { ok: true };
}
