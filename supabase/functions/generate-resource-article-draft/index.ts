import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_CLUSTERS = new Set([
  "profit", "rpm", "fuel", "expenses", "taxes", "bookkeeping",
  "deadhead", "contracts", "recruiter_tools", "parking", "load_selection",
]);

const SYSTEM_PROMPT = `You are a content writer for Haul Tracker Pro, a trucking profit-tracking app.

Write people-first articles for truck drivers, owner-operators, lease drivers, 1099 drivers, or trucking recruiters. Be practical and accurate.

Strict rules:
- Never invent statistics, citations, quotes, studies, or sources.
- Never guarantee profit, savings, tax deductions, legal protection, higher earnings, or better loads.
- Never claim IRS, FMCSA, accounting, legal, or tax expertise.
- Use safe wording: "may help," "designed to help," "can support organization."
- Clearly note Haul Tracker Pro is not a CPA, lawyer, tax advisor, or financial advisor.
- Include a disclaimer when discussing taxes, legal, or financial topics.
- The article must be useful even if the reader never signs up.
- Mention Haul Tracker Pro only naturally, not as a sales pitch.
- Do NOT copy any specific competitor's content.

Return JSON ONLY with this exact shape:
{
  "title": string,
  "slug": string (lowercase letters, digits, hyphens; 3-80 chars),
  "seo_title": string (max 60 chars),
  "meta_description": string (max 160 chars),
  "excerpt": string (1-2 sentences),
  "content": string (Markdown, 600-1200 words),
  "faq_items": [{ "q": string, "a": string }],
  "suggested_internal_links": [{ "label": string, "path": string }],
  "disclaimer": string
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side admin check
    const { data: adminRow } = await supabase
      .from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!apiKey) {
      return new Response(JSON.stringify({
        error: "AI draft generation is not configured yet. You can still create articles manually.",
        configured: false,
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const topic = String(body.topic ?? "").trim().slice(0, 200);
    const audience = String(body.audience ?? "owner-operator").trim().slice(0, 80);
    const topic_cluster = String(body.topic_cluster ?? "").trim();
    const angle = String(body.angle ?? "").trim().slice(0, 300);
    const notes = String(body.notes ?? "").trim().slice(0, 1500);
    const target_keyword = String(body.target_keyword ?? "").trim().slice(0, 120);
    const related_links = Array.isArray(body.related_links)
      ? body.related_links.slice(0, 10).map((l: unknown) => String(l).slice(0, 200))
      : [];

    if (!topic || topic.length < 4) {
      return new Response(JSON.stringify({ error: "topic is required (min 4 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_CLUSTERS.has(topic_cluster)) {
      return new Response(JSON.stringify({ error: "invalid topic_cluster" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `Topic: ${topic}
Audience: ${audience}
Topic cluster: ${topic_cluster}
Angle: ${angle || "(none)"}
Target keyword: ${target_keyword || "(none)"}
Author notes: ${notes || "(none)"}
Related internal links available: ${related_links.join(", ") || "(none)"}

Write the article now. Return JSON only — no prose before or after.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return new Response(JSON.stringify({ error: "AI provider error", detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "";
    let draft: Record<string, unknown>;
    try {
      draft = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Model did not return valid JSON" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Always return draft to client — never auto-write to DB.
    return new Response(JSON.stringify({
      draft,
      generated_by_ai: true,
      ai_generation_prompt: userPrompt,
      topic_cluster,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
