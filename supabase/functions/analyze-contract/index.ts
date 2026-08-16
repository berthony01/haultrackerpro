// Phase 4: AI-powered contract risk review.
// - Auth: owning recruiter, assigned driver, admin (or service role).
// - Requires version.upload_status='uploaded' AND parse_status='parsed' AND extracted_text.
// - Calls Lovable AI Gateway with a structured tool for risk findings.
// - Persists: contracts.risk_score/risk_tier (+ status='ai_reviewed' from 'parsed' only),
//   contract_clauses rows, contract_reviews row (reviewer_role='ai').
// - Audit: ai_review_started / ai_review_completed / ai_review_failed (service-role).
// - Idempotent: re-call returns existing analysis unless force=true (admin only).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PROMPT_CHARS = 120_000;

const CLAUSE_TYPES = [
  "escrow",
  "deductions",
  "chargebacks",
  "pay_withholding",
  "payment_timing",
  "forced_dispatch",
  "termination_penalties",
  "maintenance_responsibility",
  "equipment_liability",
  "insurance_responsibility",
  "company_discretion",
  "lease_purchase_risk",
  "non_compete",
  "non_solicit",
  "refund_conditions",
  "unfair_driver_liability",
  "other",
] as const;

const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
const RISK_TIERS = ["low", "moderate", "elevated", "high", "severe"] as const;

