// Phase 9F — Driver Pro: Plain-English Clause Rewrite.
// - Auth: assigned driver only (admin override allowed).
// - Pro gate: requires active subscription OR admin. Recruiter-paid alone does NOT unlock.
// - Stateless: does NOT persist results in v1.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_CHARS = 20;
const MAX_CHARS = 5000;

const SYSTEM_PROMPT = `You help owner-operator truck drivers understand a single clause from a trucking-related contract in plain English.

Strict rules:
- You are NOT a lawyer. Do NOT give legal advice.
- Do NOT say whether the clause is legally enforceable, valid, or invalid.
- Do NOT tell the driver to sign or not sign.
- Do NOT pretend to be an attorney.
- Use careful educational language: "this may mean", "this section appears to", "you may want to ask the company about".
- Identify terms a driver should pay attention to.
- Suggest practical questions to ask the recruiter before approving.
- Always remind the driver this is informational only and to consider speaking with a qualified attorney for legal advice.
- Return ONLY by calling the provided tool. No prose.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "rewrite_clause",
    description: "Return a structured plain-English explanation of a single contract clause for a truck driver.",
    parameters: {
      type: "object",
      properties: {
        plain_english: {
          type: "string",
          description: "2-5 sentences explaining what the clause appears to mean in plain English. Educational, non-legal.",
        },
        why_it_matters: {
          type: "string",
          description: "1-3 sentences on why a driver may want to pay attention. Use cautious language.",
        },
        questions_to_ask: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
          description: "Up to 5 short practical questions to ask the recruiter before approving.",
        },
        reminder: {
          type: "string",
          description: "A short reminder that this is informational only and not legal advice.",
        },
      },
      required: ["plain_english", "why_it_matters", "questions_to_ask", "reminder"],
    },
  },
};

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI is not configured" }, 500);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const contract_id = body?.contract_id ? String(body.contract_id).trim() : "";
    const application_id = body?.application_id ? String(body.application_id).trim() : "";
    const rawText = typeof body?.clause_text === "string" ? body.clause_text : "";
    const clauseText = rawText.trim();

    if (!clauseText) return json({ error: "Please paste a clause to explain." }, 400);
    if (clauseText.length < MIN_CHARS)
      return json({ error: `Clause is too short (min ${MIN_CHARS} characters).` }, 400);
    if (clauseText.length > MAX_CHARS)
      return json({ error: `Clause is too long (max ${MAX_CHARS} characters).` }, 400);
    if (!contract_id && !application_id)
      return json({ error: "contract_id or application_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Resolve contract and confirm the user is the assigned driver (or admin).
    let contract: { id: string; driver_user_id: string | null } | null = null;
    if (contract_id) {
      const { data, error } = await admin
        .from("contracts")
        .select("id, driver_user_id")
        .eq("id", contract_id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      contract = data as any;
    } else {
      const { data, error } = await admin
        .from("contracts")
        .select("id, driver_user_id")
        .eq("application_id", application_id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      contract = data as any;
    }
    if (!contract) return json({ error: "Contract not found" }, 404);

    const { data: adminRow } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const isAdmin = !!adminRow;
    const isAssignedDriver = contract.driver_user_id === userId;
    if (!isAdmin && !isAssignedDriver) return json({ error: "Forbidden" }, 403);

    // Server-side Driver Pro gate. Recruiter-paid status alone does NOT unlock this tool.
    if (!isAdmin) {
      const { data: sub } = await admin
        .from("subscriptions")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();
      const isPro = sub?.status === "active";
      if (!isPro) {
        return json(
          {
            error:
              "Plain-English Clause Rewrite is a Driver Pro feature. Upgrade to access advanced Contract Protection tools.",
            code: "pro_required",
          },
          403,
        );
      }
    }

    // Call Lovable AI Gateway.
    let parsed: any = null;
    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Explain the following clause in plain English for an owner-operator truck driver.\n\n---BEGIN CLAUSE---\n${clauseText}\n---END CLAUSE---`,
            },
          ],
          tools: [TOOL],
          tool_choice: { type: "function", function: { name: "rewrite_clause" } },
        }),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        if (aiRes.status === 429)
          return json({ error: "AI is busy. Please try again in a moment." }, 429);
        if (aiRes.status === 402)
          return json({ error: "AI credits exhausted. Please contact support." }, 402);
        throw new Error(`AI gateway error ${aiRes.status}: ${errText.slice(0, 300)}`);
      }
      const data = await aiRes.json();
      const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
      if (!tc?.function?.arguments) throw new Error("AI did not return a structured explanation");
      parsed = JSON.parse(tc.function.arguments);
    } catch (e) {
      console.error("[rewrite-contract-clause] AI error", e);
      return json({ error: (e as Error).message || "AI explanation failed" }, 502);
    }

    const result = {
      plain_english: String(parsed.plain_english || "").slice(0, 4000),
      why_it_matters: String(parsed.why_it_matters || "").slice(0, 2000),
      questions_to_ask: Array.isArray(parsed.questions_to_ask)
        ? parsed.questions_to_ask.slice(0, 5).map((s: unknown) => String(s).slice(0, 300))
        : [],
      reminder:
        String(parsed.reminder || "").slice(0, 600) ||
        "This explanation is informational only. HaulTrackerPro is not a law firm and does not provide legal advice. Read the full contract and consider speaking with a qualified attorney before signing.",
    };

    return json({ ok: true, result });
  } catch (e) {
    console.error("[rewrite-contract-clause] error", e);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
