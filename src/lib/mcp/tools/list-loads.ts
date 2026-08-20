import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_loads",
  title: "List loads",
  description:
    "List the signed-in driver's most recent loads, newest first. Optionally filter by load status, payment status, or a load date range (YYYY-MM-DD).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Maximum loads to return (1-100)."),
    status: z.string().trim().min(1).optional().describe("Filter by load status, e.g. delivered, en_route, cancelled."),
    payment_status: z.string().trim().min(1).optional().describe("Filter by payment status, e.g. paid, unpaid, overdue, short_paid."),
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only loads with load_date on or after this date (YYYY-MM-DD)."),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only loads with load_date on or before this date (YYYY-MM-DD)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status, payment_status, from_date, to_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("loads")
      .select(
        "id, load_date, dropoff_date, pickup_location, dropoff_location, loaded_miles, deadhead_miles, rate_per_mile, estimated_pay, actual_pay_received, status, payment_status, broker_name_raw, load_reference",
      )
      .order("load_date", { ascending: false })
      .limit(limit ?? 20);

    if (status) query = query.eq("status", status);
    if (payment_status) query = query.eq("payment_status", payment_status);
    if (from_date) query = query.gte("load_date", from_date);
    if (to_date) query = query.lte("load_date", to_date);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const loads = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify({ count: loads.length, loads }, null, 2) }],
      structuredContent: { count: loads.length, loads },
    };
  },
});
