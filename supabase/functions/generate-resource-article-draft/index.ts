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

const SYSTEM_PROMPT = `You are a professional content writer for Haul Tracker Pro, a trucking profit-tracking app.

Write people-first articles for truck drivers, owner-operators, lease drivers, 1099 drivers, or trucking recruiters. Be practical and accurate.

Completeness rules (mandatory):
- "content" MUST be a COMPLETE, publish-ready article in finished prose. It is NOT an outline, template, brief, or set of instructions.
- NEVER output placeholder or instructional text such as "Draft this section", "add example here", "TODO", "[insert ...]", "placeholder", or notes addressed to an admin/editor.
- Target roughly 1,200-2,000 words when the topic warrants that depth. Do not pad a simple topic just to reach a word count — quality and usefulness matter more than length.
- Structure with logical Markdown H2/H3 headings, a strong useful introduction, and a concise conclusion or next step.
- Give practical trucking-specific explanations. Include worked illustrative examples where useful, clearly presented as illustrative examples, never as industry statistics.
- FAQs must have complete, standalone answers.
- Mention Haul Tracker Pro naturally and use the recommended CTA naturally — never as a sales pitch.
- You may use ONLY the internal links supplied in the request, and only where they fit naturally. NEVER invent internal routes or paths.
- Use the supplied primary and secondary keywords naturally, without keyword stuffing.

Strict safety rules:
- Never invent statistics, citations, quotes, studies, or sources.
- Never guarantee profit, savings, tax deductions, legal protection, higher earnings, or better loads.
- Never claim IRS, FMCSA, accounting, legal, or tax expertise.
- Use safe wording: "may help," "designed to help," "can support organization."
- Clearly note Haul Tracker Pro is not a CPA, lawyer, tax advisor, or financial advisor.
- Include a disclaimer when discussing tax, legal, financial, contract, or accounting topics.
- The article must be useful even if the reader never signs up.
- Do NOT copy any specific competitor's content.

Return JSON ONLY with this exact shape:
{
  "title": string,
  "slug": string (lowercase letters, digits, hyphens; 3-80 chars),
  "seo_title": string (max 60 chars),
  "meta_description": string (max 160 chars),
  "excerpt": string (1-2 sentences),
  "content": string (complete Markdown article),
  "faq_items": [{ "q": string, "a": string }],
  "suggested_internal_links": [{ "label": string, "path": string }],
  "disclaimer": string
}`;

// --- calendar brief sanitation -------------------------------------------
function cleanStr(v: unknown, max: number): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).map((i) => cleanStr(i, maxLen)).filter(Boolean);
}

interface CleanBrief {
  title: string;
  slug: string;
  primary_keyword: string;
  secondary_keywords: string[];
  target_audience: string[];
  search_intent: string;
  content_angle: string;
  outline_sections: string[];
  suggested_faqs: string[];
  suggested_internal_links: { label: string; path: string }[];
  recommended_cta: string;
  disclaimer_required: boolean;
}

function sanitizeCalendarBrief(raw: unknown): CleanBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const title = cleanStr(b.title, 200);
  if (!title) return null;
  const links = Array.isArray(b.suggested_internal_links) ? b.suggested_internal_links.slice(0, 12) : [];
  return {
    title,
    slug: cleanStr(b.slug, 80).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    primary_keyword: cleanStr(b.primary_keyword, 120),
    secondary_keywords: cleanList(b.secondary_keywords, 15, 120),
    target_audience: cleanList(b.target_audience, 10, 80),
    search_intent: cleanStr(b.search_intent, 200),
    content_angle: cleanStr(b.content_angle, 500),
    outline_sections: cleanList(b.outline_sections, 20, 200),
    suggested_faqs: cleanList(b.suggested_faqs, 15, 300),
    suggested_internal_links: links
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return { label: cleanStr(o.label, 120), path: cleanStr(o.path, 200) };
      })
      .filter((l) => l.label && l.path.startsWith("/")),
    recommended_cta: cleanStr(b.recommended_cta, 300),
    disclaimer_required: b.disclaimer_required === true,
  };
}

function renderBrief(b: CleanBrief): string {
  const lines: string[] = [];
  lines.push("## Approved editorial brief (follow it exactly — do not invent a different topic or structure)");
  lines.push(`Title: ${b.title}`);
  if (b.slug) lines.push(`Slug: ${b.slug}`);
  if (b.primary_keyword) lines.push(`Primary keyword: ${b.primary_keyword}`);
  if (b.secondary_keywords.length) lines.push(`Secondary keywords: ${b.secondary_keywords.join(", ")}`);
  if (b.target_audience.length) lines.push(`Audience: ${b.target_audience.join(", ")}`);
  if (b.search_intent) lines.push(`Search intent: ${b.search_intent}`);
  if (b.content_angle) lines.push(`Content angle: ${b.content_angle}`);
  if (b.outline_sections.length) {
    lines.push("Outline sections to cover (expand each into complete prose):");
    b.outline_sections.forEach((s) => lines.push(`- ${s}`));
  }
  if (b.suggested_faqs.length) {
    lines.push("FAQs to answer completely:");
    b.suggested_faqs.forEach((q) => lines.push(`- ${q}`));
  }
  if (b.suggested_internal_links.length) {
    lines.push("Internal links you may use (ALLOWLIST — do not invent any other internal path):");
    b.suggested_internal_links.forEach((l) => lines.push(`- [${l.label}](${l.path})`));
  } else {
    lines.push("Internal links: none supplied — do not invent any internal paths.");
  }
  if (b.recommended_cta) lines.push(`Recommended CTA (use naturally, not as a hard sell): ${b.recommended_cta}`);
  lines.push(
    b.disclaimer_required
      ? "Disclaimer: REQUIRED. Include a clear educational disclaimer — Haul Tracker Pro is not a CPA, attorney, or financial advisor."
      : "Disclaimer: not strictly required, but never imply guaranteed financial outcomes.",
  );
  return lines.join("\n");
}

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