const SYSTEM_PROMPT = `You are a contract risk educator helping owner-operator truck drivers understand carrier/lease/owner-operator/independent-contractor agreements BEFORE they sign.

Rules — read carefully:
- You are NOT a lawyer. You do NOT give legal advice.
- NEVER state a contract is legally valid, legally enforceable, legally binding, or legally invalid.
- NEVER tell the driver to sign or not to sign.
- Use careful, educational language: "this may be a risk", "this section is unusual", "consider asking the company about...", "you may want a qualified professional to review this".
- Always include an excerpt (raw_excerpt) copied from the contract to support each finding. Keep excerpts under 600 characters.
- Detect items in these categories where present: escrow, deductions, chargebacks, pay withholding, payment timing, forced dispatch, termination penalties, maintenance responsibility, equipment liability, insurance responsibility, vague company discretion language, lease-purchase risk, non-compete, non-solicit, refund conditions, unfair driver liability.
- Severity scale: info, low, medium, high, critical. Reserve "critical" for clauses that could cause meaningful financial harm to a driver (e.g., large escrow with vague refund, broad chargebacks, one-sided termination penalties, unlimited driver liability).
- risk_score is 0-100 where higher = riskier for the driver. Compute holistically from the clauses you found.
- risk_tier: low (0-19), moderate (20-39), elevated (40-59), high (60-79), severe (80-100).
- Return ONLY by calling the provided tool. No prose.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "report_contract_risk",
    description: "Return a structured driver-friendly risk review of the contract.",
    parameters: {
      type: "object",
      properties: {
        risk_score: { type: "number", description: "0-100, higher = riskier for the driver." },
        risk_tier: { type: "string", enum: RISK_TIERS as unknown as string[] },
        plain_summary: {
          type: "string",
          description:
            "2-4 sentence plain-English summary for a working truck driver. Educational, non-legal.",
        },
        top_red_flags: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
          description: "Up to 5 short bullet phrases naming the biggest concerns.",
        },
        clauses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              clause_type: { type: "string", enum: CLAUSE_TYPES as unknown as string[] },
              severity: { type: "string", enum: SEVERITIES as unknown as string[] },
              summary: { type: "string", description: "1-2 sentences explaining the clause to a driver." },
              raw_excerpt: { type: "string", description: "Copied excerpt from the contract." },
              recommendation: {
                type: "string",
                description:
                  "Educational suggestion (e.g., 'Consider asking the company...', 'You may want a qualified professional to review...').",
              },
            },
            required: ["clause_type", "severity", "summary", "raw_excerpt", "recommendation"],
          },
        },
      },
      required: ["risk_score", "risk_tier", "plain_summary", "top_red_flags", "clauses"],
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clampTier(tier: string, score: number): string {
  const t = (tier || "").toLowerCase();
  if ((RISK_TIERS as readonly string[]).includes(t)) return t;
  if (score >= 80) return "severe";
  if (score >= 60) return "high";
  if (score >= 40) return "elevated";
  if (score >= 20) return "moderate";
  return "low";
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const version_id = String(body.version_id || "").trim();
    const force = !!body.force;
    if (!version_id) return json({ error: "version_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: version, error: vErr } = await admin
      .from("contract_versions")
      .select(
        "id, contract_id, upload_status, parse_status, extracted_text, contracts:contract_id(id, status, recruiter_user_id, recruiter_id, driver_user_id, current_version_id)"
      )
      .eq("id", version_id)
      .maybeSingle();
    if (vErr) return json({ error: vErr.message }, 500);
    if (!version) return json({ error: "Version not found" }, 404);

    const c: any = (version as any).contracts;
    if (!c) return json({ error: "Contract not found" }, 404);

    const { data: adminRow } = await admin
      .from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
    const isAdmin = !!adminRow;
    const isRecruiterOwner = c.recruiter_user_id === userId;
    const isDriver = c.driver_user_id === userId;

    // Phase RC-1G — recruiter STAFF may trigger/retrieve recruiter-side AI
    // analysis ONLY with `contracts_manage`. Never a role label. View-only
    // (`contracts_view`) staff resolve to false here and are rejected below,
    // so they can neither trigger nor retrieve analysis through this function.
    // Driver behavior is unchanged.
    let isAuthorizedStaff = false;
    if (!isAdmin && !isRecruiterOwner && !isDriver) {
      const { data: staffOk, error: staffErr } = await userClient.rpc(
        "current_user_can_recruiter_contract_action",
        { _recruiter_id: c.recruiter_id, _permission: "contracts_manage" },
      );
      if (staffErr) {
        console.error("[analyze-contract] staff authz", staffErr);
        return json({ error: "Could not verify contract access." }, 500);
      }
      isAuthorizedStaff = staffOk === true;
    }

    const isRecruiter = isRecruiterOwner || isAuthorizedStaff;
    if (!isAdmin && !isRecruiter && !isDriver) return json({ error: "Forbidden" }, 403);
    const actorRole: "admin" | "recruiter" | "driver" = isAdmin ? "admin" : isRecruiter ? "recruiter" : "driver";

    // force re-analysis stays ADMIN-ONLY. Recruiter staff never gain it.
    if (force && !isAdmin) return json({ error: "Only admin can force re-analysis" }, 403);

    if (version.upload_status !== "uploaded")
      return json({ error: "Version is not uploaded" }, 409);
    if (version.parse_status !== "parsed")
      return json({ error: "Version text has not been extracted yet" }, 409);
    const text = (version.extracted_text || "").trim();
    if (!text) return json({ error: "No extracted text to analyze" }, 422);

    // Recruiter Growth/Fleet eligibility — checked BEFORE returning existing reviews
    // so non-eligible recruiters cannot retrieve cached AI analyses for contract
    // workflow tools. Drivers and admins are unaffected. // trial-allowlist
    if (isRecruiter && !isAdmin) {
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


    // Idempotency: existing AI review for this version
    const { data: existing } = await admin
      .from("contract_reviews")
      .select("id, ai_summary, ai_findings, created_at")
      .eq("contract_id", version.contract_id)
      .eq("version_id", version_id)
      .eq("reviewer_role", "ai")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && !force) {
      return json({ ok: true, already: true, review: existing });
    }

    // Drivers cannot trigger NEW analyses, only view existing — keep AI cost on recruiters/admins.
    if (!existing && !isRecruiter && !isAdmin) {
      return json({ error: "AI analysis has not been run for this contract yet" }, 404);
    }

    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "ai_review_started",
      metadata: { force, text_chars: text.length },
    });

    const truncated = text.length > MAX_PROMPT_CHARS;
    const prompt = truncated ? text.slice(0, MAX_PROMPT_CHARS) : text;

    let parsed: any = null;
    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Review the following contract text for an owner-operator truck driver.${
                truncated ? " (Text was truncated for length.)" : ""
              }\n\n---BEGIN CONTRACT---\n${prompt}\n---END CONTRACT---`,
            },
          ],
          tools: [TOOL],
          tool_choice: { type: "function", function: { name: "report_contract_risk" } },
        }),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        if (aiRes.status === 429) throw new Error("AI rate limit exceeded. Please try again shortly.");
        if (aiRes.status === 402) throw new Error("AI credits exhausted. Please contact support.");
        throw new Error(`AI gateway error ${aiRes.status}: ${errText.slice(0, 300)}`);
      }
      const data = await aiRes.json();
      const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
      if (!tc?.function?.arguments) throw new Error("AI did not return structured findings");
      parsed = JSON.parse(tc.function.arguments);
    } catch (e) {
      const msg = (e as Error).message || "AI analysis failed";
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "ai_review_failed",
        metadata: { reason: msg },
      });
      return json({ error: msg }, 502);
    }

    // Sanitize
    const score = Math.max(0, Math.min(100, Number(parsed.risk_score ?? 0)));
    const tier = clampTier(String(parsed.risk_tier || ""), score);
    const summary = String(parsed.plain_summary || "").slice(0, 4000);
    const redFlags: string[] = Array.isArray(parsed.top_red_flags)
      ? parsed.top_red_flags.slice(0, 5).map((s: unknown) => String(s).slice(0, 240))
      : [];
    const clauses: any[] = Array.isArray(parsed.clauses) ? parsed.clauses : [];

    // If forced re-run, clear previous AI clauses + reviews for this version
    if (force) {
      await admin.from("contract_clauses").delete().eq("version_id", version_id);
      await admin
        .from("contract_reviews")
        .delete()
        .eq("contract_id", version.contract_id)
        .eq("version_id", version_id)
        .eq("reviewer_role", "ai");
    }

    // Insert clauses (capped)
    const clauseRows = clauses.slice(0, 50).map((cl) => {
      const ct = String(cl.clause_type || "other");
      const sev = String(cl.severity || "info").toLowerCase();
      return {
        contract_id: version.contract_id,
        version_id,
        clause_type: (CLAUSE_TYPES as readonly string[]).includes(ct) ? ct : "other",
        severity: (SEVERITIES as readonly string[]).includes(sev) ? sev : "info",
        summary: String(cl.summary || "").slice(0, 2000),
        raw_excerpt: String(cl.raw_excerpt || "").slice(0, 2000),
        metadata: { recommendation: String(cl.recommendation || "").slice(0, 1000) },
      };
    });
    if (clauseRows.length) {
      const { error: clErr } = await admin.from("contract_clauses").insert(clauseRows);
      if (clErr) console.error("[analyze-contract] clauses insert error", clErr);
    }

    const findings = {
      risk_score: score,
      risk_tier: tier,
      top_red_flags: redFlags,
      clause_count: clauseRows.length,
      truncated,
      model: "google/gemini-2.5-pro",
      generated_at: new Date().toISOString(),
    };

    const { data: reviewRow, error: rvErr } = await admin
      .from("contract_reviews")
      .insert({
        contract_id: version.contract_id,
        version_id,
        reviewer_role: "ai",
        ai_summary: summary,
        ai_findings: findings,
        notes: redFlags.join(" • ").slice(0, 4000) || null,
      })
      .select("id")
      .single();
    if (rvErr || !reviewRow) {
      console.error("[analyze-contract] review insert error", rvErr);
      // Best-effort: clear clauses we just inserted so UI doesn't show partial state
      await admin.from("contract_clauses").delete().eq("version_id", version_id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: actorRole,
        action: "ai_review_failed",
        metadata: { reason: rvErr?.message || "review insert failed" },
      });
      return json({ error: rvErr?.message || "Could not save AI review" }, 500);
    }

    // Update contract risk fields; only advance status from 'parsed' → 'ai_reviewed'.
    await admin
      .from("contracts")
      .update({ risk_score: score, risk_tier: tier })
      .eq("id", version.contract_id);
    await admin
      .from("contracts")
      .update({ status: "ai_reviewed" })
      .eq("id", version.contract_id)
      .eq("status", "parsed");

    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: actorRole,
      action: "ai_review_completed",
      metadata: {
        risk_score: score,
        risk_tier: tier,
        clause_count: clauseRows.length,
        truncated,
        review_id: reviewRow?.id ?? null,
      },
    });

    return json({
      ok: true,
      already: false,
      review: { id: reviewRow?.id, ai_summary: summary, ai_findings: findings },
      clauses: clauseRows.length,
    });
  } catch (e) {
    console.error("[analyze-contract] error", e);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
