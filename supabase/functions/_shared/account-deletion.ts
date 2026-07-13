// Phase 1B-1 — shared, runtime-neutral account-deletion orchestration
// (DEF-01 / DEF-02). Moved out of supabase/functions/delete-account/index.ts
// so it can be imported directly by src/test/phase1aDriverBillingResolution.test.ts
// under Node/Vitest without pulling a Deno Edge Function entrypoint into the
// frontend test graph.
//
// This module deliberately:
//   - never calls Deno.serve
//   - never imports a Deno-only URL dependency (https://..., npm:...)
//   - never reads Deno.env
// The Edge Function adapter (./index.ts, sibling `delete-account` folder)
// is a thin runtime wrapper: it reads environment variables, constructs the
// real Supabase/Stripe clients, authenticates the caller, calls
// performAccountDeletion from here, deletes the auth user last, and formats
// the HTTP response.
import {
  dedupePendingCancellations,
  isTerminalStripeStatus,
  validateSubscriptionContextForDeletion,
  type PendingCancellation,
} from "./account-deletion-pure.ts";
import type { DriverPriceConfig } from "./driver-billing-pure.ts";

export const GENERIC_DELETE_ERROR = "Account deletion failed. Please contact support.";

export type DeletionResult = { ok: true } | { ok: false; status: number; message: string };

/** Minimal structural shape of the Stripe subscription actions this module
 *  calls. Not importing the full Stripe SDK type here on purpose — this
 *  module must stay importable under Node/Vitest with zero Deno/URL
 *  dependencies. The real Edge Function adapter passes a real `Stripe`
 *  instance, which is structurally compatible with this interface. */
export interface StripeSubscriptionActionsLike {
  subscriptions: {
    retrieve(id: string): Promise<any>;
    cancel(id: string): Promise<any>;
  };
}

export interface DeletionDeps {
  adminClient: any;
  stripe: StripeSubscriptionActionsLike;
  userId: string;
  /** Must be supplied by the caller (read from Deno.env in the real Edge
   *  Function adapter). This module never reads process-wide environment
   *  state itself. */
  driverPriceConfig: DriverPriceConfig;
}

// FK-safe deletion order. Phase 1A (DEF-02) additions are the six tables
// starting at cost_profile, plus driver-owned rows on agency/assistant
// relationship tables and recruiter_billing_profiles, none of which have a
// cascade FK to auth.users (confirmed via pg_constraint).
//
// Deliberately NOT included here (documented, not silently dropped):
// agency_audit_log and assistant_audit_log (driver_user_id) — these are
// shared compliance/audit trail records that also describe another party's
// (agency/assistant) actions; hard-deleting them on driver deletion could
// erase that other party's audit evidence. admin_users is also excluded —
// it is a platform-governance table, not user content. All three require a
// deliberate product decision (delete vs redact-and-retain) outside this
// narrowly-scoped billing-identity/deletion-integrity phase.
const LOCAL_TABLES_IN_ORDER = [
  "load_stops",
  "expenses",
  "fuel_logs",
  "loads",
  "broker_stats",
  "lane_stats",
  "operating_metrics",
  "brokers",
  "recurring_expense_templates",
  "weekly_snapshots",
  "feedback_responses",
  "parse_usage",
  "user_alerts",
  "expense_automation_logs",
  "ai_insights",
  "cost_profile",
  "parking_favorites",
  "parking_reports",
  "parking_verifications",
  "driver_point_events",
  "driver_points",
  "driver_assistants",
  "agency_client_requests",
  "agency_delegation_requests",
  "agency_work_items",
  "recruiter_contact_requests",
  "recruiter_billing_profiles",
  "subscriptions",
  "user_settings",
  "profiles",
];

/**
 * Core, dependency-injected account-deletion logic (Phase 1A / DEF-01,
 * DEF-02). Runtime-neutral: importable and executable identically under
 * Node/Vitest and the real Deno Edge Function runtime.
 *
 * Strict ordering:
 *   1. Collect every Stripe subscription owned by this account across all
 *      three billing contexts (driver via subscriptions, recruiter via
 *      recruiter_billing_profiles, agency ONLY where this user is an
 *      active agency_owner — never merely an admin/member).
 *   2. Validate + cancel every one of them. Any context mismatch or
 *      non-transient Stripe failure aborts here — nothing is deleted, the
 *      auth user is not touched, and the account remains fully
 *      recoverable.
 *   3. Only once every subscription is confirmed canceled or already
 *      terminal, delete local rows in FK-safe order, clear (not delete)
 *      any owned agency entitlement so the agency and its other members
 *      are not destroyed, then the caller deletes the auth user last.
 */
