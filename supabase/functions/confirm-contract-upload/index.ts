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
        "id, contract_id, storage_bucket, storage_path, file_name, upload_status, contracts:contract_id(id, recruiter_user_id, recruiter_id, application_id)"
      )
      .eq("id", version_id)
      .maybeSingle();
    if (vErr) return json({ error: vErr.message }, 500);
    if (!version) return json({ error: "Version not found" }, 404);

    const c = (version as any).contracts;
    if (!c) return json({ error: "Contract not found" }, 404);
    if (c.recruiter_user_id !== userId) return json({ error: "Forbidden" }, 403);

    // Cross-check recruiter profile is still in good standing
    const { data: rp } = await admin
      .from("recruiter_profiles")
      .select("user_id, status, verification_status")
      .eq("id", c.recruiter_id)
      .maybeSingle();
    if (
      !rp ||
      rp.user_id !== userId ||
      rp.status === "suspended" ||
      rp.verification_status === "suspended" ||
      rp.verification_status !== "approved"
    ) {
      return json({ error: "Not authorized" }, 403);
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
    if (listErr) return json({ error: listErr.message }, 500);
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
    if (updErr) return json({ error: updErr.message }, 500);

    // Phase 5 hardening: a newly uploaded+confirmed version becomes the current
    // version and resets contract status back to 'uploaded' so the driver can
    // re-review even if the prior version was approved/rejected/changes_requested.
    // Service-role bypasses contracts_status_guard, so backward transitions are allowed here.
    // Old contract_reviews/contract_clauses rows are kept intact (history preserved);
    // the UI scopes display by current_version_id.
    const { data: prevContract } = await admin
      .from("contracts")
      .select("status, current_version_id")
      .eq("id", version.contract_id)
      .maybeSingle();

    const { error: contractUpdErr } = await admin
      .from("contracts")
      .update({ current_version_id: version_id, status: "uploaded" })
      .eq("id", version.contract_id);
    if (contractUpdErr) {
      // Should not happen with service role; fall back to at least promoting the version pointer.
      await admin
        .from("contracts")
        .update({ current_version_id: version_id })
        .eq("id", version.contract_id);
    }

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
        status_reset: true,
      },
    });

    return json({ ok: true, version_id, contract_id: version.contract_id });
  } catch (e) {
    console.error("[confirm-contract-upload] error", e);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
