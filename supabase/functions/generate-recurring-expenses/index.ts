import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(
    `[GENERATE-RECURRING] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`
  );
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // No auth gate: this function is invoked by a pg_cron job (which sends the
  // anon Bearer, not a custom secret). The function is safe to expose because:
  //   1. It only inserts rows for templates whose `last_generated_date` is
  //      older than the current month, so repeated calls are idempotent.
  //   2. It only generates expenses for Pro / admin users.
  //   3. It performs no destructive work.
  // If you re-add an auth gate, also update the cron job in
  // 20260501140600_…sql to send the matching header, otherwise daily
  // generation will silently 401 and Pro users will stop receiving their
  // monthly recurring expenses.

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    // Current month boundaries
    const now = new Date();
    const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // Find active templates that haven't generated for this month yet
    // and whose start_date <= current month and (end_date is null or >= current month).
    //
    // PAUSED TEMPLATES ARE INTENTIONALLY SKIPPED HERE.
    // Users pause templates during home time / downtime so the system stops creating
    // new fixed expenses they aren't actually incurring. We do NOT backfill skipped
    // months when a template is later resumed — `last_generated_date` is left untouched
    // during the pause, and on resume we simply pick up from the current month forward.
    // We filter on both `is_active=true` and `status='active'` (kept in sync via DB
    // trigger `sync_recurring_template_status`) for defense in depth.
    const { data: activeTemplates, error: tplErr } = await supabase
      .from("recurring_expense_templates")
      .select("*")
      .eq("is_active", true)
      .eq("status", "active")
      .or(`last_generated_date.is.null,last_generated_date.lt.${currentMonthStart}`)
      .lte("start_date", currentMonthStart)
      .or(`end_date.is.null,end_date.gte.${currentMonthStart}`);

    if (tplErr) {
      logStep("Error fetching templates", { message: tplErr.message });
      throw new Error(tplErr.message);
    }

    if (!activeTemplates || activeTemplates.length === 0) {
      logStep("No templates to process");
      return new Response(JSON.stringify({ generated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    logStep("Templates found", { count: activeTemplates.length });

    // Get unique user IDs and check their subscription status
    const userIds = [...new Set(activeTemplates.map((t) => t.user_id))];
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, status")
      .in("user_id", userIds);

    const proUsers = new Set(
      (subs || [])
        .filter((s) => s.status === "active")
        .map((s) => s.user_id)
    );

    // Also check admin_users for admin override
    const { data: admins } = await supabase
      .from("admin_users")
      .select("user_id")
      .in("user_id", userIds);
    (admins || []).forEach((a) => proUsers.add(a.user_id));

    let generated = 0;

    for (const template of activeTemplates) {
      // Only generate for Pro/admin users
      if (!proUsers.has(template.user_id)) {
        logStep("Skipping non-Pro user", { userId: template.user_id });
        continue;
      }

      // Determine expense date: 1st of current month, or start_date if it's this month
      const startDate = new Date(template.start_date);
      let expenseDate = currentMonthStart;
      if (
        startDate.getFullYear() === now.getFullYear() &&
        startDate.getMonth() === now.getMonth()
      ) {
        expenseDate = template.start_date;
      }

      // Insert the expense
      const { error: insertErr } = await supabase.from("expenses").insert({
        user_id: template.user_id,
        expense_date: expenseDate,
        category: template.category,
        amount: template.amount,
        notes: template.notes
          ? `[Recurring: ${template.template_name}] ${template.notes}`
          : `[Recurring: ${template.template_name}]`,
        expense_type: template.expense_type || "fixed",
      });

      if (insertErr) {
        logStep("Error inserting expense", {
          templateId: template.id,
          message: insertErr.message,
        });
        continue;
      }

      // Update last_generated_date to prevent duplicate generation
      await supabase
        .from("recurring_expense_templates")
        .update({ last_generated_date: currentMonthStart })
        .eq("id", template.id);

      generated++;
      logStep("Generated expense", {
        templateId: template.id,
        userId: template.user_id,
        category: template.category,
        amount: template.amount,
      });
    }

    logStep("Generation complete", { generated });

    return new Response(JSON.stringify({ generated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