export async function performAccountDeletion(deps: DeletionDeps): Promise<DeletionResult> {
  const { adminClient, stripe, userId, driverPriceConfig } = deps;

  const { data: driverSub, error: driverSubErr } = await adminClient
    .from("subscriptions").select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  if (driverSubErr) {
    console.error(`[account-deletion] user=${userId} failed reading driver subscription:`, driverSubErr);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }

  const { data: recruiterBilling, error: recruiterBillingErr } = await adminClient
    .from("recruiter_billing_profiles").select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  if (recruiterBillingErr) {
    console.error(`[account-deletion] user=${userId} failed reading recruiter billing:`, recruiterBillingErr);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }

  const { data: ownedAgencies, error: ownedAgenciesErr } = await adminClient
    .from("agency_members").select("agency_id")
    .eq("member_user_id", userId).eq("role", "agency_owner").eq("status", "active");
  if (ownedAgenciesErr) {
    console.error(`[account-deletion] user=${userId} failed reading agency ownership:`, ownedAgenciesErr);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }
  const ownedAgencyIds: string[] = (ownedAgencies ?? []).map((r: { agency_id: string }) => r.agency_id);

  let ownedAgencyEntitlements: { agency_id: string; stripe_subscription_id: string | null }[] = [];
  if (ownedAgencyIds.length > 0) {
    const { data: ents, error: entsErr } = await adminClient
      .from("agency_entitlements").select("agency_id, stripe_subscription_id").in("agency_id", ownedAgencyIds);
    if (entsErr) {
      console.error(`[account-deletion] user=${userId} failed reading agency entitlements:`, entsErr);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }
    ownedAgencyEntitlements = ents ?? [];
  }

  const pending: PendingCancellation[] = [];
  if (driverSub?.stripe_subscription_id) pending.push({ context: "driver", subscriptionId: driverSub.stripe_subscription_id });
  if (recruiterBilling?.stripe_subscription_id) pending.push({ context: "recruiter", subscriptionId: recruiterBilling.stripe_subscription_id });
  for (const ent of ownedAgencyEntitlements) {
    if (ent.stripe_subscription_id) pending.push({ context: "agency", subscriptionId: ent.stripe_subscription_id });
  }
  const deduped = dedupePendingCancellations(pending);

  for (const item of deduped) {
    let sub: any;
    try {
      sub = await stripe.subscriptions.retrieve(item.subscriptionId);
    } catch (e) {
      console.error(`[account-deletion] user=${userId} could not retrieve Stripe subscription ${item.subscriptionId} (${item.context}):`, e);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }

    const validation = validateSubscriptionContextForDeletion(item.context, sub, driverPriceConfig);
    if (validation.ok === false) {
      console.error(`[account-deletion] user=${userId} CONTEXT MISMATCH — aborting for manual reconciliation: ${validation.reason}`);
      return { ok: false, status: 409, message: GENERIC_DELETE_ERROR };
    }

    if (!isTerminalStripeStatus(sub.status)) {
      try {
        await stripe.subscriptions.cancel(item.subscriptionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        const alreadyCanceled = code === "resource_missing" || /already been canceled|No such subscription/i.test(message);
        if (!alreadyCanceled) {
          console.error(`[account-deletion] user=${userId} Stripe cancellation failed for ${item.context} subscription ${item.subscriptionId}:`, e);
          return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
        }
      }
    }
  }

  for (const table of LOCAL_TABLES_IN_ORDER) {
    const { error } = await adminClient.from(table).delete().eq("user_id", userId);
    if (error) {
      console.error(`[account-deletion] user=${userId} table=${table} failed:`, error);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }
  }

  if (ownedAgencyIds.length > 0) {
    const { error } = await adminClient
      .from("agency_entitlements")
      .update({ status: "cancelled", stripe_subscription_id: null, current_period_end: null, updated_at: new Date().toISOString() })
      .in("agency_id", ownedAgencyIds);
    if (error) {
      console.error(`[account-deletion] user=${userId} failed clearing owned agency entitlements:`, error);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }
  }

  return { ok: true };
}
