import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getInternalTestEmails } from "../_shared/internal-test-emails.ts";

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
      const sevenDaysAgoDate = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();
      const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();
      const [
        users, loads, loads7d, expenses, expenses7d,
        fuel, fuel7d, recurringActive,
        subsActive, _subsLegacyStub, subsFree, subsCanceled,
        parkingLocs, parkingReports7d, parkingVerifs7d,
        driverPointsActive,
        leadsTotal, leads7d, leads30d,
        parseUsage7d, autoLogs7d, aiInsights7d,
        recTotal, recPending, recApproved, recRejected, recSuspendedStatus, recSuspendedVerif, recActive, recCreated7d, recCreated30d,
        rbTotal, rbActive, rbTrialing, rbPastDue, rbCanceled, rbCancelled, rbInactive,
        rpStarter, rpGrowth, rpFleet,
        oppTotal, oppActive, oppPending, oppApproved, oppRejected, oppFlagged, oppRemoved, oppCreated7d, oppCreated30d,
        appsTotal, apps7d, apps30d,
        crTotal, cr7d, cr30d,
      ] = await Promise.all([
        adminDb.from("profiles").select("id", { count: "exact", head: true }),
        adminDb.from("loads").select("id", { count: "exact", head: true }),
        // Admin "loads created in last 7d" intentionally uses load_date (pickup
        // activity), NOT the driver-facing financial reporting date
        // (COALESCE(dropoff_date, load_date)). This metric measures pickup
        // throughput across the platform and is not a financial total.
        adminDb.from("loads").select("id", { count: "exact", head: true }).gte("load_date", sevenDaysAgoDate),
        adminDb.from("expenses").select("id", { count: "exact", head: true }),
        adminDb.from("expenses").select("id", { count: "exact", head: true }).gte("expense_date", sevenDaysAgoDate),
        adminDb.from("fuel_logs").select("id", { count: "exact", head: true }),
        adminDb.from("fuel_logs").select("id", { count: "exact", head: true }).gte("date", sevenDaysAgoDate),
        adminDb.from("recurring_expense_templates").select("id", { count: "exact", head: true }).eq("is_active", true),
        adminDb.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
        // Legacy slot — returns 0 to avoid reshaping the destructure.
        adminDb.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "__never__"),
        adminDb.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "free"),
        adminDb.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["canceled", "past_due", "unpaid", "incomplete_expired"]),
        adminDb.from("parking_locations").select("id", { count: "exact", head: true }),
        adminDb.from("parking_reports").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("parking_verifications").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("driver_points").select("user_id", { count: "exact", head: true }).gt("weekly_points", 0),
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }),
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgoIso),
        adminDb.from("parse_usage").select("id", { count: "exact", head: true }).gte("used_at", sevenDaysAgoIso),
        adminDb.from("expense_automation_logs").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("ai_insights").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        // Recruiter profiles
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).eq("verification_status", "pending"),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).eq("verification_status", "approved"),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).eq("verification_status", "rejected"),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).eq("status", "suspended"),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).eq("verification_status", "suspended"),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("recruiter_profiles").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgoIso),
        // Recruiter billing
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("status", "trialing"), // trial-allowlist
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("status", "past_due"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("status", "canceled"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("status", "inactive"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("plan", "starter"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("plan", "growth"),
        adminDb.from("recruiter_billing_profiles").select("id", { count: "exact", head: true }).eq("plan", "fleet"),
        // Opportunities
        adminDb.from("opportunities").select("id", { count: "exact", head: true }),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "active"),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).eq("admin_review_status", "pending"),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).eq("admin_review_status", "approved"),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).eq("admin_review_status", "rejected"),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).eq("admin_review_status", "flagged"),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "removed"),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("opportunities").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgoIso),
        // Applications
        adminDb.from("opportunity_applications").select("id", { count: "exact", head: true }),
        adminDb.from("opportunity_applications").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("opportunity_applications").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgoIso),
        // Contact requests
        adminDb.from("recruiter_contact_requests").select("id", { count: "exact", head: true }),
        adminDb.from("recruiter_contact_requests").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("recruiter_contact_requests").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgoIso),
      ]);
      const totalUsers = users.count ?? 0;
      const activePro = (subsActive.count ?? 0) + (_subsLegacyStub.count ?? 0);
      const conversionRate = totalUsers > 0 ? Math.round((activePro / totalUsers) * 1000) / 10 : 0;
      const recSuspendedCombined = Math.max(recSuspendedStatus.count ?? 0, recSuspendedVerif.count ?? 0);

      // -------- Recruiter funnel: derived unique counts (ID-only reads, capped) --------
      const ID_READ_CAP = 5000;
      const [oppsIdRows, appsIdRows, crIdRows, recProfileIdRows] = await Promise.all([
        adminDb.from("opportunities").select("recruiter_id, status").limit(ID_READ_CAP),
        adminDb.from("opportunity_applications").select("recruiter_id").limit(ID_READ_CAP),
        adminDb.from("recruiter_contact_requests").select("recruiter_user_id").limit(ID_READ_CAP),
        adminDb.from("recruiter_profiles").select("id, user_id").limit(ID_READ_CAP),
      ]);

      const recruitersWithOpp = new Set<string>();
      const recruitersWithActiveOpp = new Set<string>();
      for (const r of (oppsIdRows.data ?? []) as Array<{ recruiter_id: string | null; status: string | null }>) {
        if (r.recruiter_id) {
          recruitersWithOpp.add(r.recruiter_id);
          if (r.status === "active") recruitersWithActiveOpp.add(r.recruiter_id);
        }
      }
      const recruitersWithApplication = new Set<string>();
      for (const r of (appsIdRows.data ?? []) as Array<{ recruiter_id: string | null }>) {
        if (r.recruiter_id) recruitersWithApplication.add(r.recruiter_id);
      }
      // Map recruiter_user_id -> recruiter_profiles.id for contact requests
      const userIdToProfileId = new Map<string, string>();
      for (const p of (recProfileIdRows.data ?? []) as Array<{ id: string; user_id: string | null }>) {
        if (p.user_id) userIdToProfileId.set(p.user_id, p.id);
      }
      const recruitersWithContactRequest = new Set<string>();
      for (const r of (crIdRows.data ?? []) as Array<{ recruiter_user_id: string | null }>) {
        if (!r.recruiter_user_id) continue;
        const pid = userIdToProfileId.get(r.recruiter_user_id);
        if (pid) recruitersWithContactRequest.add(pid);
        else recruitersWithContactRequest.add(r.recruiter_user_id); // fallback dedupe by user id
      }

      const recruiter_funnel_signups = recTotal.count ?? 0;
      const recruiter_funnel_approved = recApproved.count ?? 0;
      const recruiter_funnel_active = recActive.count ?? 0;
      const recruiter_funnel_with_opportunity = recruitersWithOpp.size;
      const recruiter_funnel_with_active_opportunity = recruitersWithActiveOpp.size;
      const recruiter_funnel_with_application = recruitersWithApplication.size;
      const recruiter_funnel_with_contact_request = recruitersWithContactRequest.size;

      const rate = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
      const recruiter_approval_rate = rate(recruiter_funnel_approved, recruiter_funnel_signups);
      const recruiter_activation_rate = rate(recruiter_funnel_active, recruiter_funnel_signups);
      const recruiter_posting_rate = rate(recruiter_funnel_with_opportunity, recruiter_funnel_signups);
      const recruiter_active_posting_rate = rate(recruiter_funnel_with_active_opportunity, recruiter_funnel_signups);
      const appDen = recruiter_funnel_with_active_opportunity > 0 ? recruiter_funnel_with_active_opportunity : recruiter_funnel_signups;
      const recruiter_application_rate = rate(recruiter_funnel_with_application, appDen);
      const crDen = recruiter_funnel_with_application > 0 ? recruiter_funnel_with_application : recruiter_funnel_signups;
      const recruiter_contact_request_rate = rate(recruiter_funnel_with_contact_request, crDen);

      // Score components
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
      const recruiter_health_approval_points = Math.round(clamp((recruiter_approval_rate / 100) * 20, 20) * 10) / 10;
      const recruiter_health_posting_points = Math.round(clamp((recruiter_posting_rate / 100) * 25, 25) * 10) / 10;
      const recruiter_health_active_posting_points = Math.round(clamp((recruiter_active_posting_rate / 100) * 20, 20) * 10) / 10;
      const recruiter_health_application_points = Math.round(clamp((recruiter_application_rate / 100) * 20, 20) * 10) / 10;
      const recruiter_health_contact_points = Math.round(clamp((recruiter_contact_request_rate / 100) * 15, 15) * 10) / 10;
      let recruiter_marketplace_health_score = Math.round(
        recruiter_health_approval_points +
          recruiter_health_posting_points +
          recruiter_health_active_posting_points +
          recruiter_health_application_points +
          recruiter_health_contact_points,
      );
      if (recruiter_funnel_signups === 0) recruiter_marketplace_health_score = 0;
      recruiter_marketplace_health_score = clamp(recruiter_marketplace_health_score, 100);

      let recruiter_marketplace_health_label = "Early / insufficient activity";
      if (recruiter_funnel_signups > 0) {
        if (recruiter_marketplace_health_score >= 80) recruiter_marketplace_health_label = "Strong";
        else if (recruiter_marketplace_health_score >= 60) recruiter_marketplace_health_label = "Healthy";
        else if (recruiter_marketplace_health_score >= 40) recruiter_marketplace_health_label = "Needs attention";
        else if (recruiter_marketplace_health_score >= 20) recruiter_marketplace_health_label = "Weak";
        else recruiter_marketplace_health_label = "Early / insufficient activity";
      }

      const recruiter_health_low_approval = recruiter_funnel_signups >= 3 && recruiter_approval_rate < 50;
      const recruiter_health_low_posting = recruiter_funnel_signups >= 3 && recruiter_posting_rate < 40;
      const recruiter_health_low_applications =
        recruiter_funnel_with_active_opportunity >= 3 && recruiter_application_rate < 30;
      const recruiter_health_low_contact_requests =
        recruiter_funnel_with_application >= 3 && recruiter_contact_request_rate < 30;

      let recruiter_marketplace_health_summary: string;
      if (recruiter_funnel_signups === 0) {
        recruiter_marketplace_health_summary =
          "No recruiter signups yet. Health score will become meaningful once recruiters join the marketplace.";
      } else if (recruiter_funnel_signups < 3) {
        recruiter_marketplace_health_summary =
          "Recruiter activity is early. More signups and opportunities are needed before the score is meaningful.";
      } else if (recruiter_marketplace_health_score >= 80) {
        recruiter_marketplace_health_summary =
          "Recruiter marketplace is strong across approvals, postings, and driver interest.";
      } else if (recruiter_marketplace_health_score >= 60) {
        recruiter_marketplace_health_summary =
          "Recruiter marketplace is healthy. Watch the flagged items to keep momentum.";
      } else if (recruiter_health_low_approval) {
        recruiter_marketplace_health_summary =
          "Approval rate is low. Review pending recruiters and tighten verification workflow.";
      } else if (recruiter_health_low_posting) {
        recruiter_marketplace_health_summary =
          "Recruiters are signing up, but more need to post active opportunities.";
      } else if (recruiter_health_low_applications) {
        recruiter_marketplace_health_summary =
          "Opportunities are live but driver applications are low. Review opportunity quality and visibility.";
      } else if (recruiter_health_low_contact_requests) {
        recruiter_marketplace_health_summary =
          "Driver applications are coming in but contact requests are low. Encourage recruiter follow-up.";
      } else {
        recruiter_marketplace_health_summary =
          "Recruiter marketplace needs attention. Check the score breakdown for the weakest stages.";
      }

      return json({
        total_users: totalUsers,
        subs_free: subsFree.count ?? 0,
        subs_active_pro: activePro,
        subs_canceled: subsCanceled.count ?? 0,
        pro_conversion_rate: conversionRate,
        total_loads: loads.count ?? 0,
        loads_7d: loads7d.count ?? 0,
        total_expenses: expenses.count ?? 0,
        expenses_7d: expenses7d.count ?? 0,
        total_fuel_logs: fuel.count ?? 0,
        fuel_logs_7d: fuel7d.count ?? 0,
        recurring_templates_active: recurringActive.count ?? 0,
        parking_locations_total: parkingLocs.count ?? 0,
        parking_reports_7d: parkingReports7d.count ?? 0,
        parking_verifications_7d: parkingVerifs7d.count ?? 0,
        driver_points_active_users: driverPointsActive.count ?? 0,
        lead_magnet_signups_total: leadsTotal.count ?? 0,
        lead_magnet_signups_7d: leads7d.count ?? 0,
        lead_magnet_signups_30d: leads30d.count ?? 0,
        parse_usage_7d: parseUsage7d.count ?? 0,
        expense_automation_7d: autoLogs7d.count ?? 0,
        ai_insights_7d: aiInsights7d.count ?? 0,
        // Recruiter marketplace
        recruiters_total: recTotal.count ?? 0,
        recruiters_pending: recPending.count ?? 0,
        recruiters_approved: recApproved.count ?? 0,
        recruiters_rejected: recRejected.count ?? 0,
        recruiters_suspended: recSuspendedCombined,
        recruiters_active: recActive.count ?? 0,
        recruiters_created_7d: recCreated7d.count ?? 0,
        recruiters_created_30d: recCreated30d.count ?? 0,
        recruiter_billing_total: rbTotal.count ?? 0,
        recruiter_billing_active: rbActive.count ?? 0,
        recruiter_billing_trialing: rbTrialing.count ?? 0,
        recruiter_billing_past_due: rbPastDue.count ?? 0,
        recruiter_billing_canceled: (rbCanceled.count ?? 0) + (rbCancelled.count ?? 0),
        recruiter_billing_inactive: rbInactive.count ?? 0,
        recruiter_plan_starter: rpStarter.count ?? 0,
        recruiter_plan_growth: rpGrowth.count ?? 0,
        recruiter_plan_fleet: rpFleet.count ?? 0,
        opportunities_total: oppTotal.count ?? 0,
        opportunities_active: oppActive.count ?? 0,
        opportunities_pending: oppPending.count ?? 0,
        opportunities_approved: oppApproved.count ?? 0,
        opportunities_rejected: oppRejected.count ?? 0,
        opportunities_flagged: oppFlagged.count ?? 0,
        opportunities_removed: oppRemoved.count ?? 0,
        opportunities_created_7d: oppCreated7d.count ?? 0,
        opportunities_created_30d: oppCreated30d.count ?? 0,
        applications_total: appsTotal.count ?? 0,
        applications_7d: apps7d.count ?? 0,
        applications_30d: apps30d.count ?? 0,
        contact_requests_total: crTotal.count ?? 0,
        contact_requests_7d: cr7d.count ?? 0,
        contact_requests_30d: cr30d.count ?? 0,
        // Phase 7: Recruiter funnel
        recruiter_funnel_signups,
        recruiter_funnel_approved,
        recruiter_funnel_active,
        recruiter_funnel_with_opportunity,
        recruiter_funnel_with_active_opportunity,
        recruiter_funnel_with_application,
        recruiter_funnel_with_contact_request,
        // Conversion rates (percentages)
        recruiter_approval_rate,
        recruiter_activation_rate,
        recruiter_posting_rate,
        recruiter_active_posting_rate,
        recruiter_application_rate,
        recruiter_contact_request_rate,
        // Activity aliases (equivalent to Phase 2 fields, kept alongside for clarity)
        recruiter_marketplace_recruiters_7d: recCreated7d.count ?? 0,
        recruiter_marketplace_recruiters_30d: recCreated30d.count ?? 0,
        recruiter_marketplace_opportunities_7d: oppCreated7d.count ?? 0,
        recruiter_marketplace_opportunities_30d: oppCreated30d.count ?? 0,
        recruiter_marketplace_applications_7d: apps7d.count ?? 0,
        recruiter_marketplace_applications_30d: apps30d.count ?? 0,
        recruiter_marketplace_contact_requests_7d: cr7d.count ?? 0,
        recruiter_marketplace_contact_requests_30d: cr30d.count ?? 0,
        // Health score
        recruiter_marketplace_health_score,
        recruiter_marketplace_health_label,
        recruiter_marketplace_health_summary,
        recruiter_health_approval_points,
        recruiter_health_posting_points,
        recruiter_health_active_posting_points,
        recruiter_health_application_points,
        recruiter_health_contact_points,
        recruiter_health_low_approval,
        recruiter_health_low_posting,
        recruiter_health_low_applications,
        recruiter_health_low_contact_requests,
      });
    }


    if (action === "parking-overview") {
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();
      const [locs, reports7d, verifs7d, allReports] = await Promise.all([
        adminDb.from("parking_locations").select("id", { count: "exact", head: true }),
        adminDb.from("parking_reports").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("parking_verifications").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("parking_reports").select("parking_id").limit(5000),
      ]);
      const counts = new Map<string, number>();
      for (const r of (allReports.data ?? []) as Array<{ parking_id: string }>) {
        counts.set(r.parking_id, (counts.get(r.parking_id) ?? 0) + 1);
      }
      const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      let topLocations: Array<{ id: string; name: string; address: string | null; type: string; report_count: number }> = [];
      if (topIds.length > 0) {
        const { data: locRows } = await adminDb
          .from("parking_locations")
          .select("id, name, address, type")
          .in("id", topIds.map(([id]) => id));
        const locMap = new Map((locRows ?? []).map((l) => [l.id, l]));
        topLocations = topIds.map(([id, count]) => {
          const l = locMap.get(id);
          return {
            id,
            name: l?.name ?? "(unknown)",
            address: l?.address ?? null,
            type: l?.type ?? "—",
            report_count: count,
          };
        });
      }
      return json({
        total_locations: locs.count ?? 0,
        reports_7d: reports7d.count ?? 0,
        verifications_7d: verifs7d.count ?? 0,
        top_locations: topLocations,
      });
    }

    if (action === "list-parking-reports") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
      const { data: reports } = await adminDb
        .from("parking_reports")
        .select("id, parking_id, user_id, status, safety_rating, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      const parkingIds = [...new Set((reports ?? []).map((r) => r.parking_id))];
      const userIds = [...new Set((reports ?? []).map((r) => r.user_id))];
      const [{ data: locs }, { data: profs }] = await Promise.all([
        parkingIds.length > 0
          ? adminDb.from("parking_locations").select("id, name").in("id", parkingIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
        userIds.length > 0
          ? adminDb.from("profiles").select("user_id, driver_handle, handle_emoji, handle_public").in("user_id", userIds)
          : Promise.resolve({ data: [] as Array<{ user_id: string; driver_handle: string | null; handle_emoji: string | null; handle_public: boolean }> }),
      ]);
      const locMap = new Map((locs ?? []).map((l) => [l.id, l.name]));
      const profMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
      const enriched = (reports ?? []).map((r) => {
        const p = profMap.get(r.user_id);
        const handle = p?.handle_public && p?.driver_handle
          ? `${p.driver_handle}${p.handle_emoji ? " " + p.handle_emoji : ""}`
          : `Driver #${(Math.abs([...r.user_id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) % 10000).toString().padStart(4, "0")}`;
        return {
          ...r,
          location_name: locMap.get(r.parking_id) ?? "(unknown)",
          reporter_handle: handle,
        };
      });
      return json({ reports: enriched });
    }

    if (action === "driver-points-overview") {
      const { data: rows } = await adminDb
        .from("driver_points")
        .select("user_id, total_points, weekly_points, streak_days");
      const all = (rows ?? []) as Array<{ user_id: string; total_points: number; weekly_points: number; streak_days: number }>;
      const tiers = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0 };
      let totalAwarded = 0;
      let activeWeek = 0;
      let topStreak = 0;
      for (const r of all) {
        totalAwarded += r.total_points;
        if (r.weekly_points > 0) activeWeek++;
        if (r.streak_days > topStreak) topStreak = r.streak_days;
        if (r.total_points >= 400) tiers.Platinum++;
        else if (r.total_points >= 150) tiers.Gold++;
        else if (r.total_points >= 50) tiers.Silver++;
        else tiers.Bronze++;
      }
      return json({
        active_drivers_week: activeWeek,
        total_points_awarded: totalAwarded,
        top_streak: topStreak,
        tiers,
        total_drivers: all.length,
      });
    }

    if (action === "driver-leaderboard") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "25", 10), 100);
      const { data, error } = await adminDb.rpc("get_weekly_driver_leaderboard", { _limit: limit });
      if (error) return json({ error: error.message }, 500);
      return json({ rows: data ?? [] });
    }

    if (action === "lead-magnet-overview") {
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();
      const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();
      const [total, last7, last30, converted] = await Promise.all([
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }),
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso),
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgoIso),
        adminDb.from("lead_magnet_signups").select("id", { count: "exact", head: true }).not("converted_user_id", "is", null),
      ]);
      const t = total.count ?? 0;
      const c = converted.count ?? 0;
      return json({
        total: t,
        last_7d: last7.count ?? 0,
        last_30d: last30.count ?? 0,
        converted: c,
        conversion_rate: t > 0 ? Math.round((c / t) * 1000) / 10 : 0,
      });
    }

    if (action === "list-lead-magnet-signups") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
      const { data } = await adminDb
        .from("lead_magnet_signups")
        .select("id, email, first_name, source_page, utm_source, utm_campaign, created_at, downloaded_at, converted_user_id")
        .order("created_at", { ascending: false })
        .limit(limit);
      return json({ signups: data ?? [] });
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
      const [{ data: settingsRows }, { data: subsRows }, { data: pointsRows }] = await Promise.all([
        adminDb.from("user_settings").select("user_id, lifecycle_emails_opt_in").in("user_id", userIdsForPage),
        adminDb.from("subscriptions").select("user_id, status, plan_key").in("user_id", userIdsForPage),
        adminDb.from("driver_points").select("user_id, total_points").in("user_id", userIdsForPage),
      ]);
      const optedOut = new Set<string>();
      for (const s of (settingsRows || []) as Array<{ user_id: string; lifecycle_emails_opt_in: boolean | null }>) {
        if (s.lifecycle_emails_opt_in === false) optedOut.add(s.user_id);
      }
      const subMap = new Map<string, { status: string; plan_key: string }>();
      for (const s of (subsRows || []) as Array<{ user_id: string; status: string; plan_key: string }>) {
        subMap.set(s.user_id, { status: s.status, plan_key: s.plan_key });
      }
      const pointsMap = new Map<string, number>();
      for (const p of (pointsRows || []) as Array<{ user_id: string; total_points: number }>) {
        pointsMap.set(p.user_id, p.total_points);
      }

      const enriched = await Promise.all(
        paginated.map(async (p) => {
          const [lc, ec, fc] = await Promise.all([
            adminDb.from("loads").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
            adminDb.from("expenses").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
            adminDb.from("fuel_logs").select("id", { count: "exact", head: true }).eq("user_id", p.user_id),
          ]);
          const sub = subMap.get(p.user_id);
          return {
            ...p,
            loads_count: lc.count ?? 0,
            expenses_count: ec.count ?? 0,
            fuel_logs_count: fc.count ?? 0,
            driver_points_total: pointsMap.get(p.user_id) ?? 0,
            sub_status: sub?.status ?? "free",
            sub_plan_key: sub?.plan_key ?? "free",
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
      const TEST_ACCOUNTS = getInternalTestEmails();


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
        return json({ cohorts: [], emailImpact: { day0: null, day1: null, day2: null, day4: null, day7: null } });
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

      // Email impact — for each lifecycle email,
      // % of recipients who logged a load AFTER receiving the email.
      const TEMPLATES_FOR_IMPACT = [
        "lifecycle-day0",
        "welcome",
        "lifecycle-day1",
        "lifecycle-day2",
        "lifecycle-day4",
        "lifecycle-day7",
      ] as const;
      const emailImpact: Record<string, { sent: number; activated_after: number; rate: number } | null> = {
        day0: null,
        day1: null,
        day2: null,
        day4: null,
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
      emailImpact.day1 = computeImpact("lifecycle-day1");
      emailImpact.day2 = computeImpact("lifecycle-day2");
      emailImpact.day4 = computeImpact("lifecycle-day4");
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
      const TEST_ACCOUNTS = getInternalTestEmails();
      const ALLOWED_TEMPLATES = new Set([
        "welcome",
        "lifecycle-day1",
        "lifecycle-day2",
        "lifecycle-day4",
        "lifecycle-day7",
        "inactive-feedback",
      ]);

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
          headers: {
            // Internal server-to-server auth — see send-transactional-email policy.
            "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
          },
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

    if (action === "list-suppressed") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
      const { data, error } = await adminDb
        .from("suppressed_emails")
        .select("id, email, reason, created_at, metadata")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: error.message }, 500);
      return json({ suppressed: data || [] });
    }

    if (action === "remove-suppression" && req.method === "POST") {
      if (!isSuperAdmin) return json({ error: "Super admin required" }, 403);
      const email = String(body.email || "").toLowerCase().trim();
      if (!email) return json({ error: "email required" }, 400);
      const { error } = await adminDb.from("suppressed_emails").delete().eq("email", email);
      if (error) return json({ error: error.message }, 500);
      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "remove-suppression",
        metadata: { email },
      });
      return json({ success: true });
    }

    if (action === "retry-email" && req.method === "POST") {
      const logId = String(body.log_id || "");
      if (!logId) return json({ error: "log_id required" }, 400);
      const { data: row, error: rowErr } = await adminDb
        .from("email_send_log")
        .select("id, message_id, template_name, recipient_email, status, metadata")
        .eq("id", logId)
        .maybeSingle();
      if (rowErr || !row) return json({ error: "Log entry not found" }, 404);

      const meta = (row.metadata || {}) as Record<string, unknown>;
      const idemKey =
        (meta.idempotencyKey as string | undefined) ||
        (row.message_id ? `retry-${row.message_id}` : `retry-${row.id}-${Date.now()}`);
      const templateData = (meta.templateData as Record<string, unknown> | undefined) || {};

      const { error: invokeErr } = await adminDb.functions.invoke("send-transactional-email", {
        headers: {
          // Internal server-to-server auth — see send-transactional-email policy.
          "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
        },
        body: {
          templateName: row.template_name,
          recipientEmail: row.recipient_email,
          idempotencyKey: idemKey,
          templateData,
        },
      });

      await adminDb.from("admin_audit_log").insert({
        admin_user_id: userId,
        action: "retry-email",
        metadata: { log_id: logId, template: row.template_name, recipient: row.recipient_email, error: invokeErr?.message },
      });

      if (invokeErr) return json({ error: invokeErr.message }, 500);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
