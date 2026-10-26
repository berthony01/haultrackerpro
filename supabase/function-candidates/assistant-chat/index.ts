// DEPLOYABLE SOURCE ADAPTER, CANDIDATE ONLY. Lives outside supabase/functions
// on purpose so it is never auto-deployed. Activation requires moving it under
// supabase/functions/assistant-chat/ in a separately authorized release.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { GATEWAY_URL, handleAssistantRequest } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
// Model spend is OFF unless explicitly enabled AND the gateway key exists.
const ENABLED = Deno.env.get("ASSISTANT_CHAT_ENABLED") === "true" && LOVABLE_API_KEY.length > 0;

const service = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function userClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!SUPABASE_URL || !ANON_KEY || !service) {
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const res = await handleAssistantRequest(req, {
    config: { enabled: ENABLED },
    verifyToken: async (token) => {
      const { data, error } = await userClient(token).auth.getUser(token);
      return error || !data?.user?.id ? null : data.user.id;
    },
    userRpc: async (token, fn, args) => {
      const { data, error } = await userClient(token).rpc(fn, args);
      return { data, error: error ? { code: error.code, message: "db_error" } : null };
    },
    serviceFinalize: async (a) => {
      const { data, error } = await service.rpc("assistant_finalize_turn", {
        _reservation_id: a.reservationId, _lease_id: a.leaseId, _success: a.success, _content: a.content, _sources: a.sources,
      });
      return { data, error: error ? { code: error.code, message: "db_error" } : null };
    },
    gatewayFetch: (body, signal) => fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body,
      signal,
    }),
    // Event names + numeric status only. Never tokens, prompts, replies or provider bodies.
    log: (event, meta) => console.log(JSON.stringify({ fn: "assistant-chat", event, ...(meta ?? {}) })),
  });
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});
