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

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const userId = user.id;

    // FK-safe deletion order. Each step is checked — if any deletion fails
    // we abort BEFORE removing the auth user, so the account remains
    // recoverable rather than orphaned. Derived tables (lane_stats,
    // broker_stats, operating_metrics) are user-owned caches and are deleted
    // for completeness. admin_audit_log / admin_users are intentionally
    // retained as they are system/audit records, not user content.
    const tablesInOrder = [
      "load_stops",
      "expenses",
      "fuel_logs",
      "loads",
      "broker_stats",
      "lane_stats",
      "operating_metrics",
      "brokers",
      "recurring_expense_templates",
      "weekly_snapshots",
      "feedback_responses",
      "parse_usage",
      "user_alerts",
      "expense_automation_logs",
      "ai_insights",
      "subscriptions",
      "user_settings",
      "profiles",
    ];

    for (const table of tablesInOrder) {
      const { error } = await adminClient.from(table).delete().eq("user_id", userId);
      if (error) {
        return new Response(
          JSON.stringify({ error: `Failed to delete from ${table}: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Only delete the auth user after all data deletions succeeded.
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
