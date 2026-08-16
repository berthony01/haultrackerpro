// Phase 3: Extract readable text from an uploaded contract version.
// Authorized callers: assigned driver, owning recruiter, or admin. The
// service role inside this function is the ONLY writer of extracted_text /
// parse_status (clients are blocked by `contract_versions_field_guard`).
//
// Supported formats today:
//   - application/pdf   → text extracted with `unpdf` (works in Deno)
//   - text/plain        → raw bytes decoded as UTF-8
//   - image/*           → marked as "failed" with parse_error explaining
//                         OCR is not yet available (image fallback is a
//                         future Phase 3.5 enhancement).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET_DEFAULT = "contract-documents";
const MAX_TEXT_CHARS = 500_000; // safety cap

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
        "id, contract_id, storage_bucket, storage_path, file_name, mime_type, upload_status, parse_status, contracts:contract_id(id, recruiter_user_id, driver_user_id, recruiter_id, application_id, status)"
      )
      .eq("id", version_id)
      .maybeSingle();
    if (vErr) return json({ error: vErr.message }, 500);
    if (!version) return json({ error: "Version not found" }, 404);

    const c = (version as any).contracts;
    if (!c) return json({ error: "Contract not found" }, 404);

    // Authorization: only the owning recruiter, an authorized recruiter staff
    // member with `contracts_manage` (Phase RC-1G), or an admin may trigger
    // parsing. Drivers can VIEW the contract but cannot start parse jobs
    // (Phase 3 hardening) — unchanged.
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const isAdmin = !!adminRow;
    const isRecruiterOwner = c.recruiter_user_id === userId;

    // Never a role label: the helper requires active membership + posting
    // readiness + explicit `contracts_manage` + standalone Growth/Fleet
    // billing, evaluated with the real staff auth.uid().
    let isAuthorizedStaff = false;
    if (!isAdmin && !isRecruiterOwner) {
      const { data: staffOk, error: staffErr } = await userClient.rpc(
        "current_user_can_recruiter_contract_action",
        { _recruiter_id: c.recruiter_id, _permission: "contracts_manage" },
      );
      if (staffErr) {
        console.error("[parse-contract] staff authz", staffErr);
        return json({ error: "Could not verify contract access." }, 500);
      }
      isAuthorizedStaff = staffOk === true;
    }

    const isRecruiter = isRecruiterOwner || isAuthorizedStaff;
    if (!isAdmin && !isRecruiter) {
      return json({ error: "Forbidden" }, 403);
    }
    const actorRole: "admin" | "recruiter" = isAdmin ? "admin" : "recruiter";

    // Recruiter-side contract workflow is Growth/Fleet only. Admins bypass.
    if (!isAdmin) {
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
    }


    if (version.upload_status !== "uploaded") {
      return json({ error: "Version is not uploaded yet" }, 409);
    }

    // Idempotency: already parsed → no duplicate audit
    if (version.parse_status === "parsed") {
      return json({ ok: true, already: true, parse_status: "parsed" });
    }

    // Race protection: another parse already in flight
    if (version.parse_status === "parsing") {
      return json({ ok: true, already: true, parse_status: "parsing", message: "Already parsing" }, 200);
    }

    // Forward-only contract status guard. Only move uploaded → parsing.
    // Never regress from later states (ai_reviewed, driver_reviewing,
    // changes_requested, rejected, approved, signed, expired, archived).
    const PRE_PARSE_STATUSES = new Set(["uploaded"]);
    const canAdvanceToParsing = PRE_PARSE_STATUSES.has(c.status);

    // Mark version parsing
    await admin
      .from("contract_versions")
      .update({ parse_status: "parsing", parse_error: null })
      .eq("id", version_id);

    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "parse_started",
      metadata: {
        mime_type: version.mime_type,
        triggered_by: actorRole,
        contract_status_before: c.status,
        advanced_contract_status: canAdvanceToParsing,
      },
    });

    if (canAdvanceToParsing) {
      await admin
        .from("contracts")
        .update({ status: "parsing" })
        .eq("id", version.contract_id);
    }


    // Download file
    const bucket = version.storage_bucket || BUCKET_DEFAULT;
    const { data: blob, error: dlErr } = await admin.storage
      .from(bucket)
      .download(version.storage_path);
    if (dlErr || !blob) {
      const msg = dlErr?.message || "Could not download contract file";
      await admin
        .from("contract_versions")
        .update({ parse_status: "failed", parse_error: msg })
        .eq("id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "parse_failed",
        metadata: { reason: msg, triggered_by: actorRole },
      });
      return json({ error: msg }, 500);
    }

    let extracted = "";
    let pageCount: number | null = null;
    const mime = (version.mime_type || "").toLowerCase();

    try {
      if (mime === "application/pdf" || version.file_name?.toLowerCase().endsWith(".pdf")) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const pdf = await getDocumentProxy(buf);
        const result = await extractText(pdf, { mergePages: true });
        const text = Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text || "");
        extracted = text;
        pageCount = (result as any).totalPages ?? null;
      } else if (mime.startsWith("text/")) {
        extracted = await blob.text();
      } else if (mime.startsWith("image/")) {
        throw new Error("Image OCR is not enabled yet. Please upload a PDF.");
      } else {
        throw new Error(`Unsupported mime type for parsing: ${mime || "unknown"}`);
      }

      const cleaned = (extracted || "").replace(/\u0000/g, "").trim();
      if (!cleaned) {
        throw new Error("No readable text found in document (possibly a scanned PDF).");
      }
      const truncated = cleaned.length > MAX_TEXT_CHARS;
      const finalText = truncated ? cleaned.slice(0, MAX_TEXT_CHARS) : cleaned;

      const { error: updErr } = await admin
        .from("contract_versions")
        .update({
          parse_status: "parsed",
          parse_error: null,
          extracted_text: finalText,
        })
        .eq("id", version_id);
      if (updErr) throw new Error(updErr.message);

      // Forward-only: only advance contract.status parsing → parsed.
      // Never regress from ai_reviewed / driver_reviewing / changes_requested
      // / approved / rejected / signed / expired / archived.
      await admin
        .from("contracts")
        .update({ status: "parsed" })
        .eq("id", version.contract_id)
        .eq("status", "parsing");

      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "parse_completed",
        metadata: {
          characters: finalText.length,
          truncated,
          page_count: pageCount,
          triggered_by: actorRole,
        },
      });

      return json({
        ok: true,
        parse_status: "parsed",
        characters: finalText.length,
        truncated,
        page_count: pageCount,
      });
    } catch (e) {
      const msg = (e as Error).message || "Parsing failed";
      await admin
        .from("contract_versions")
        .update({ parse_status: "failed", parse_error: msg })
        .eq("id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "parse_failed",
        metadata: { reason: msg, triggered_by: actorRole },
      });
      return json({ error: msg, parse_status: "failed" }, 422);
    }
  } catch (e) {
    console.error("[parse-contract] error", e);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
