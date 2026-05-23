// Phase 2: Recruiter contract upload — creates contract + version rows and
// returns a signed storage upload URL. No AI/parsing/signing here.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "contract-documents";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp)$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeName(name: string) {
  const cleaned = name.replace(/[^\w.\-]+/g, "_").slice(-120);
  return cleaned || "contract.pdf";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Authenticate caller
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    // 2. Validate input
    const body = await req.json().catch(() => ({}));
    const application_id = String(body.application_id || "").trim();
    const file_name = safeName(String(body.file_name || ""));
    const mime_type = String(body.mime_type || "").toLowerCase();
    const file_size = Number(body.file_size || 0);
    const titleInput = body.title ? String(body.title).slice(0, 200) : null;

    if (!application_id) return json({ error: "application_id required" }, 400);
    if (!ALLOWED_MIME.has(mime_type)) return json({ error: "Unsupported file type" }, 400);
    if (!ALLOWED_EXT.test(file_name)) return json({ error: "Unsupported file extension" }, 400);
    if (!Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
      return json({ error: `File size must be 1 byte – ${MAX_BYTES} bytes` }, 400);
    }

    // 3. Service-role client for privileged ownership + writes
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 4. Confirm caller is the recruiter who owns this application
    const { data: appRow, error: appErr } = await admin
      .from("opportunity_applications")
      .select(
        "id, opportunity_id, recruiter_id, driver_user_id, recruiter_profiles:recruiter_id(user_id, status, verification_status)"
      )
      .eq("id", application_id)
      .maybeSingle();

    if (appErr) return json({ error: appErr.message }, 500);
    if (!appRow) return json({ error: "Application not found" }, 404);

    const rp = (appRow as any).recruiter_profiles;
    if (
      !rp ||
      rp.user_id !== userId ||
      rp.status === "suspended" ||
      rp.verification_status === "suspended" ||
      rp.verification_status !== "approved"
    ) {
      return json({ error: "Not authorized for this application" }, 403);
    }

    // Recruiter contract workflow tools are a Growth/Fleet premium feature.
    const { data: billingRow } = await admin
      .from("recruiter_billing_profiles")
      .select("plan, status")
      .eq("recruiter_id", appRow.recruiter_id)
      .maybeSingle();
    const planOk = billingRow?.plan === "growth" || billingRow?.plan === "fleet";
    const statusOk = billingRow?.status === "active" || billingRow?.status === "trialing";
    if (!planOk || !statusOk) {
      return json(
        { error: "Growth or Fleet recruiter plan required for contract workflow tools.", code: "recruiter_plan_required" },
        403,
      );
    }

    // 5. Find or create the contract row for this application
    const { data: existing, error: existingErr } = await admin
      .from("contracts")
      .select("id")
      .eq("application_id", application_id)
      .maybeSingle();
    if (existingErr) return json({ error: existingErr.message }, 500);

    let contractId = existing?.id as string | undefined;

    if (!contractId) {
      const { data: created, error: createErr } = await admin
        .from("contracts")
        .insert({
          application_id,
          opportunity_id: appRow.opportunity_id,
          recruiter_id: appRow.recruiter_id,
          recruiter_user_id: userId,
          driver_user_id: appRow.driver_user_id,
          status: "uploaded",
          title: titleInput,
        })
        .select("id")
        .single();
      if (createErr || !created) return json({ error: createErr?.message || "Create failed" }, 500);
      contractId = created.id;
    }

    // 6. Determine next version number
    const { data: versionAgg, error: aggErr } = await admin
      .from("contract_versions")
      .select("version_number")
      .eq("contract_id", contractId)
      .order("version_number", { ascending: false })
      .limit(1);
    if (aggErr) return json({ error: aggErr.message }, 500);
    const nextVersion = (versionAgg?.[0]?.version_number ?? 0) + 1;

    // 7. Insert contract_versions row (service role bypasses field guard)
    const versionId = crypto.randomUUID();
    const storagePath = `contracts/${application_id}/${contractId}/${versionId}/${file_name}`;

    const { error: versionInsertErr } = await admin
      .from("contract_versions")
      .insert({
        id: versionId,
        contract_id: contractId,
        version_number: nextVersion,
        storage_bucket: BUCKET,
        storage_path: storagePath,
        file_name,
        file_size,
        mime_type,
        parse_status: "pending",
        upload_status: "pending_upload",
        uploaded_by: userId,
      });
    if (versionInsertErr) return json({ error: versionInsertErr.message }, 500);

    // NOTE: current_version_id and contract status are NOT promoted here.
    // The client must call confirm-contract-upload after the storage PUT
    // succeeds. That keeps the driver from seeing a contract whose file
    // never actually arrived in storage.

    // Audit: upload started (pending object PUT + confirm)
    await admin.from("contract_audit_log").insert({
      contract_id: contractId,
      version_id: versionId,
      actor_user_id: userId,
      actor_role: "recruiter",
      action: "upload_started",
      metadata: { file_name, mime_type, file_size, version_number: nextVersion },
    });

    // 10. Generate a signed upload URL for the client to PUT the file
    const { data: signed, error: signedErr } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signedErr || !signed) return json({ error: signedErr?.message || "Sign failed" }, 500);

    return json({
      contract_id: contractId,
      version_id: versionId,
      version_number: nextVersion,
      storage_path: storagePath,
      signed_upload_url: signed.signedUrl,
      token: signed.token,
    });
  } catch (e) {
    console.error("[upload-contract] error", e);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
