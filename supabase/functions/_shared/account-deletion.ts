// Phase 1N-F1-E — shared, runtime-neutral account-deletion orchestration.
//
// This module preserves the pre-cleanup ordering accepted in Phase 1N-F1-A-R1
// (agency-owner hard block via agency_profiles.owner_user_id → driver billing
// read → recruiter billing read → per-subscription Stripe retrieve + context
// validation + non-terminal cancel) but replaces the previous sequential
// TypeScript relationship/direct-table cleanup with EXACTLY ONE authenticated
// call to the caller-bound SECURITY DEFINER RPC
// public.finalize_my_account_data_deletion(). That RPC owns the atomic,
// caller-`auth.uid()`-bound cleanup transaction; this file no longer contains
// any table-cleanup pipeline.
//
// The edge adapter (../delete-account/index.ts) is a thin runtime wrapper
// that constructs the Supabase admin/user clients and the Stripe client,
// authenticates the caller, calls performAccountDeletion, then — only on
// {ok:true} — deletes the auth user last via adminClient.auth.admin.
//
// Runtime neutrality: this module deliberately does not import Deno.serve,
// any https://... or npm:... URL specifier, or Deno.env. It must remain
// importable under Node/Vitest with zero Deno dependencies.
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

/** Minimal structural shape of the authenticated RPC-capable client used to
 *  invoke public.finalize_my_account_data_deletion() as the calling user
 *  (never service_role, never admin). Must call the RPC with an empty args
 *  object so the SECURITY DEFINER function derives identity from auth.uid()
 *  exclusively. */
export interface AuthenticatedCleanupClient {
  rpc(
    name: string,
    args?: Record<string, never>,
  ): Promise<{ data: any; error: any }>;
}

export interface DeletionDeps {
  adminClient: any;
  stripe: StripeSubscriptionActionsLike;
  /** REQUIRED. Authenticated user client (Authorization: Bearer <user jwt>)
   *  used solely to invoke finalize_my_account_data_deletion(). Never
   *  fall back to adminClient — the RPC's ownership derives from
   *  auth.uid() on the RPC connection. */
  cleanupClient: AuthenticatedCleanupClient;
  userId: string;
  driverPriceConfig: DriverPriceConfig;
}

const CLEANUP_RPC_NAME = "finalize_my_account_data_deletion" as const;

function logAndFail(userId: string, where: string, err: unknown): DeletionResult {
  console.error(`[account-deletion] user=${userId} ${where} failed:`, err);
  return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * Core, dependency-injected account-deletion logic. Runtime-neutral.
 *
 * Ordering (unchanged externally):
 *   1. Canonical owned-agency check via agency_profiles.owner_user_id.
 *      If any owned agency exists → hard block (409). No Stripe call, no
 *      RPC. The caller remains fully recoverable.
 *   2. Read driver + recruiter billing rows for the caller.
 *   3. Retrieve, context-validate, and cancel every non-terminal Stripe
 *      subscription. Any read/retrieve/context/non-idempotent cancel error
 *      aborts BEFORE the cleanup RPC is invoked.
 *   4. Invoke public.finalize_my_account_data_deletion() EXACTLY ONCE via
 *      the authenticated cleanupClient with empty args. That RPC owns the
 *      atomic cleanup transaction, including its own owner-race guard.
 *   5. Validate the RPC's single-row set-returning result. Any malformed
 *      response is rejected as generic 500 and the auth user is NOT
 *      deleted (auth deletion happens in the adapter, only on ok:true).
 *
 * Retry semantics:
 *   - Stripe cancellation: already-terminal / resource_missing / prior
 *     accepted terminal states are treated as idempotent success.
 *   - Cleanup RPC: if it committed but its HTTP response was lost, a retry
 *     is safe because finalize_my_account_data_deletion() is idempotent
 *     and returns zero counters on the second call.
 *   - Auth-user deletion is outside this module and always occurs last.
 */
export async function performAccountDeletion(deps: DeletionDeps): Promise<DeletionResult> {
  const { adminClient, stripe, cleanupClient, userId, driverPriceConfig } = deps;

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

  // 3. Retrieve + validate + cancel every pending subscription. Any failure
  //    aborts BEFORE the cleanup RPC is invoked.
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

  // 4. Atomic transactional cleanup — exactly one authenticated RPC.
  //    No user_id / target / role arguments: the SECURITY DEFINER function
  //    derives identity from auth.uid() on the caller's JWT.
  const { data: rpcData, error: rpcError } = await cleanupClient.rpc(CLEANUP_RPC_NAME, {});

  if (rpcError) {
    const code = (rpcError as { code?: string })?.code;
    const message = typeof (rpcError as { message?: unknown })?.message === "string"
      ? (rpcError as { message: string }).message
      : "";
    if (code === "P0001" && message.includes(AGENCY_OWNER_BLOCK_MESSAGE)) {
      // Owner-state race: caller became an agency owner between the
      // adminClient owner precheck (step 1) and the RPC's own owner guard.
      // Log stage only — no caller identity, no raw error payload.
      console.error(`[account-deletion] cleanup RPC owner-race`);
      return { ok: false, status: 409, message: AGENCY_OWNER_BLOCK_MESSAGE };
    }
    // Log stage + bounded error code only — no userId, no message, no stack.
    console.error(`[account-deletion] cleanup RPC failed: code=${code ?? "none"}`);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }

  // 5. Validate the single-row set-returning response. A malformed response
  //    is NEVER treated as success — the adapter must not delete the auth
  //    user unless every invariant below holds. All rejection logs are
  //    static stage descriptions with no caller identity and no payload.
  if (!Array.isArray(rpcData) || rpcData.length !== 1) {
    console.error(`[account-deletion] cleanup RPC malformed shape`);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }
  const row = rpcData[0] as Record<string, unknown> | null;
  if (!row || typeof row !== "object") {
    console.error(`[account-deletion] cleanup RPC null row`);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }
  if (row.deleted_user_id !== userId) {
    console.error(`[account-deletion] cleanup RPC deleted_user_id mismatch`);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }
  for (const counter of [
    "relationship_rows_deleted",
    "shared_assignments_cleared",
    "agency_memberships_revoked",
    "direct_rows_deleted",
  ] as const) {
    if (!isNonNegativeInt(row[counter])) {
      console.error(`[account-deletion] cleanup RPC counter invalid`);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }
  }

  return { ok: true };
}
