// Phase 6: Admin Contract Moderation API
// Admin-only endpoint for browsing, viewing, and moderating contracts.
// Service-role privileged. Rejects non-admin callers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SIGNED_URL_TTL = 60 * 5; // 5 minutes
const BUCKET = "contract-documents";
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const adminDb = createClient(supabaseUrl, serviceRoleKey);

    // Admin check
    const { data: adminRow } = await adminDb
      .from("admin_users")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (!adminRow) return json({ error: "Forbidden" }, 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    // ============ LIST ============
    if (action === "list-contracts") {
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") || String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT,
        PAGE_SIZE_MAX,
      );
      const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
      const offset = (page - 1) * limit;

      const filter = url.searchParams.get("filter") || "all";
      const recruiterId = url.searchParams.get("recruiter_id");
      const dateFrom = url.searchParams.get("date_from");
      const dateTo = url.searchParams.get("date_to");

      let q = adminDb
        .from("contracts")
        .select(
          "id, status, risk_score, risk_tier, title, application_id, opportunity_id, recruiter_id, recruiter_user_id, driver_user_id, current_version_id, created_at, updated_at, metadata",
          { count: "exact" },
        )
        .order("updated_at", { ascending: false });

      switch (filter) {
        case "high_risk":
          q = q.in("risk_tier", ["high", "severe"]);
          break;
        case "rejected":
          q = q.eq("status", "rejected");
          break;
        case "changes_requested":
          q = q.eq("status", "changes_requested");
          break;
        case "approved":
          q = q.eq("status", "approved");
          break;
        case "missing_ai_review":
          q = q.is("risk_tier", null);
          break;
        case "failed_parse":
          // We need a join; fall through and post-filter after fetching versions.
          break;
      }
      if (recruiterId) q = q.eq("recruiter_id", recruiterId);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo);

      const { data: contracts, error, count } = await q.range(offset, offset + limit - 1);
      if (error) return json({ error: error.message }, 500);

      const list = contracts ?? [];
      const versionIds = Array.from(
        new Set(list.map((c) => c.current_version_id).filter((v): v is string => !!v)),
      );
      const recruiterIds = Array.from(new Set(list.map((c) => c.recruiter_id).filter(Boolean)));
      const driverIds = Array.from(new Set(list.map((c) => c.driver_user_id).filter(Boolean)));
      const oppIds = Array.from(new Set(list.map((c) => c.opportunity_id).filter(Boolean)));
      const appIds = Array.from(new Set(list.map((c) => c.application_id).filter(Boolean)));
      const contractIds = list.map((c) => c.id);

      const [versionsRes, recruitersRes, driversRes, oppsRes, appsRes, aiReviewsRes, driverReviewsRes] =
        await Promise.all([
          versionIds.length
            ? adminDb
                .from("contract_versions")
                .select("id, version_number, uploaded_at, parse_status, upload_status, file_name, page_count, file_size, mime_type")
                .in("id", versionIds)
            : Promise.resolve({ data: [], error: null }),
          recruiterIds.length
            ? adminDb
                .from("recruiter_profiles")
                .select("id, company_name, recruiter_email, recruiter_name, status, verification_status")
                .in("id", recruiterIds)
            : Promise.resolve({ data: [], error: null }),
          driverIds.length
            ? adminDb
                .from("profiles")
                .select("user_id, display_name, driver_handle")
                .in("user_id", driverIds)
            : Promise.resolve({ data: [], error: null }),
          oppIds.length
            ? adminDb.from("opportunities").select("id, title, company_name").in("id", oppIds)
            : Promise.resolve({ data: [], error: null }),
          appIds.length
            ? adminDb
                .from("opportunity_applications")
                .select("id, driver_email_snapshot")
                .in("id", appIds)
            : Promise.resolve({ data: [], error: null }),
          contractIds.length
            ? adminDb
                .from("contract_reviews")
                .select("id, contract_id, version_id, decision, ai_summary, ai_findings, notes, created_at")
                .in("contract_id", contractIds)
                .eq("reviewer_role", "ai")
            : Promise.resolve({ data: [], error: null }),
          contractIds.length
            ? adminDb
                .from("contract_reviews")
                .select("id, contract_id, version_id, decision, notes, created_at")
                .in("contract_id", contractIds)
                .eq("reviewer_role", "driver")
            : Promise.resolve({ data: [], error: null }),
        ]);

      const versionMap = new Map((versionsRes.data ?? []).map((v: any) => [v.id, v]));
      const recruiterMap = new Map((recruitersRes.data ?? []).map((r: any) => [r.id, r]));
      const driverMap = new Map((driversRes.data ?? []).map((d: any) => [d.id, d]));
      const oppMap = new Map((oppsRes.data ?? []).map((o: any) => [o.id, o]));
      // Index reviews by `${contract_id}:${version_id}` for current-version match
      const aiByCv = new Map<string, any>();
      for (const r of (aiReviewsRes.data ?? []) as any[]) {
        aiByCv.set(`${r.contract_id}:${r.version_id}`, r);
      }
      const drvByCv = new Map<string, any>();
      for (const r of (driverReviewsRes.data ?? []) as any[]) {
        drvByCv.set(`${r.contract_id}:${r.version_id}`, r);
      }

      let rows = list.map((c) => {
        const v = c.current_version_id ? versionMap.get(c.current_version_id) : null;
        const ai = c.current_version_id ? aiByCv.get(`${c.id}:${c.current_version_id}`) : null;
        const drv = c.current_version_id ? drvByCv.get(`${c.id}:${c.current_version_id}`) : null;
        const findings = (ai?.ai_findings as any) || {};
        return {
          id: c.id,
          status: c.status,
          risk_score: c.risk_score,
          risk_tier: c.risk_tier,
          title: c.title,
          created_at: c.created_at,
          updated_at: c.updated_at,
          recruiter: recruiterMap.get(c.recruiter_id) || null,
          driver: driverMap.get(c.driver_user_id) || null,
          opportunity: oppMap.get(c.opportunity_id) || null,
          current_version: v
            ? {
                id: v.id,
                version_number: v.version_number,
                uploaded_at: v.uploaded_at,
                parse_status: v.parse_status,
                upload_status: v.upload_status,
                file_name: v.file_name,
                page_count: v.page_count,
              }
            : null,
          ai_review: ai
            ? {
                id: ai.id,
                summary: ai.ai_summary,
                top_flags: Array.isArray(findings.top_flags) ? findings.top_flags.slice(0, 5) : [],
                created_at: ai.created_at,
              }
            : null,
          driver_review: drv
            ? { id: drv.id, decision: drv.decision, note: drv.notes, created_at: drv.created_at }
            : null,
        };
      });

      if (filter === "failed_parse") {
        rows = rows.filter((r) => r.current_version?.parse_status === "failed");
      }

      return json({ contracts: rows, page, limit, total: count ?? rows.length });
    }

    // ============ DETAIL ============
    if (action === "get-contract") {
      const contractId = url.searchParams.get("contract_id");
      if (!contractId) return json({ error: "contract_id required" }, 400);

      const { data: c, error: cErr } = await adminDb
        .from("contracts")
        .select("*")
        .eq("id", contractId)
        .maybeSingle();
      if (cErr || !c) return json({ error: "Contract not found" }, 404);

      const [versions, reviews, clauses, audit, recruiter, driver, opp] = await Promise.all([
        adminDb.from("contract_versions").select("*").eq("contract_id", contractId).order("version_number", { ascending: false }),
        adminDb.from("contract_reviews").select("*").eq("contract_id", contractId).order("created_at", { ascending: false }),
        c.current_version_id
          ? adminDb.from("contract_clauses").select("*").eq("version_id", c.current_version_id).order("severity", { ascending: false })
          : Promise.resolve({ data: [] }),
        adminDb.from("contract_audit_log").select("*").eq("contract_id", contractId).order("created_at", { ascending: false }).limit(200),
        adminDb.from("recruiter_profiles").select("id, company_name, contact_email, contact_name, status, verification_status").eq("id", c.recruiter_id).maybeSingle(),
        adminDb.from("profiles").select("id, email, display_name").eq("id", c.driver_user_id).maybeSingle(),
        adminDb.from("opportunities").select("id, title, company_name").eq("id", c.opportunity_id).maybeSingle(),
      ]);

      return json({
        contract: c,
        versions: versions.data ?? [],
        reviews: reviews.data ?? [],
        clauses: clauses.data ?? [],
        audit: audit.data ?? [],
        recruiter: recruiter.data ?? null,
        driver: driver.data ?? null,
        opportunity: opp.data ?? null,
      });
    }

    // ============ SIGNED URL (admin view) ============
    if (action === "view-file" && req.method === "POST") {
      const versionId = String(body.version_id || "");
      if (!versionId) return json({ error: "version_id required" }, 400);
      const { data: v, error: vErr } = await adminDb
        .from("contract_versions")
        .select("id, contract_id, storage_path, upload_status")
        .eq("id", versionId)
        .maybeSingle();
      if (vErr || !v) return json({ error: "Version not found" }, 404);
      if (v.upload_status !== "uploaded") return json({ error: "Version not uploaded" }, 409);

      const { data: signed, error: sErr } = await adminDb.storage
        .from(BUCKET)
        .createSignedUrl(v.storage_path, SIGNED_URL_TTL);
      if (sErr || !signed?.signedUrl) return json({ error: sErr?.message || "Sign failed" }, 500);

      await adminDb.from("contract_audit_log").insert({
        contract_id: v.contract_id,
        version_id: v.id,
        actor_user_id: userId,
        actor_role: "admin",
        action: "admin_viewed",
        metadata: { ttl_seconds: SIGNED_URL_TTL },
      });
      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "contract-view-file",
        metadata: { contract_id: v.contract_id, version_id: v.id },
      });

      return json({ signed_url: signed.signedUrl, expires_in: SIGNED_URL_TTL });
    }

    // ============ MARK ARCHIVED / EXPIRED ============
    if ((action === "mark-archived" || action === "mark-expired") && req.method === "POST") {
      const contractId = String(body.contract_id || "");
      const note = body.note ? String(body.note).slice(0, 2000) : null;
      if (!contractId) return json({ error: "contract_id required" }, 400);

      const newStatus = action === "mark-archived" ? "archived" : "expired";

      const { data: existing, error: exErr } = await adminDb
        .from("contracts")
        .select("id, status, current_version_id")
        .eq("id", contractId)
        .maybeSingle();
      if (exErr || !existing) return json({ error: "Contract not found" }, 404);

      // Service role bypasses contracts_status_guard, so transition is allowed.
      const { error: updErr } = await adminDb
        .from("contracts")
        .update({ status: newStatus })
        .eq("id", contractId);
      if (updErr) return json({ error: updErr.message }, 500);

      await adminDb.from("contract_audit_log").insert({
        contract_id: contractId,
        version_id: existing.current_version_id ?? null,
        actor_user_id: userId,
        actor_role: "admin",
        action: newStatus, // 'archived' | 'expired' (already reserved actions)
        metadata: { previous_status: existing.status, note },
      });
      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: `contract-${newStatus}`,
        metadata: { contract_id: contractId, previous_status: existing.status, note },
      });

      return json({ ok: true, status: newStatus });
    }

    // ============ ADD ADMIN NOTE ============
    if (action === "add-note" && req.method === "POST") {
      const contractId = String(body.contract_id || "");
      const note = String(body.note || "").trim();
      if (!contractId) return json({ error: "contract_id required" }, 400);
      if (!note || note.length < 2) return json({ error: "note required" }, 400);
      if (note.length > 4000) return json({ error: "note too long" }, 400);

      const { data: c, error: cErr } = await adminDb
        .from("contracts")
        .select("id, current_version_id")
        .eq("id", contractId)
        .maybeSingle();
      if (cErr || !c) return json({ error: "Contract not found" }, 404);

      await adminDb.from("contract_audit_log").insert({
        contract_id: contractId,
        version_id: c.current_version_id ?? null,
        actor_user_id: userId,
        actor_role: "admin",
        action: "admin_note_added",
        metadata: { note },
      });
      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "contract-add-note",
        metadata: { contract_id: contractId, note },
      });

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
