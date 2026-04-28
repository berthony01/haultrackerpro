import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, details?: unknown) =>
  console.log(`[AI-INSIGHT] ${step}${details ? ` — ${JSON.stringify(details)}` : ""}`);

// ── Model selection per insight type ──────────────────────────────────
const MODEL_MAP: Record<string, string> = {
  lane_advice: "google/gemini-3-flash-preview",
  weekly_report: "google/gemini-3-flash-preview",
  tax_tips: "google/gemini-3-flash-preview",
  parse_expense: "google/gemini-3-flash-preview",
  parse_ratecon: "google/gemini-3-flash-preview",
};

// ── System prompts ───────────────────────────────────────────────────
const SYSTEM_PROMPTS: Record<string, string> = {
  lane_advice: `You are a trucking business advisor for owner-operators. Given aggregated lane stats (best/worst lanes, RPM, deadhead %), provide 2-3 sentences of specific, actionable advice. Be direct and practical — these are working truck drivers. Reference actual numbers from the data. Do not use markdown headers.`,

  weekly_report: `You are a trucking business analyst writing a weekly performance report for an owner-operator. Given the week's stats (loads, miles, revenue, expenses, deadhead, RPM, fuel costs), write a 3-4 paragraph narrative summary. Highlight the best and worst loads, flag any anomalies (high deadhead >25%, RPM drops, fuel spikes), and mention the estimated quarterly tax set-aside if applicable. Write in a professional but friendly tone. Use dollar amounts and percentages. Do not use markdown headers.`,

  tax_tips: `You are a trucking tax advisor. Given an owner-operator's quarterly expense summary (categories, per diem days, deduction totals), provide 2-3 specific tax optimization suggestions. Mention IRS per diem rates ($80/day for 2024-2025), potential missed deductions, and any red flags. Be specific with dollar estimates where possible. This is not official tax advice — always note that. Do not use markdown headers.`,

  parse_expense: `You are an expense data extractor for a trucking app. Given natural language text (possibly from voice input), extract one or more expenses. Return structured data using the provided tool.`,

  parse_ratecon: `You are a rate confirmation parser for a trucking app. Extract structured load data from raw OCR text. Rules: (1) loaded_miles = line-haul/trip miles only. (2) deadhead_miles = empty/DH/bobtail miles only — never guess; omit if not explicitly present. (3) total_miles = dispatcher-provided total/all miles when explicitly labeled — keep separate from loaded. (4) Never treat total miles as deadhead. (5) Extract deadhead_rate_per_mile and flat_rate only if explicitly stated. (6) Suggest pay_model_suggestion based on detected fields: 'flat_rate' if flat amount present, 'loaded_plus_deadhead' if separate DH rate present, 'total_miles' if rate + total miles but no loaded miles, otherwise 'loaded_miles_only'. (7) If loaded+deadhead disagree with total by more than 2 miles, set mileage_warning. Use the provided tool.`,
};

// ── Tool definitions for structured extraction ───────────────────────
const PARSE_EXPENSE_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_expenses",
    description: "Extract one or more expenses from natural language text",
    parameters: {
      type: "object",
      properties: {
        expenses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              amount: { type: "number", description: "Dollar amount" },
              category: {
                type: "string",
                enum: [
                  "Fuel", "Maintenance", "Repairs", "Tires", "Insurance",
                  "Tolls", "Parking", "Permits", "Licensing", "Truck Payment",
                  "Lease Payment", "Phone", "ELD/Software", "Scale/Weigh",
                  "Lumper", "Meals", "Lodging", "Supplies", "Other",
                ],
              },
              notes: { type: "string", description: "Brief description" },
              date: { type: "string", description: "ISO date if mentioned, otherwise null" },
            },
            required: ["amount", "category", "notes"],
          },
        },
      },
      required: ["expenses"],
    },
  },
};

