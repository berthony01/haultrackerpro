// Phase 1N-F1-A — shared, runtime-neutral account-deletion orchestration.
// Repairs Phase 1A/1B by (1) blocking personal-account deletion when the
// caller canonically owns one or more agency_profiles (agency must be
// transferred or closed via a dedicated flow, not silently destroyed here),
// (2) replacing a broken generic `.eq('user_id', userId)` loop with
// explicit role-aware relationship cleanup keyed on the real identity
// columns (driver_user_id / assistant_user_id / member_user_id /
// assigned_member_user_id), and (3) reserving direct user_id deletion for
// tables that truly own a user_id column.
//
// This module deliberately:
//   - never calls Deno.serve
//   - never imports a Deno-only URL dependency (https://..., npm:...)
//   - never reads Deno.env
// The Edge Function adapter (../delete-account/index.ts) is a thin runtime
// wrapper that constructs Supabase/Stripe clients, authenticates the
// caller, calls performAccountDeletion, then deletes the auth user last.
import {
  dedupePendingCancellations,
  isTerminalStripeStatus,
  validateSubscriptionContextForDeletion,
  type PendingCancellation,
} from "./account-deletion-pure.ts";
import type { DriverPriceConfig } from "./driver-billing-pure.ts";

export const GENERIC_DELETE_ERROR = "Account deletion failed. Please contact support.";
export const AGENCY_OWNER_BLOCK_MESSAGE =
  "You own an agency workspace. Transfer ownership or close the agency before deleting your personal account.";

export type DeletionResult = { ok: true } | { ok: false; status: number; message: string };

/** Minimal structural shape of the Stripe subscription actions this module
 *  calls. Not importing the full Stripe SDK type here on purpose — this
 *  module must stay importable under Node/Vitest with zero Deno/URL
 *  dependencies. */
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
  driverPriceConfig: DriverPriceConfig;
}

// Tables whose real identity column IS `user_id`. Relationship tables that
// key on driver_user_id / assistant_user_id / member_user_id /
// assigned_member_user_id are handled explicitly below and must NOT appear
// here. FK-safe within this category: children before parents (profiles).
const DIRECT_USER_ID_TABLES_IN_ORDER = [
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
  "driver_opportunity_profiles",
  "saved_opportunities",
  "notifications",
  "notification_preferences",
  "recruiter_billing_profiles",
  "subscriptions",
  "user_settings",
  "profiles",
];

function logAndFail(userId: string, where: string, err: unknown): DeletionResult {
  console.error(`[account-deletion] user=${userId} ${where} failed:`, err);
  return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
}

/**
 * Core, dependency-injected account-deletion logic. Runtime-neutral.
 *
 * Ordering:
 *   1. Canonical owned-agency check via agency_profiles.owner_user_id.
 *      If any owned agency exists → hard block (409). No Stripe call, no
 *      mutation. The caller remains fully recoverable.
 *   2. Read driver + recruiter billing rows for the caller.
 *   3. Retrieve, context-validate, and cancel every non-terminal Stripe
 *      subscription. Any read/retrieve/context/non-idempotent cancel error
 *      aborts before any local mutation.
 *   4. Explicit role-aware relationship cleanup on real identity columns.
 *   5. Direct user_id cleanup on tables that truly own user_id.
 *   6. Return ok:true; the edge adapter deletes the auth user last.
 */
export async function performAccountDeletion(deps: DeletionDeps): Promise<DeletionResult> {
  const { adminClient, stripe, userId, driverPriceConfig } = deps;

  // 1. Canonical agency-owner hard block.
  const { data: ownedProfiles, error: ownedProfilesErr } = await adminClient
    .from("agency_profiles").select("id").eq("owner_user_id", userId);
  if (ownedProfilesErr) return logAndFail(userId, "reading agency_profiles.owner_user_id", ownedProfilesErr);
  if ((ownedProfiles ?? []).length > 0) {
    return { ok: false, status: 409, message: AGENCY_OWNER_BLOCK_MESSAGE };
  }

  // 2. Billing collection (driver + recruiter only; agency billing never
  //    touched in personal deletion — owners were blocked above).
  const { data: driverSub, error: driverSubErr } = await adminClient
    .from("subscriptions").select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  if (driverSubErr) return logAndFail(userId, "reading driver subscription", driverSubErr);

  const { data: recruiterBilling, error: recruiterBillingErr } = await adminClient
    .from("recruiter_billing_profiles").select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  if (recruiterBillingErr) return logAndFail(userId, "reading recruiter billing", recruiterBillingErr);

  const pending: PendingCancellation[] = [];
  if (driverSub?.stripe_subscription_id) pending.push({ context: "driver", subscriptionId: driverSub.stripe_subscription_id });
  if (recruiterBilling?.stripe_subscription_id) pending.push({ context: "recruiter", subscriptionId: recruiterBilling.stripe_subscription_id });
  const deduped = dedupePendingCancellations(pending);

  // 3. Retrieve + validate + cancel every pending subscription.
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

  // 4. Explicit role-aware relationship cleanup.

  // driver_assistants: caller is either the driver or the assistant on this row.
  {
    const { error } = await adminClient.from("driver_assistants").delete().eq("driver_user_id", userId);
    if (error) return logAndFail(userId, "cleanup driver_assistants(driver_user_id)", error);
  }
  {
    const { error } = await adminClient.from("driver_assistants").delete().eq("assistant_user_id", userId);
    if (error) return logAndFail(userId, "cleanup driver_assistants(assistant_user_id)", error);
  }

  // agency_work_items: delete rows belonging to the departing driver's
  // managed relationship; separately null out the departing agency
  // member's assignment on shared rows. Do not rewrite created_by_user_id.
  {
    const { error } = await adminClient.from("agency_work_items").delete().eq("driver_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_work_items(driver_user_id)", error);
  }
  {
    const { error } = await adminClient
      .from("agency_work_items").update({ assigned_member_user_id: null })
      .eq("assigned_member_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_work_items(assigned_member_user_id)", error);
  }

  // agency_delegation_requests: caller as driver OR as agency member.
  {
    const { error } = await adminClient.from("agency_delegation_requests").delete().eq("driver_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_delegation_requests(driver_user_id)", error);
  }
  {
    const { error } = await adminClient.from("agency_delegation_requests").delete().eq("member_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_delegation_requests(member_user_id)", error);
  }

  // agency_client_requests: null the caller's assignment FIRST so the
  // subsequent membership revoke doesn't leave dangling assignments; then
  // delete rows keyed to the departing driver.
  {
    const { error } = await adminClient
      .from("agency_client_requests").update({ assigned_member_user_id: null })
      .eq("assigned_member_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_client_requests(assigned_member_user_id)", error);
  }
  {
    const { error } = await adminClient.from("agency_client_requests").delete().eq("driver_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_client_requests(driver_user_id)", error);
  }

  // agency_members: caller is a non-owner (owners were hard-blocked). Do
  // NOT cancel agency billing, delete the profile, or delete the row —
  // preserve the invite/membership record as shared agency history and
  // revoke it in place, detaching the personal identity.
  {
    const { error } = await adminClient
      .from("agency_members")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), member_user_id: null })
      .eq("member_user_id", userId);
    if (error) return logAndFail(userId, "cleanup agency_members(member_user_id revoke)", error);
  }

  // 5. Direct user_id cleanup.
  for (const table of DIRECT_USER_ID_TABLES_IN_ORDER) {
    const { error } = await adminClient.from(table).delete().eq("user_id", userId);
    if (error) return logAndFail(userId, `direct user_id cleanup table=${table}`, error);
  }

  return { ok: true };
}
