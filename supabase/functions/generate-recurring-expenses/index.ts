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

// Hard cap so a wildly old start_date can never insert thousands of rows in
// one run. 400 covers ~13 months of daily backfill, which is more than enough
// for any realistic catch-up window.
const MAX_GENERATIONS_PER_TEMPLATE_PER_RUN = 400;

// --- Date helpers (UTC, no Date(string) parsing) ---
function parseISODate(s: string): Date {
  // "YYYY-MM-DD" -> UTC midnight
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}
function addMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}
function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Compute the list of expense_dates that should be generated for a template,
 * given its frequency, start_date, end_date, last_generated_date, and today.
 *
 * Cursor is `last_generated_date` (or null for never-generated). For each
 * frequency we step forward and emit dates up to and including `today`,
 * respecting end_date and the per-run safety cap.
 */
function computeDueDates(opts: {
  frequency: string;
  startDate: string;
  endDate: string | null;
  lastGenerated: string | null;
  todayUTC: Date;
}): string[] {
  const { frequency, startDate, endDate, lastGenerated, todayUTC } = opts;
  const start = parseISODate(startDate);
  const end = endDate ? parseISODate(endDate) : null;
  const last = lastGenerated ? parseISODate(lastGenerated) : null;

  const dates: string[] = [];
  const horizon = end && end < todayUTC ? end : todayUTC;
  if (start > horizon) return dates;

  if (frequency === "daily") {
    // First due day = max(start, last+1)
    let cursor = last ? addDaysUTC(last, 1) : start;
    if (cursor < start) cursor = start;
    while (cursor <= horizon && dates.length < MAX_GENERATIONS_PER_TEMPLATE_PER_RUN) {
      dates.push(fmtISODate(cursor));
      cursor = addDaysUTC(cursor, 1);
    }
    return dates;
  }

  if (frequency === "weekly") {
    // Anchored to start_date, every 7 days. First due = max(start, last+7).
    let cursor = last ? addDaysUTC(last, 7) : start;
    if (cursor < start) cursor = start;
    while (cursor <= horizon && dates.length < MAX_GENERATIONS_PER_TEMPLATE_PER_RUN) {
      dates.push(fmtISODate(cursor));
      cursor = addDaysUTC(cursor, 7);
    }
    return dates;
  }

  // monthly (default) — emit on the 1st of each month from the start month
  // forward. If start_date's month equals start_date itself in the start month,
  // we use the start_date as the first emitted date to mirror prior behavior.
  const firstMonth = startOfMonthUTC(start);
  let cursor = last ? addMonthsUTC(startOfMonthUTC(last), 1) : firstMonth;
  if (cursor < firstMonth) cursor = firstMonth;
  const horizonMonthStart = startOfMonthUTC(horizon);
  while (cursor <= horizonMonthStart && dates.length < MAX_GENERATIONS_PER_TEMPLATE_PER_RUN) {
    // Use start_date itself for the very first emission in its own month;
    // every subsequent month uses the 1st.
    let emit = cursor;
    if (cursor.getUTCFullYear() === start.getUTCFullYear() &&
        cursor.getUTCMonth() === start.getUTCMonth()) {
      emit = start;
    }
    if (!end || emit <= end) {
      dates.push(fmtISODate(emit));
    }
    cursor = addMonthsUTC(cursor, 1);
  }
  return dates;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Restrict to internal callers (pg_cron) only. The pg_cron job supplies
  // the matching x-internal-secret header. Without this, any unauthenticated
  // caller could trigger service-role expense inserts.
  const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  const provided = req.headers.get("x-internal-secret") ?? "";
  if (!internalSecret || provided !== internalSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayISO = fmtISODate(todayUTC);

    const { data: activeTemplates, error: tplErr } = await supabase
      .from("recurring_expense_templates")
      .select("*")
      .eq("is_active", true)
      .eq("status", "active")
      .lte("start_date", todayISO);

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

    const userIds = [...new Set(activeTemplates.map((t) => t.user_id))];
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, status")
      .in("user_id", userIds);

    const proUsers = new Set(
      (subs || []).filter((s) => s.status === "active").map((s) => s.user_id)
    );

    const { data: admins } = await supabase
      .from("admin_users")
      .select("user_id")
      .in("user_id", userIds);
    (admins || []).forEach((a) => proUsers.add(a.user_id));

    let generated = 0;

    for (const template of activeTemplates) {
      if (!proUsers.has(template.user_id)) {
        logStep("Skipping non-Pro user", { userId: template.user_id });
        continue;
      }

      const freq = (template.frequency || "monthly").toLowerCase();
      const dueDates = computeDueDates({
        frequency: freq,
        startDate: template.start_date,
        endDate: template.end_date,
        lastGenerated: template.last_generated_date,
        todayUTC,
      });

      if (dueDates.length === 0) {
        continue;
      }

      logStep("Template due dates", {
        templateId: template.id,
        frequency: freq,
        count: dueDates.length,
        first: dueDates[0],
        last: dueDates[dueDates.length - 1],
      });

      // Insert one row per due date. We advance last_generated_date after
      // each successful insert so a mid-loop failure can resume cleanly.
      for (const expenseDate of dueDates) {
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
            expenseDate,
            message: insertErr.message,
          });
          break;
        }

        const { error: updErr } = await supabase
          .from("recurring_expense_templates")
          .update({ last_generated_date: expenseDate })
          .eq("id", template.id);

        if (updErr) {
          logStep("Error updating last_generated_date", {
            templateId: template.id,
            expenseDate,
            message: updErr.message,
          });
          break;
        }

        generated++;
      }
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
