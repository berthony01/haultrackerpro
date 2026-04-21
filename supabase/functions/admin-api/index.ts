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
      const userIdsForPage = paginated.map((p) => p.user_id);
      const [{ data: settingsRows }] = await Promise.all([
        adminDb.from("user_settings").select("user_id, lifecycle_emails_opt_in").in("user_id", userIdsForPage),
      ]);
      const optedOut = new Set<string>();
      for (const s of (settingsRows || []) as Array<{ user_id: string; lifecycle_emails_opt_in: boolean | null }>) {
        if (s.lifecycle_emails_opt_in === false) optedOut.add(s.user_id);
      }

      const enriched = await Promise.all(
        paginated.map(async (p) => {
          const [lc, ec] = await Promise.all([
            adminDb.from("loads").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
            adminDb.from("expenses").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
          ]);
          return {
            ...p,
            loads_count: lc.count ?? 0,
            expenses_count: ec.count ?? 0,
            lifecycle_opted_out: optedOut.has(p.user_id),
          };
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

    if (action === "list-emails") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
      const statusFilter = url.searchParams.get("status"); // sent | failed | dlq | suppressed | pending | bounced | complained | null
      const templateFilter = url.searchParams.get("template"); // template_name | null

      // Pull a wider window so deduplication still yields `limit` unique emails
      const fetchSize = Math.max(limit * 4, 200);
      let query = adminDb
        .from("email_send_log")
        .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(fetchSize);

      if (templateFilter) query = query.eq("template_name", templateFilter);

      const { data: rows, error: emailsErr } = await query;
      if (emailsErr) return json({ error: emailsErr.message }, 500);

      // Deduplicate by message_id, keeping the latest (rows already sorted desc)
      const seen = new Set<string>();
      const deduped: typeof rows = [] as never;
      for (const r of rows || []) {
        const key = r.message_id || `__noid_${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
      }

      let filtered = deduped;
      if (statusFilter) filtered = filtered.filter((r) => r.status === statusFilter);

      // Distinct templates for filter dropdown
      const { data: templateRows } = await adminDb
        .from("email_send_log")
        .select("template_name")
        .order("template_name", { ascending: true });
      const templates = Array.from(
        new Set((templateRows || []).map((t) => t.template_name).filter(Boolean))
      );

      // Summary counts (over the deduped window, before status filter)
      const summary = { total: deduped.length, sent: 0, failed: 0, suppressed: 0, pending: 0 };
      for (const r of deduped) {
        if (r.status === "sent") summary.sent++;
        else if (r.status === "dlq" || r.status === "failed" || r.status === "bounced" || r.status === "complained") summary.failed++;
        else if (r.status === "suppressed") summary.suppressed++;
        else if (r.status === "pending") summary.pending++;
      }

      return json({ emails: filtered.slice(0, limit), templates, summary });
    }

    if (action === "activation") {
      // Cohort activation: signup-week buckets, % who logged 1st load.
      // Plus impact of Day 0 (welcome) / Day 2 / Day 7 lifecycle emails.
      const TEST_ACCOUNTS = new Set([
        "berthonyxyz@gmail.com",
        "peejayslifestyle@gmail.com",
        "wysdomaniac@gmail.com",
      ]);

      // Pull all auth users (paginated)
      const allUsers: Array<{ id: string; email?: string; created_at: string }> = [];
      let pg = 1;
      while (true) {
        const { data, error } = await adminDb.auth.admin.listUsers({ page: pg, perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        allUsers.push(
          ...((data?.users || []) as Array<{ id: string; email?: string; created_at: string }>),
        );
        if (!data?.users || data.users.length < 200) break;
        pg++;
        if (pg > 25) break;
      }

      const realUsers = allUsers.filter(
        (u) => !TEST_ACCOUNTS.has((u.email || "").toLowerCase().trim()),
      );

      const userIds = realUsers.map((u) => u.id);
      if (userIds.length === 0) {
        return json({ cohorts: [], emailImpact: { day0: null, day2: null, day7: null } });
      }

      // Earliest load per user (cap query at 5000 rows for safety)
      const { data: loadsData } = await adminDb
        .from("loads")
        .select("user_id, created_at")
        .in("user_id", userIds)
        .order("created_at", { ascending: true })
        .limit(5000);

      const firstLoadByUser = new Map<string, string>();
      for (const r of (loadsData || []) as Array<{ user_id: string; created_at: string }>) {
        if (!firstLoadByUser.has(r.user_id)) firstLoadByUser.set(r.user_id, r.created_at);
      }

      // Bucket helpers — ISO week (YYYY-Www) by signup
      const isoWeek = (iso: string) => {
        const d = new Date(iso);
        const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = (target.getUTCDay() + 6) % 7;
        target.setUTCDate(target.getUTCDate() - dayNum + 3);
        const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
        return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
      };

      type Cohort = {
        cohort: string;
        signups: number;
        activated: number;
        activation_rate: number;
        avg_hours_to_first_load: number | null;
      };
      const cohortMap = new Map<string, { signups: number; activated: number; ttfHours: number[] }>();
      for (const u of realUsers) {
        const c = isoWeek(u.created_at);
        if (!cohortMap.has(c)) cohortMap.set(c, { signups: 0, activated: 0, ttfHours: [] });
        const entry = cohortMap.get(c)!;
        entry.signups++;
        const firstLoad = firstLoadByUser.get(u.id);
        if (firstLoad) {
          entry.activated++;
          const hours = (new Date(firstLoad).getTime() - new Date(u.created_at).getTime()) / 3600000;
          if (hours >= 0 && hours < 24 * 365) entry.ttfHours.push(hours);
        }
      }
      const cohorts: Cohort[] = [...cohortMap.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, 12)
        .map(([cohort, v]) => ({
          cohort,
          signups: v.signups,
          activated: v.activated,
          activation_rate: v.signups > 0 ? Math.round((v.activated / v.signups) * 1000) / 10 : 0,
          avg_hours_to_first_load:
            v.ttfHours.length > 0
              ? Math.round((v.ttfHours.reduce((a, b) => a + b, 0) / v.ttfHours.length) * 10) / 10
              : null,
        }));

      // Email impact — for each lifecycle email (welcome, lifecycle-day2, lifecycle-day7),
      // % of recipients who logged a load AFTER receiving the email.
      const TEMPLATES_FOR_IMPACT = ["lifecycle-day0", "welcome", "lifecycle-day2", "lifecycle-day7"] as const;
      const emailImpact: Record<string, { sent: number; activated_after: number; rate: number } | null> = {
        day0: null,
        day2: null,
        day7: null,
      };

      // Pull sent rows for these templates (dedupe by message_id keeping earliest 'sent')
      const { data: emailRows } = await adminDb
        .from("email_send_log")
        .select("message_id, template_name, recipient_email, status, created_at")
        .in("template_name", TEMPLATES_FOR_IMPACT as unknown as string[])
        .eq("status", "sent")
        .order("created_at", { ascending: true })
        .limit(5000);

      const emailToUser = new Map<string, string>();
      for (const u of realUsers) {
        if (u.email) emailToUser.set(u.email.toLowerCase(), u.id);
      }

      const perTemplate = new Map<string, { recipients: Map<string, string> }>();
      for (const t of TEMPLATES_FOR_IMPACT) perTemplate.set(t, { recipients: new Map() });
      for (const r of (emailRows || []) as Array<{
        template_name: string;
        recipient_email: string;
        created_at: string;
      }>) {
        const t = perTemplate.get(r.template_name);
        if (!t) continue;
        const recipKey = r.recipient_email.toLowerCase();
        // Earliest send wins — already sorted asc
        if (!t.recipients.has(recipKey)) t.recipients.set(recipKey, r.created_at);
      }

      const computeImpact = (templateName: string) => {
        const t = perTemplate.get(templateName);
        if (!t || t.recipients.size === 0) return null;
        let activated = 0;
        let total = 0;
        for (const [emailLower, sentAt] of t.recipients) {
          const uid = emailToUser.get(emailLower);
          if (!uid) continue;
          total++;
          const firstLoad = firstLoadByUser.get(uid);
          if (firstLoad && new Date(firstLoad).getTime() >= new Date(sentAt).getTime()) {
            activated++;
          }
        }
        if (total === 0) return null;
        return {
          sent: total,
          activated_after: activated,
          rate: Math.round((activated / total) * 1000) / 10,
        };
      };

      // Day 0 = lifecycle-day0 OR welcome (legacy). Combine recipients.
      const day0FromDay0 = computeImpact("lifecycle-day0");
      const day0FromWelcome = computeImpact("welcome");
      const merge = (
        a: { sent: number; activated_after: number; rate: number } | null,
        b: { sent: number; activated_after: number; rate: number } | null,
      ) => {
        if (!a && !b) return null;
        const sent = (a?.sent ?? 0) + (b?.sent ?? 0);
        const activated_after = (a?.activated_after ?? 0) + (b?.activated_after ?? 0);
        return { sent, activated_after, rate: sent > 0 ? Math.round((activated_after / sent) * 1000) / 10 : 0 };
      };
      emailImpact.day0 = merge(day0FromDay0, day0FromWelcome);
      emailImpact.day2 = computeImpact("lifecycle-day2");
      emailImpact.day7 = computeImpact("lifecycle-day7");

      // Headline: overall activation rate (excluding test accounts)
      const totalSignups = realUsers.length;
      const totalActivated = realUsers.filter((u) => firstLoadByUser.has(u.id)).length;
      const overallRate =
        totalSignups > 0 ? Math.round((totalActivated / totalSignups) * 1000) / 10 : 0;

      return json({
        overall: { signups: totalSignups, activated: totalActivated, rate: overallRate },
        cohorts,
        emailImpact,
      });
    }

    if (action === "send-lifecycle-test" && req.method === "POST") {
      const TEST_ACCOUNTS = new Set([
        "berthonyxyz@gmail.com",
        "peejayslifestyle@gmail.com",
        "wysdomaniac@gmail.com",
      ]);
      const ALLOWED_TEMPLATES = new Set(["welcome", "lifecycle-day2", "lifecycle-day7"]);

      const templateName = String(body.templateName || "");
      const mode = String(body.mode || "single"); // 'single' | 'all-inactive'
      const includeTestAccounts = body.includeTestAccounts === true;
      const recipientUserId = body.recipientUserId as string | undefined;

      if (!ALLOWED_TEMPLATES.has(templateName)) {
        return json({ error: "Invalid templateName" }, 400);
      }

      const RECENT_EMAIL_CHANGE_HOURS = 72;
      const now = Date.now();
      const recentEmailChangeCutoff = now - RECENT_EMAIL_CHANGE_HOURS * 60 * 60 * 1000;
      const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");

      // Pull all auth users
      type AuthUser = {
        id: string;
        email?: string;
        email_confirmed_at?: string | null;
        confirmed_at?: string | null;
        email_change_sent_at?: string | null;
        new_email?: string | null;
        user_metadata: Record<string, unknown>;
      };
      const allUsers: AuthUser[] = [];
      let pg = 1;
      while (true) {
        const { data, error } = await adminDb.auth.admin.listUsers({ page: pg, perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        allUsers.push(...((data?.users || []) as unknown as AuthUser[]));
        if (!data?.users || data.users.length < 200) break;
        pg++;
        if (pg > 25) break;
      }

      const sendOne = async (u: AuthUser): Promise<{ email: string; status: string; reason?: string }> => {
        const email = (u.email || "").toLowerCase().trim();
        if (!email) return { email: "(none)", status: "skipped", reason: "no email" };
        const name = (u.user_metadata?.display_name as string | undefined) || undefined;
        const { error } = await adminDb.functions.invoke("send-transactional-email", {
          body: {
            templateName,
            recipientEmail: email,
            idempotencyKey: `${templateName}-test-${u.id}-${yyyymmdd}`,
            templateData: { name },
          },
        });
        if (error) {
          return { email, status: "failed", reason: error.message };
        }
        return { email, status: "sent" };
      };

      // ---- single send ----
      if (mode === "single") {
        if (!recipientUserId) return json({ error: "recipientUserId required" }, 400);
        const u = allUsers.find((x) => x.id === recipientUserId);
        if (!u) return json({ error: "User not found" }, 404);
        const result = await sendOne(u);
        await adminDb.from("admin_audit_log").insert({
          admin_user_id: userId,
          action: "send-lifecycle-test",
          target_user_id: recipientUserId,
          metadata: { templateName, mode: "single", result },
        });
        return json({ mode: "single", result });
      }

      // ---- bulk: all inactive ----
      // Eligibility: verified, no recent email change, opted-in, zero loads, not test (unless toggled)
      const eligible: AuthUser[] = [];
      const skipped: Array<{ email: string; reason: string }> = [];

      for (const u of allUsers) {
        const email = (u.email || "").toLowerCase().trim();
        if (!email) { skipped.push({ email: "(none)", reason: "no email" }); continue; }
        if (!includeTestAccounts && TEST_ACCOUNTS.has(email)) {
          skipped.push({ email, reason: "test account" }); continue;
        }
        const verified = !!(u.email_confirmed_at || u.confirmed_at);
        if (!verified) { skipped.push({ email, reason: "unverified" }); continue; }
        if (u.new_email) { skipped.push({ email, reason: "pending email change" }); continue; }
        if (u.email_change_sent_at) {
          const t = new Date(u.email_change_sent_at).getTime();
          if (!Number.isNaN(t) && t > recentEmailChangeCutoff) {
            skipped.push({ email, reason: "recent email change" }); continue;
          }
        }
        eligible.push(u);
      }

      const eligibleIds = eligible.map((u) => u.id);
      if (eligibleIds.length === 0) {
        return json({ mode: "all-inactive", sent: 0, skipped, results: [] });
      }

      // Loads gate
      const { data: loadsData } = await adminDb
        .from("loads")
        .select("user_id")
        .in("user_id", eligibleIds);
      const loadCount = new Map<string, number>();
      for (const r of (loadsData ?? []) as Array<{ user_id: string }>) {
        loadCount.set(r.user_id, (loadCount.get(r.user_id) ?? 0) + 1);
      }

      // Opt-in gate
      const { data: settingsRows } = await adminDb
        .from("user_settings")
        .select("user_id, lifecycle_emails_opt_in")
        .in("user_id", eligibleIds);
      const optedIn = new Map<string, boolean>();
      for (const r of (settingsRows ?? []) as Array<{ user_id: string; lifecycle_emails_opt_in: boolean | null }>) {
        optedIn.set(r.user_id, r.lifecycle_emails_opt_in !== false);
      }

      const finalRecipients: AuthUser[] = [];
      for (const u of eligible) {
        const email = (u.email || "").toLowerCase().trim();
        if ((loadCount.get(u.id) ?? 0) > 0) {
          skipped.push({ email, reason: "has loads" }); continue;
        }
        if (optedIn.get(u.id) === false) {
          skipped.push({ email, reason: "opted out" }); continue;
        }
        finalRecipients.push(u);
      }

      const results: Array<{ email: string; status: string; reason?: string }> = [];
      let sent = 0;
      for (const u of finalRecipients) {
        const r = await sendOne(u);
        if (r.status === "sent") sent++;
        results.push(r);
      }

      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "send-lifecycle-test",
        metadata: { templateName, mode: "all-inactive", sent, attempted: finalRecipients.length, skipped_count: skipped.length },
      });

      return json({ mode: "all-inactive", sent, attempted: finalRecipients.length, skipped, results });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
