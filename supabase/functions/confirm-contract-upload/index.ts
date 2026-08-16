// Phase 2 hardening: confirm a recruiter contract upload after the client
// PUTs the file to the signed storage URL. Verifies ownership, verifies the
// storage object exists, then marks the version as 'uploaded' and promotes
// it to current_version_id on the contract.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "contract-documents";

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
    if (!version_id) return json({ error: "version_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Load version + parent contract
    const { data: version, error: vErr } = await admin
      .from("contract_versions")
      .select(
        "id, contract_id, storage_bucket, storage_path, file_name, upload_status, version_number, contracts:contract_id(id, recruiter_user_id, recruiter_id, application_id)"
      )
      .eq("id", version_id)
      .maybeSingle();
    if (vErr) { console.error("[confirm-contract-upload] version lookup", vErr); return json({ error: "Could not load contract version." }, 500); }
    if (!version) return json({ error: "Version not found" }, 404);

    const c = (version as any).contracts;
    if (!c) return json({ error: "Contract not found" }, 404);

    // Cross-check recruiter profile is still in good standing
    const { data: rp } = await admin
      .from("recruiter_profiles")
      .select("user_id, status, verification_status")
      .eq("id", c.recruiter_id)
      .maybeSingle();
    if (
      !rp ||
      rp.status === "suspended" ||
      rp.verification_status === "suspended" ||
      rp.verification_status !== "approved"
    ) {
      return json({ error: "Not authorized" }, 403);
    }

    // Owner path: unchanged — the contract's canonical recruiter owner.
    const isOwner = c.recruiter_user_id === userId && rp.user_id === userId;

    // Phase RC-1G — the same authorized staff caller that started a version
    // may confirm it. Authorization comes ONLY from the server-side helper
    // (`contracts_manage`), never a role label, and is evaluated with the
    // real staff auth.uid(). Stale-confirm and terminal-status protections
    // below are untouched.
    let isAuthorizedStaff = false;
    if (!isOwner) {
      const { data: staffOk, error: staffErr } = await userClient.rpc(
        "current_user_can_recruiter_contract_action",
        { _recruiter_id: c.recruiter_id, _permission: "contracts_manage" },
      );
      if (staffErr) {
        console.error("[confirm-contract-upload] staff authz", staffErr);
        return json({ error: "Could not verify contract access." }, 500);
      }
      isAuthorizedStaff = staffOk === true;
    }

    if (!isOwner && !isAuthorizedStaff) return json({ error: "Forbidden" }, 403);

    // Recruiter contract workflow tools are a Growth/Fleet premium feature.
    const { data: billingRow } = await admin
      .from("recruiter_billing_profiles")
      .select("plan, status")
      .eq("recruiter_id", c.recruiter_id)
      .maybeSingle();
    const planOk = billingRow?.plan === "growth" || billingRow?.plan === "fleet";
    const statusOk = billingRow?.status === "active" || billingRow?.status === "trialing"; // trial-allowlist
    if (!planOk || !statusOk) {
      return json(
        { error: "Growth or Fleet recruiter plan required for contract workflow tools.", code: "recruiter_plan_required" },
        403,
      );
    }


    if (version.upload_status === "uploaded") {
      return json({ ok: true, already: true });
    }

    // Verify the object actually exists in storage
    const folder = version.storage_path.split("/").slice(0, -1).join("/");
    const filename = version.storage_path.split("/").slice(-1)[0];
    const { data: listing, error: listErr } = await admin.storage
      .from(version.storage_bucket || BUCKET)
      .list(folder, { limit: 100, search: filename });
    if (listErr) { console.error("[confirm-contract-upload] storage list", listErr); return json({ error: "Could not verify upload." }, 500); }
    const exists = (listing || []).some((o) => o.name === filename);
    if (!exists) {
      // Mark failed so UI can hide it / allow retry
      await admin
        .from("contract_versions")
        .update({ upload_status: "failed" })
        .eq("id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: "recruiter",
        action: "upload_failed",
        metadata: { reason: "object_not_found", storage_path: version.storage_path },
      });
      return json({ error: "Uploaded file not found in storage" }, 409);
    }

    // Mark uploaded
    const { error: updErr } = await admin
      .from("contract_versions")
      .update({ upload_status: "uploaded", uploaded_at: new Date().toISOString() })
      .eq("id", version_id);
    if (updErr) { console.error("[confirm-contract-upload] version update", updErr); return json({ error: "Could not finalize upload." }, 500); }

    // Phase 5 final hardening:
    // - A newly uploaded+confirmed version becomes the current version and resets
    //   contract status back to 'uploaded' so the driver can re-review.
    // - Only reset from REPLACEABLE statuses. Never overwrite terminal states.
    // - If a newer version is already current, refuse to clobber it (stale confirm).
    const REPLACEABLE_STATUSES = new Set([
      "uploaded",
      "parsing",
      "parsed",
      "ai_reviewed",
      "driver_reviewing",
      "changes_requested",
      "approved",
      "rejected",
    ]);
    const TERMINAL_BLOCKED = new Set(["signed", "expired", "archived"]);

    const { data: prevContract } = await admin
      .from("contracts")
      .select("status, current_version_id")
      .eq("id", version.contract_id)
      .maybeSingle();

    // Look up the currently-promoted version's number (if any) to detect stale confirms.
    let currentVersionNumber: number | null = null;
    if (prevContract?.current_version_id && prevContract.current_version_id !== version_id) {
      const { data: curV } = await admin
        .from("contract_versions")
        .select("version_number, upload_status")
        .eq("id", prevContract.current_version_id)
        .maybeSingle();
      if (curV && curV.upload_status === "uploaded") {
        currentVersionNumber = (curV as any).version_number ?? null;
      }
    }

    // Block if a newer version is already current.
    if (
      currentVersionNumber !== null &&
      typeof (version as any).version_number === "number" &&
      currentVersionNumber > (version as any).version_number
    ) {
      await admin
        .from("contract_versions")
        .update({ upload_status: "failed" })
        .eq("id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: "recruiter",
        action: "upload_failed",
        metadata: {
          reason: "stale_version_confirm",
          this_version_number: (version as any).version_number,
          current_version_number: currentVersionNumber,
          current_version_id: prevContract!.current_version_id,
        },
      });
      return json({ error: "A newer contract version is already active." }, 409);
    }

    // Block if current contract status is terminal — never reset signed/expired/archived.
    if (prevContract?.status && TERMINAL_BLOCKED.has(prevContract.status)) {
      await admin
        .from("contract_versions")
        .update({ upload_status: "failed" })
        .eq("id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: "recruiter",
        action: "upload_failed",
        metadata: {
          reason: "terminal_status_blocked",
          previous_status: prevContract.status,
          previous_version_id: prevContract.current_version_id ?? null,
        },
      });
      return json(
        { error: `Contract status is "${prevContract.status}" and cannot accept a new version.` },
        409,
      );
    }

    // Guarded promotion: require contract status to still be in the replaceable set
    // at write time. If it changed (e.g., became signed/expired/archived) between our
    // read and write, the update affects 0 rows and we refuse to promote.
    const REPLACEABLE_ARRAY = Array.from(REPLACEABLE_STATUSES);
    const updatePayload: Record<string, unknown> = {
      current_version_id: version_id,
      status: "uploaded",
    };

    const { data: updatedRows, error: contractUpdErr } = await admin
      .from("contracts")
      .update(updatePayload)
      .eq("id", version.contract_id)
      .in("status", REPLACEABLE_ARRAY)
      .select("id");

    if (contractUpdErr || !updatedRows || updatedRows.length === 0) {
      await admin
        .from("contract_versions")
        .update({ upload_status: "failed" })
        .eq("id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: "recruiter",
        action: "upload_failed",
        metadata: {
          reason: contractUpdErr ? "promotion_update_error" : "status_changed_before_confirm",
          previous_status: prevContract?.status ?? null,
          previous_version_id: prevContract?.current_version_id ?? null,
          error: contractUpdErr?.message ?? null,
        },
      });
      return json(
        { error: "Contract status changed before this version could be promoted." },
        409,
      );
    }
    const safeToReset = true;

    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: "recruiter",
      action: "uploaded",
      metadata: {
        file_name: version.file_name,
        storage_path: version.storage_path,
        previous_status: prevContract?.status ?? null,
        previous_version_id: prevContract?.current_version_id ?? null,
        status_reset: safeToReset,
      },
    });

    return json({ ok: true, version_id, contract_id: version.contract_id });
  } catch (e) {
    console.error("[confirm-contract-upload] error", e);
    return json({ error: "Server error. Please try again." }, 500);
  }
});
