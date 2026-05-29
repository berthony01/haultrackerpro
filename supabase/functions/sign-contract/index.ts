// Phase 8: Simple in-app driver signature.
// - Auth: only the assigned driver may sign (recruiters/admins MAY NOT sign for the driver in this phase).
// - Requires:
//     * version exists, upload_status='uploaded', is the contract's CURRENT version
//     * contract.status = 'approved'
//     * driver has already submitted a 'driver' contract_review with decision='approved' on this version
// - Inserts contract_signatures (typed name + consent + ts + ip/ua), advances contract.status to 'signed'.
// - Idempotent: duplicate signature for same (contract, version, signer, role) returns 409.
// - Audits 'signed' (system-only action via service role) and 'sign_failed' on failure.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim().slice(0, 64) || null;
  const real = req.headers.get("x-real-ip");
  return real ? real.slice(0, 64) : null;
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
    const typed_name = String(body.typed_name || "").trim().slice(0, 200);
    const consent = body.consent === true;
    if (!version_id) return json({ error: "version_id required" }, 400);
    if (!typed_name || typed_name.length < 2) {
      return json({ error: "Please type your full legal name to sign." }, 400);
    }
    if (!consent) {
      return json({ error: "You must check the consent box to sign." }, 400);
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
    if (vErr) { console.error("[sign-contract] version lookup", vErr); return json({ error: "Could not load contract version." }, 500); }
    if (!version) return json({ error: "Version not found" }, 404);

    const c: any = (version as any).contracts;
    if (!c) return json({ error: "Contract not found" }, 404);

    // Strict driver-only in this phase. Recruiters and admins cannot sign FOR the driver.
    if (c.driver_user_id !== userId) {
      return json({ error: "Only the assigned driver can sign this contract." }, 403);
    }

    if (version.upload_status !== "uploaded") {
      return json({ error: "Contract version is not ready for signing." }, 409);
    }
    if (!c.current_version_id || c.current_version_id !== version_id) {
      return json({ error: "Only the current contract version can be signed." }, 409);
    }
    if (c.status === "signed") {
      return json({ error: "This contract has already been signed." }, 409);
    }
    if (c.status !== "approved") {
      return json({ error: `Contract must be approved before signing (current: ${c.status}).` }, 409);
    }

    // Driver must already have an 'approved' review for THIS version.
    const { data: drv } = await admin
      .from("contract_reviews")
      .select("id, decision, reviewer_user_id")
      .eq("contract_id", version.contract_id)
      .eq("version_id", version_id)
      .eq("reviewer_role", "driver")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!drv || drv.decision !== "approved" || drv.reviewer_user_id !== userId) {
      return json({ error: "You must approve this contract version before signing it." }, 409);
    }

    const userAgent = (req.headers.get("user-agent") || "").slice(0, 512) || null;
    const ip = clientIp(req);
    const nowIso = new Date().toISOString();

    // Insert signature first (unique index prevents duplicates).
    const { data: sigRow, error: sigErr } = await admin
      .from("contract_signatures")
      .insert({
        contract_id: version.contract_id,
        version_id,
        signer_user_id: userId,
        signer_role: "driver",
        signature_method: "typed",
        signed_at: nowIso,
        ip_address: ip,
        user_agent: userAgent,
        evidence: {
          typed_name,
          consent: true,
          consent_text:
            "I understand this is a digital signature confirming I reviewed and approved this contract.",
          signed_at: nowIso,
          driver_review_id: drv.id,
        },
      })
      .select("id")
      .single();

    if (sigErr || !sigRow) {
      const isDup =
        (sigErr as any)?.code === "23505" ||
        /duplicate key|unique/i.test(sigErr?.message || "");
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: "driver",
        action: "sign_failed",
        metadata: { reason: sigErr?.message || "signature insert failed", duplicate: isDup },
      });
      if (isDup) return json({ error: "You have already signed this contract version." }, 409);
      console.error("[sign-contract] signature insert", sigErr);
      return json({ error: "Could not save signature." }, 500);
    }

    // Advance contract status approved -> signed. Scope strictly to avoid races.
    const { data: stRows, error: stErr } = await admin
      .from("contracts")
      .update({ status: "signed" })
      .eq("id", version.contract_id)
      .eq("current_version_id", version_id)
      .eq("status", "approved")
      .select("id");
    const transitioned = !stErr && Array.isArray(stRows) && stRows.length === 1;
    if (!transitioned) {
      // Roll back the signature so state stays consistent.
      await admin.from("contract_signatures").delete().eq("id", sigRow.id);
      await admin.from("contract_audit_log").insert({
        contract_id: version.contract_id,
        version_id,
        actor_user_id: userId,
        actor_role: "driver",
        action: "sign_failed",
        metadata: { reason: stErr?.message || "status transition rejected", phase: "status_update" },
      });
      if (stErr) console.error("[sign-contract] status update", stErr);
      return json(
        { error: "Contract status changed before signing could be saved." },
        409,
      );
    }

    await admin.from("contract_audit_log").insert({
      contract_id: version.contract_id,
      version_id,
      actor_user_id: userId,
      actor_role: "driver",
      action: "signed",
      metadata: {
        signature_id: sigRow.id,
        method: "typed",
        typed_name_length: typed_name.length,
      },
    });

    return json({ ok: true, signature_id: sigRow.id, status: "signed", signed_at: nowIso });
  } catch (e) {
    console.error("[sign-contract] error", e);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
