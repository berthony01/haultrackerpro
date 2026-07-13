import {
  dedupePendingCancellations,
  isTerminalStripeStatus,
  validateSubscriptionContextForDeletion,
  type PendingCancellation,
} from "../_shared/account-deletion-pure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GENERIC_DELETE_ERROR = "Account deletion failed. Please contact support.";

function clientError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type DeletionResult = { ok: true } | { ok: false; status: number; message: string };

/** Minimal structural shape of the Stripe subscription actions this module
 *  calls. Not importing the full Stripe SDK type at module scope on purpose
 *  -- see the dynamic import note below. */
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
 * DEF-02). Exported separately from the Deno.serve handler so it can be
 * exercised by real tests with fake adminClient / stripe implementations,
 * not only source-text matching.
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
  const { adminClient, stripe, userId } = deps;

  const { data: driverSub, error: driverSubErr } = await adminClient
    .from("subscriptions").select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  if (driverSubErr) {
    console.error(`[delete-account] user=${userId} failed reading driver subscription:`, driverSubErr);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }

  const { data: recruiterBilling, error: recruiterBillingErr } = await adminClient
    .from("recruiter_billing_profiles").select("stripe_subscription_id").eq("user_id", userId).maybeSingle();
  if (recruiterBillingErr) {
    console.error(`[delete-account] user=${userId} failed reading recruiter billing:`, recruiterBillingErr);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }

  const { data: ownedAgencies, error: ownedAgenciesErr } = await adminClient
    .from("agency_members").select("agency_id")
    .eq("member_user_id", userId).eq("role", "agency_owner").eq("status", "active");
  if (ownedAgenciesErr) {
    console.error(`[delete-account] user=${userId} failed reading agency ownership:`, ownedAgenciesErr);
    return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
  }
  const ownedAgencyIds: string[] = (ownedAgencies ?? []).map((r: { agency_id: string }) => r.agency_id);

  let ownedAgencyEntitlements: { agency_id: string; stripe_subscription_id: string | null }[] = [];
  if (ownedAgencyIds.length > 0) {
    const { data: ents, error: entsErr } = await adminClient
      .from("agency_entitlements").select("agency_id, stripe_subscription_id").in("agency_id", ownedAgencyIds);
    if (entsErr) {
      console.error(`[delete-account] user=${userId} failed reading agency entitlements:`, entsErr);
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

  const driverPriceConfig = {
    pro_monthly: typeof Deno !== "undefined" ? Deno.env.get("STRIPE_PRO_MONTHLY_PRICE_ID") : undefined,
    pro_yearly: typeof Deno !== "undefined" ? Deno.env.get("STRIPE_PRO_YEARLY_PRICE_ID") : undefined,
  };

  for (const item of deduped) {
    let sub: any;
    try {
      sub = await stripe.subscriptions.retrieve(item.subscriptionId);
    } catch (e) {
      console.error(`[delete-account] user=${userId} could not retrieve Stripe subscription ${item.subscriptionId} (${item.context}):`, e);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }

    const validation = validateSubscriptionContextForDeletion(item.context, sub, driverPriceConfig);
    if (!validation.ok) {
      console.error(`[delete-account] user=${userId} CONTEXT MISMATCH — aborting for manual reconciliation: ${validation.reason}`);
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
          console.error(`[delete-account] user=${userId} Stripe cancellation failed for ${item.context} subscription ${item.subscriptionId}:`, e);
          return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
        }
      }
    }
  }

  for (const table of LOCAL_TABLES_IN_ORDER) {
    const { error } = await adminClient.from(table).delete().eq("user_id", userId);
    if (error) {
      console.error(`[delete-account] user=${userId} table=${table} failed:`, error);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }
  }

  if (ownedAgencyIds.length > 0) {
    const { error } = await adminClient
      .from("agency_entitlements")
      .update({ status: "cancelled", stripe_subscription_id: null, current_period_end: null, updated_at: new Date().toISOString() })
      .in("agency_id", ownedAgencyIds);
    if (error) {
      console.error(`[delete-account] user=${userId} failed clearing owned agency entitlements:`, error);
      return { ok: false, status: 500, message: GENERIC_DELETE_ERROR };
    }
  }

  return { ok: true };
}

// Guarded so this module can be imported by a non-Deno test runner (Vitest)
// to exercise performAccountDeletion without triggering a top-level server
// start, and without eagerly resolving any Deno-only URL imports (which a
// Node/Vite module graph cannot load statically). Both the Supabase and
// Stripe SDKs are imported dynamically, only inside this guard, only in the
// real Deno Edge Function runtime. Behavior there is unchanged from a
// static import — Deno is always defined in that runtime, so this branch
// always runs there exactly as before.
if (typeof Deno !== "undefined" && typeof (Deno as any).serve === "function") {
  const supabaseJsSpecifier = "https://esm.sh/@supabase/supabase-js@2";
  const stripeSpecifier = "https://esm.sh/stripe@18.5.0";

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return clientError(401, "Missing authorization");

      const { createClient } = await import(/* @vite-ignore */ supabaseJsSpecifier);
      const { default: Stripe } = await import(/* @vite-ignore */ stripeSpecifier);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        if (userError) console.error("[delete-account] auth.getUser failed:", userError);
        return clientError(401, "Unauthorized");
      }

      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        console.error("[delete-account] STRIPE_SECRET_KEY not configured; refusing to delete an account with unverifiable billing state");
        return clientError(500, GENERIC_DELETE_ERROR);
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      const result = await performAccountDeletion({ adminClient, stripe, userId: user.id });
      if (!result.ok) {
        return clientError(result.status, result.message);
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
      if (deleteError) {
        console.error(`[delete-account] user=${user.id} auth.admin.deleteUser failed:`, deleteError);
        return clientError(500, "Unable to complete account deletion at this time.");
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[delete-account] unexpected error:", err);
      return clientError(500, GENERIC_DELETE_ERROR);
    }
  });
}
