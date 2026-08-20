import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLoadsTool from "./tools/list-loads";
import listExpensesTool from "./tools/list-expenses";
import profitSummaryTool from "./tools/profit-summary";

// The OAuth issuer must be the direct Supabase host, built from the project ref
// literal Vite inlines at build time (never from a runtime SUPABASE_URL read).
let projectRef = "project-ref-unset";
try {
  // Vite substitutes this exact expression with a string literal at build time.
  // The try/catch keeps the module import-safe in plain Node evaluation
  // (manifest extraction), where `import.meta.env` does not exist.
  projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? projectRef;
} catch {
  // Keep the sentinel; a token never verifies against it.
}

export default defineMcp({
  name: "haul-tracker-pro",
  title: "Haul Tracker Pro",
  version: "0.1.0",
  instructions:
    "Read-only tools for Haul Tracker Pro. Every tool acts as the signed-in driver and returns only that driver's own data. Use `list_loads` for recent loads, `list_expenses` for recent expenses, and `profit_summary` for revenue, expense, mileage, and net-profit totals over a date range.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLoadsTool, listExpensesTool, profitSummaryTool],
});
