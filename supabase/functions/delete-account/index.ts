import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Phase 26: never echo raw DB error messages, table names, or constraint
// details back to the client. Log details server-side only.
const GENERIC_DELETE_ERROR = "Account deletion failed. Please contact support.";

function clientError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return clientError(401, "Missing authorization");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      if (userError) console.error("[delete-account] auth.getUser failed:", userError);
      return clientError(401, "Unauthorized");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const userId = user.id;

    // FK-safe deletion order. If any step fails we abort BEFORE removing the
    // auth user so the account remains recoverable.
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
        // Detailed context server-side only; never leaked to the client.
        console.error(
          `[delete-account] user=${userId} table=${table} failed:`,
          error,
        );
        return clientError(500, GENERIC_DELETE_ERROR);
      }
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(
        `[delete-account] user=${userId} auth.admin.deleteUser failed:`,
        deleteError,
      );
      return clientError(500, "Unable to complete account deletion at this time.");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[delete-account] unexpected error:", err);
    return clientError(500, GENERIC_DELETE_ERROR);
  }
});