const PARSE_RATECON_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_load",
    description: "Extract structured load data from rate confirmation OCR text",
    parameters: {
      type: "object",
      properties: {
        pickup_location: { type: "string" },
        dropoff_location: { type: "string" },
        load_date: { type: "string", description: "ISO date" },
        dropoff_date: { type: "string", description: "ISO date or null" },
        loaded_miles: { type: "number", description: "Line-haul / trip miles only. Do not include deadhead." },
        deadhead_miles: { type: "number", description: "Empty / deadhead / bobtail miles only. Omit if not explicitly present — never guess." },
        total_miles: { type: "number", description: "Dispatcher-provided total/all miles. Omit if not explicitly labeled." },
        rate_per_mile: { type: "number", description: "Loaded rate per mile." },
        deadhead_rate_per_mile: { type: "number", description: "Separate deadhead rate per mile, only if explicitly stated." },
        flat_rate: { type: "number", description: "Flat-rate dollar amount for the load, only if explicitly stated." },
        estimated_pay: { type: "number" },
        detention_fee: { type: "number" },
        other_fees: { type: "number" },
        notes: { type: "string" },
        pay_model_suggestion: {
          type: "string",
          enum: ["loaded_miles_only", "total_miles", "loaded_plus_deadhead", "flat_rate", "manual"],
        },
        mileage_warning: { type: "string", description: "Set if loaded+deadhead disagrees with total by >2 miles or other ambiguity." },
        stops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              location: { type: "string" },
              stop_type: { type: "string", enum: ["Pickup", "Dropoff", "Stop"] },
              stop_order: { type: "number" },
            },
            required: ["location", "stop_type", "stop_order"],
          },
        },
      },
      required: ["pickup_location", "dropoff_location", "load_date", "estimated_pay"],
    },
  },
};

// ── Simple hash for cache key ────────────────────────────────────────
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Call Lovable AI Gateway ──────────────────────────────────────────
async function callAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  tools?: unknown[],
  toolChoice?: unknown,
): Promise<{ content: string; toolCalls?: unknown[] }> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    log("AI gateway error", { status: res.status, body: errText });
    if (res.status === 429) throw new Error("AI rate limit exceeded. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please contact support.");
    throw new Error(`AI gateway error: ${res.status}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    toolCalls: choice?.message?.tool_calls,
  };
}

// ── Main handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { type, context, weekStart } = body as {
      type: string;
      context: Record<string, unknown>;
      weekStart?: string;
    };

    if (!type || !context) {
      return new Response(JSON.stringify({ error: "type and context are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = SYSTEM_PROMPTS[type];
    if (!systemPrompt) {
      return new Response(JSON.stringify({ error: `Unknown insight type: ${type}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = MODEL_MAP[type] || "google/gemini-3-flash-preview";
    const contextStr = JSON.stringify(context);
    const contextHash = simpleHash(contextStr);
    log("Processing", { type, model, userId, contextHash });

    // ── For cacheable types, check cache first ───────────────────────
    const cacheableTypes = ["lane_advice", "weekly_report", "tax_tips"];
    if (cacheableTypes.includes(type)) {
      const { data: cached } = await supabase
        .from("ai_insights")
        .select("content, generated_at")
        .eq("user_id", userId)
        .eq("insight_type", type)
        .eq("context_hash", contextHash)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        const maxAge = type === "tax_tips" ? 90 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        if (age < maxAge) {
          log("Cache hit", { type, age: Math.round(age / 3600000) + "h" });
          return new Response(JSON.stringify({ content: cached.content, cached: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ── Call AI ──────────────────────────────────────────────────────
    let result: { content: string; toolCalls?: unknown[] };

    if (type === "parse_expense") {
      result = await callAI(apiKey, model, systemPrompt, contextStr, [PARSE_EXPENSE_TOOL], {
        type: "function",
        function: { name: "extract_expenses" },
      });
    } else if (type === "parse_ratecon") {
      result = await callAI(apiKey, model, systemPrompt, contextStr, [PARSE_RATECON_TOOL], {
        type: "function",
        function: { name: "extract_load" },
      });
    } else {
      result = await callAI(apiKey, model, systemPrompt, contextStr);
    }

    // ── Extract structured data from tool calls ─────────────────────
    let responseContent: string;
    let parsedData: unknown = null;

    if (result.toolCalls && result.toolCalls.length > 0) {
      const tc = result.toolCalls[0] as { function: { arguments: string } };
      try {
        parsedData = JSON.parse(tc.function.arguments);
        responseContent = tc.function.arguments;
      } catch {
        responseContent = result.content || "Failed to parse AI response";
      }
    } else {
      responseContent = result.content;
    }

    // ── Cache cacheable results ─────────────────────────────────────
    if (cacheableTypes.includes(type) && responseContent) {
      await supabase.from("ai_insights").insert({
        user_id: userId,
        insight_type: type,
        content: responseContent,
        context_hash: contextHash,
        week_start: weekStart || null,
      });
      log("Cached result", { type });
    }

    log("Success", { type, contentLength: responseContent.length });

    const responseBody: Record<string, unknown> = {
      content: responseContent,
      cached: false,
    };
    if (parsedData) responseBody.parsed = parsedData;

    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    const status = msg.includes("rate limit") ? 429 : msg.includes("credits") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
