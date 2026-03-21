import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Service role client for cross-user queries
    const adminDb = createClient(supabaseUrl, serviceRoleKey);

    // Check admin status
    const { data: adminRow } = await adminDb
      .from("admin_users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSuperAdmin = adminRow.role === "super_admin";

    // Parse action
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      body = await req.json();
    }

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ---- ACTIONS ----

    if (action === "overview") {
      const [users, proUsers, loads, loads7d, expenses] = await Promise.all([
        adminDb.from("profiles").select("id", { count: "exact", head: true }),
        adminDb.from("profiles").select("id", { count: "exact", head: true }).eq("subscription_status", "pro"),
        adminDb.from("loads").select("id", { count: "exact", head: true }),
        adminDb.from("loads").select("id", { count: "exact", head: true }).gte("load_date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]),
        adminDb.from("expenses").select("id", { count: "exact", head: true }),
      ]);
      return json({
        total_users: users.count ?? 0,
        pro_users: proUsers.count ?? 0,
        total_loads: loads.count ?? 0,
        loads_7d: loads7d.count ?? 0,
        total_expenses: expenses.count ?? 0,
      });
    }

    if (action === "list-users" || action === "search-users") {
      const rawEmail = url.searchParams.get("email") || "";
      const email = rawEmail.slice(0, 255).replace(/[%_\\]/g, "");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "50", 10)));

      // Get all auth users for email mapping
      const { data: authUsers } = await adminDb.auth.admin.listUsers({ perPage: 1000 });
      const emailMap = new Map<string, string>();
      authUsers?.users?.forEach((u) => emailMap.set(u.id, u.email || ""));

      // Fetch profiles
      let query = adminDb
        .from("profiles")
        .select("user_id, display_name, subscription_status, subscription_plan, created_at", { count: "exact" });

      if (email) {
        query = query.ilike("display_name", `%${email}%`);
      }

      query = query.order("created_at", { ascending: false });

      const { data: profiles } = await query;

      // Map emails and filter by search term
      let mapped = (profiles || []).map((p) => ({
        ...p,
        email: emailMap.get(p.user_id) || p.display_name || "unknown",
      }));

      if (email) {
        mapped = mapped.filter((p) =>
          p.email.toLowerCase().includes(email.toLowerCase()) ||
          (p.display_name || "").toLowerCase().includes(email.toLowerCase())
        );
      }

      const total = mapped.length;
      const totalPages = Math.ceil(total / perPage);
      const paginated = mapped.slice((page - 1) * perPage, page * perPage);

      // Get counts for paginated results only
      const enriched = await Promise.all(
        paginated.map(async (p) => {
          const [lc, ec] = await Promise.all([
            adminDb.from("loads").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
            adminDb.from("expenses").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
          ]);
          return { ...p, loads_count: lc.count ?? 0, expenses_count: ec.count ?? 0 };
        })
      );

      return json({ users: enriched, total, page, per_page: perPage, total_pages: totalPages });
    }

    if (action === "set-plan-override" && req.method === "POST") {
      if (!isSuperAdmin) return json({ error: "Super admin required" }, 403);
      const targetUserId = body.target_user_id as string;
      const newStatus = body.status as string;
      if (!targetUserId || !["free", "pro"].includes(newStatus)) {
        return json({ error: "Invalid parameters" }, 400);
      }
      // Update both profiles (legacy) and subscriptions (canonical)
      await adminDb.from("profiles").update({ subscription_status: newStatus }).eq("user_id", targetUserId);
      await adminDb.from("subscriptions").upsert({
        user_id: targetUserId,
        plan_key: newStatus === "pro" ? "pro_monthly" : "free",
        status: newStatus === "pro" ? "active" : "free",
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "set-plan-override",
        target_user_id: targetUserId,
        metadata: { new_status: newStatus },
      });
      return json({ success: true });
    }

    if (action === "list-admins") {
      const { data } = await adminDb.from("admin_users").select("*").order("created_at");
      return json(data || []);
    }

    if (action === "add-admin" && req.method === "POST") {
      if (!isSuperAdmin) return json({ error: "Super admin required" }, 403);
      const email = body.email as string;
      if (!email) return json({ error: "Email required" }, 400);

      const { data: authUsers } = await adminDb.auth.admin.listUsers({ perPage: 1000 });
      const target = authUsers?.users?.find((u) => u.email === email);
      if (!target) return json({ error: "User not found" }, 404);

      const { error } = await adminDb.from("admin_users").insert({
        user_id: target.id,
        email: target.email!,
        role: "admin",
      });
      if (error) return json({ error: error.message }, 400);

      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "add-admin",
        target_user_id: target.id,
        metadata: { email },
      });
      return json({ success: true });
    }

    if (action === "remove-admin" && req.method === "POST") {
      if (!isSuperAdmin) return json({ error: "Super admin required" }, 403);
      const targetId = body.target_user_id as string;
      if (!targetId) return json({ error: "target_user_id required" }, 400);
      if (targetId === userId) return json({ error: "Cannot remove yourself" }, 400);

      await adminDb.from("admin_users").delete().eq("user_id", targetId);
      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "remove-admin",
        target_user_id: targetId,
      });
      return json({ success: true });
    }

    if (action === "billing-status") {
      const targetUserId = url.searchParams.get("user_id");
      if (!targetUserId) return json({ error: "user_id required" }, 400);
      const { data } = await adminDb
        .from("profiles")
        .select("subscription_status, subscription_plan, subscription_expires_at, stripe_customer_id, stripe_subscription_id")
        .eq("user_id", targetUserId)
        .maybeSingle();
      return json(data || {});
    }

    if (action === "list-feedback") {
      const category = url.searchParams.get("category") || "";
      let query = adminDb
        .from("feedback_responses")
        .select("id, user_id, response, category, loads_count, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (category) {
        query = query.eq("category", category);
      }
      const { data: feedbackRows } = await query;

      // Get emails for user_ids
      const { data: authUsers } = await adminDb.auth.admin.listUsers({ perPage: 1000 });
      const emailMap = new Map<string, string>();
      authUsers?.users?.forEach((u) => emailMap.set(u.id, u.email || ""));

      const enriched = (feedbackRows || []).map((f) => ({
        ...f,
        email: emailMap.get(f.user_id) || "unknown",
      }));

      return json(enriched);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
