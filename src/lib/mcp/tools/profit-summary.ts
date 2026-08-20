import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "profit_summary",
  title: "Profit summary",
  description:
    "Summarize the signed-in driver's revenue, expenses, net profit, miles, and rate per mile over a date range (YYYY-MM-DD). Cancelled loads are excluded from revenue.",
  inputSchema: {
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start of the period (YYYY-MM-DD), inclusive."),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End of the period (YYYY-MM-DD), inclusive."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_date, to_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (from_date > to_date) {
      return { content: [{ type: "text", text: "from_date must not be after to_date" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const [loadsResult, expensesResult] = await Promise.all([
      supabase
        .from("loads")
        .select("estimated_pay, actual_pay_received, loaded_miles, deadhead_miles, status")
        .gte("load_date", from_date)
        .lte("load_date", to_date),
      supabase
        .from("expenses")
        .select("amount, expense_type")
        .gte("expense_date", from_date)
        .lte("expense_date", to_date),
    ]);

    if (loadsResult.error) {
      return { content: [{ type: "text", text: loadsResult.error.message }], isError: true };
    }
    if (expensesResult.error) {
      return { content: [{ type: "text", text: expensesResult.error.message }], isError: true };
    }

    const loads = (loadsResult.data ?? []).filter((l) => l.status !== "cancelled");
    const revenue = loads.reduce(
      (sum, l) => sum + Number(l.actual_pay_received ?? l.estimated_pay ?? 0),
      0,
    );
    const loadedMiles = loads.reduce((sum, l) => sum + Number(l.loaded_miles ?? 0), 0);
    const deadheadMiles = loads.reduce((sum, l) => sum + Number(l.deadhead_miles ?? 0), 0);
    const totalMiles = loadedMiles + deadheadMiles;
    const expenses = expensesResult.data ?? [];
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

    const round = (n: number) => Math.round(n * 100) / 100;
    const summary = {
      from_date,
      to_date,
      load_count: loads.length,
      revenue: round(revenue),
      total_expenses: round(totalExpenses),
      net_profit: round(revenue - totalExpenses),
      loaded_miles: round(loadedMiles),
      deadhead_miles: round(deadheadMiles),
      total_miles: round(totalMiles),
      revenue_per_loaded_mile: loadedMiles > 0 ? round(revenue / loadedMiles) : null,
      deadhead_percent: totalMiles > 0 ? round((deadheadMiles / totalMiles) * 100) : null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
