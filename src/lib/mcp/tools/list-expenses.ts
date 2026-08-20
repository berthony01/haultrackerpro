import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_expenses",
  title: "List expenses",
  description:
    "List the signed-in driver's most recent expenses, newest first. Optionally filter by category or an expense date range (YYYY-MM-DD).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Maximum expenses to return (1-100)."),
    category: z.string().trim().min(1).optional().describe("Filter by expense category, e.g. Fuel, Maintenance, Insurance."),
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only expenses on or after this date (YYYY-MM-DD)."),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only expenses on or before this date (YYYY-MM-DD)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, category, from_date, to_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("expenses")
      .select("id, expense_date, category, expense_type, amount, gallons, notes, linked_load_id")
      .order("expense_date", { ascending: false })
      .limit(limit ?? 20);

    if (category) query = query.eq("category", category);
    if (from_date) query = query.gte("expense_date", from_date);
    if (to_date) query = query.lte("expense_date", to_date);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const expenses = data ?? [];
    const total = expenses.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    return {
      content: [
        { type: "text", text: JSON.stringify({ count: expenses.length, total_amount: total, expenses }, null, 2) },
      ],
      structuredContent: { count: expenses.length, total_amount: total, expenses },
    };
  },
});
