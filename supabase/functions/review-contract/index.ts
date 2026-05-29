// Phase 5: Driver contract decision workflow.
// - Auth: only the assigned driver (admin can act on driver's behalf for support).
// - Decisions: approve_contract | reject_contract | request_changes
// - Requires version.upload_status='uploaded' AND it's the contract's CURRENT version.
// - Writes contract_reviews(reviewer_role='driver') and audits via service-role.
// - Status transitions (forward-only), allowed from {ai_reviewed, driver_reviewing, changes_requested}:
//     approve_contract     -> approved
//     reject_contract      -> rejected
//     request_changes      -> changes_requested
//   Never regress from signed/expired/archived/approved/rejected.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Decision = "approve_contract" | "reject_contract" | "request_changes";

const DECISION_TO_STATUS: Record<Decision, "approved" | "rejected" | "changes_requested"> = {
  approve_contract: "approved",
  reject_contract: "rejected",
  request_changes: "changes_requested",
};

const DECISION_TO_AUDIT: Record<Decision, "approved" | "rejected" | "changes_requested"> = {
  approve_contract: "approved",
  reject_contract: "rejected",
  request_changes: "changes_requested",
};

// Statuses from which a driver decision is permitted.
// Phase 5 hardening: AI review is required before a decision.
const DECIDABLE_FROM = new Set(["ai_reviewed", "driver_reviewing", "changes_requested"]);
// Statuses we must never overwrite.
const TERMINAL_OR_LATER = new Set(["approved", "rejected", "signed", "expired", "archived"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const version_id = String(body.version_id || "").trim();
    const decision = String(body.decision || "").trim() as Decision;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";
    if (!version_id) return json({ error: "version_id required" }, 400);
    if (!(decision in DECISION_TO_STATUS)) return json({ error: "Invalid decision" }, 400);
    if (decision === "request_changes" && !note) {
      return json({ error: "A note is required when requesting changes." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: version, error: vErr } = await admin
      .from("contract_versions")
      .select(
        "id, contract_id, upload_status, contracts:contract_id(id, status, driver_user_id, current_version_id)"
      )
      .eq("id", version_id)
      .maybeSingle();
    if (vErr) { console.error("[review-contract] version lookup", vErr); return json({ error: "Could not load contract version." }, 500); }
    if (!version) return json({ error: "Version not found" }, 404);

    const c: any = (version as any).contracts;
    if (!c) return json({ error: "Contract not found" }, 404);

    // Strict: only the assigned driver may submit approve/reject/request_changes.
    // Admin overrides go through the separate contract-admin function and never insert
    // a contract_reviews row attributed to the driver (which would unlock signing).
    const isDriver = c.driver_user_id === userId;
    if (!isDriver) {
      return json({ error: "Only the assigned driver can submit a decision." }, 403);
    }

    if (version.upload_status !== "uploaded") {
      return json({ error: "Contract version is not ready for review." }, 409);
    }
    if (c.current_version_id && c.current_version_id !== version_id) {
      return json({ error: "Decisions can only be made on the current contract version." }, 409);
    }

    const currentStatus = String(c.status || "");
    if (TERMINAL_OR_LATER.has(currentStatus)) {
      return json({ error: `Contract status is "${currentStatus}" and cannot be changed.` }, 409);
    }
    if (!DECIDABLE_FROM.has(currentStatus)) {
      return json({ error: `Contract is not in a reviewable state (${currentStatus}).` }, 409);
    }

    const targetStatus = DECISION_TO_STATUS[decision];
    const auditAction = DECISION_TO_AUDIT[decision];
    const actorRole: "driver" = "driver";

    // Atomic-as-possible: insert the review FIRST. No audit until it succeeds.
    // The partial unique index (contract_reviews_driver_unique_per_version)
    // prevents duplicate driver decisions on the same version.
    const { data: reviewRow, error: rvErr } = await admin
      .from("contract_reviews")
      .insert({
        contract_id: version.contract_id,
        version_id,
        reviewer_role: "driver",
        reviewer_user_id: userId,
        decision: targetStatus,
        notes: note || null,
      })
      .select("id")
      .single();
    if (rvErr || !reviewRow) {
      const isDup =
        (rvErr as any)?.code === "23505" ||
        /duplicate key|unique/i.test(rvErr?.message || "");
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "driver_review_failed",
        metadata: {
          reason: rvErr?.message || "review insert failed",
          phase: "driver_decision",
          duplicate: isDup,
        },
      });
      if (isDup) {
        return json({ error: "You have already submitted a decision for this contract version." }, 409);
      }
      console.error("[review-contract] review insert", rvErr);
      return json({ error: "Could not save your decision." }, 500);
    }

    // Advance status only from a decidable state. Service role bypasses the
    // status guard, but we manually scope the UPDATE so we never overwrite
    // a TERMINAL_OR_LATER state. Require exactly 1 row affected, or fail.
    const { data: stRows, error: stErr } = await admin
      .from("contracts")
      .update({ status: targetStatus })
      .eq("id", version.contract_id)
      .eq("current_version_id", version_id)
      .in("status", Array.from(DECIDABLE_FROM))
      .select("id");
    const transitioned = !stErr && Array.isArray(stRows) && stRows.length === 1;
    if (!transitioned) {
      // Status didn't move (race / concurrent decision / regression attempt).
      // Roll back the review row to keep state consistent and audit the failure.
      await admin.from("contract_reviews").delete().eq("id", reviewRow.id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "driver_review_failed",
        metadata: {
          reason: stErr?.message || "status transition rejected",
          phase: "status_update",
          attempted_status: targetStatus,
        },
      });
      if (stErr) console.error("[review-contract] status update", stErr);
      return json(
        { error: "Contract status changed before your decision could be saved." },
        409,
      );
    }

    // Audit: driver_reviewed (only after review insert + status update succeeded).
    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "driver_reviewed",
      metadata: { decision: targetStatus, note_chars: note.length },
    });

    // Audit: outcome
    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: auditAction,
      metadata: { review_id: reviewRow.id, has_note: note.length > 0 },
    });

    return json({
      ok: true,
      review_id: reviewRow.id,
      decision: targetStatus,
    });
  } catch (e) {
    console.error("[review-contract] error", e);
    return json({ error: "Server error. Please try again." }, 500);
  }
});
