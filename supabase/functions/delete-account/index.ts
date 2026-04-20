import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client to get the user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client to delete data and auth user
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const userId = user.id;

    // Delete all user-owned data. Order matters for FK constraints:
    // - load_stops references loads, so load_stops first
    // - expenses and fuel_logs reference loads (linked_load_id), so they go before loads
    // - broker_stats references brokers, so broker_stats before brokers
    // - loads references brokers (broker_id), so loads before brokers
    // Derived tables (lane_stats, broker_stats, operating_metrics) are user-owned
    // caches and are deleted here for completeness.
    // admin_audit_log / admin_users are intentionally NOT touched — they are
    // system/audit tables, not user content.
    await adminClient.from("load_stops").delete().eq("user_id", userId);
    await adminClient.from("expenses").delete().eq("user_id", userId);
    await adminClient.from("fuel_logs").delete().eq("user_id", userId);
    await adminClient.from("loads").delete().eq("user_id", userId);
    await adminClient.from("broker_stats").delete().eq("user_id", userId);
    await adminClient.from("lane_stats").delete().eq("user_id", userId);
    await adminClient.from("operating_metrics").delete().eq("user_id", userId);
    await adminClient.from("brokers").delete().eq("user_id", userId);
    await adminClient.from("recurring_expense_templates").delete().eq("user_id", userId);
    await adminClient.from("weekly_snapshots").delete().eq("user_id", userId);
    await adminClient.from("feedback_responses").delete().eq("user_id", userId);
    await adminClient.from("parse_usage").delete().eq("user_id", userId);
    await adminClient.from("user_alerts").delete().eq("user_id", userId);
    await adminClient.from("expense_automation_logs").delete().eq("user_id", userId);
    await adminClient.from("ai_insights").delete().eq("user_id", userId);
    await adminClient.from("subscriptions").delete().eq("user_id", userId);
    await adminClient.from("user_settings").delete().eq("user_id", userId);
    await adminClient.from("profiles").delete().eq("user_id", userId);

    // Delete auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
