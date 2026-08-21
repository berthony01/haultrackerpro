import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '@/hooks/useAdmin';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Users, Shield, CreditCard, BarChart3, Search, UserPlus, Trash2, Crown, MessageSquare, Mail, RefreshCw, TrendingUp, ParkingCircle, Trophy, Gift, Sparkles, Briefcase, Building2, Truck, Share2, ScrollText, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { AdminOpportunitiesPanel } from '@/components/admin/opportunities/AdminOpportunitiesPanel';
import { AdminRecruitersPanel } from '@/components/admin/opportunities/AdminRecruitersPanel';
import { AdminContractsPanel } from '@/components/admin/contracts/AdminContractsPanel';
import { AdminReferralOversightPanel } from '@/components/admin/referrals/AdminReferralOversightPanel';
import { AdminShell } from '@/components/admin/AdminShell';
import { AdminOverviewPremium } from '@/components/admin/AdminOverviewPremium';
import { AdminAuditLogPanel } from '@/components/admin/audit/AdminAuditLogPanel';
import { AdminApplicationsPanel } from '@/components/admin/applications/AdminApplicationsPanel';
import { AdminRecruiterLeaderboardPanel } from '@/components/admin/recruiters/AdminRecruiterLeaderboardPanel';
import { INTERNAL_TEST_ACCOUNTS } from '@/lib/internalTestAccounts';

interface OverviewData {
  total_users: number;
  subs_free: number;
  subs_active_pro: number;
  subs_canceled: number;
  pro_conversion_rate: number;
  total_loads: number;
  loads_7d: number;
  total_expenses: number;
  expenses_7d: number;
  total_fuel_logs: number;
  fuel_logs_7d: number;
  recurring_templates_active: number;
  parking_locations_total: number;
  parking_reports_7d: number;
  parking_verifications_7d: number;
  driver_points_active_users: number;
  lead_magnet_signups_total: number;
  lead_magnet_signups_7d: number;
  lead_magnet_signups_30d: number;
  parse_usage_7d: number;
  expense_automation_7d: number;
  ai_insights_7d: number;
  // Recruiter marketplace
  recruiters_total: number;
  recruiters_pending: number;
  recruiters_approved: number;
  recruiters_rejected: number;
  recruiters_suspended: number;
  recruiters_active: number;
  recruiters_created_7d: number;
  recruiters_created_30d: number;
  recruiter_billing_total: number;
  recruiter_billing_active: number;
  recruiter_billing_trialing: number;
  recruiter_billing_past_due: number;
  recruiter_billing_canceled: number;
  recruiter_billing_inactive: number;
  recruiter_plan_starter: number;
  recruiter_plan_growth: number;
  recruiter_plan_fleet: number;
  opportunities_total: number;
  opportunities_active: number;
  opportunities_pending: number;
  opportunities_approved: number;
  opportunities_rejected: number;
  opportunities_flagged: number;
  opportunities_removed: number;
  opportunities_created_7d: number;
  opportunities_created_30d: number;
  applications_total: number;
  applications_7d: number;
  applications_30d: number;
  contact_requests_total: number;
  contact_requests_7d: number;
  contact_requests_30d: number;
  // Phase 7: Recruiter funnel
  recruiter_funnel_signups?: number;
  recruiter_funnel_approved?: number;
  recruiter_funnel_active?: number;
  recruiter_funnel_with_opportunity?: number;
  recruiter_funnel_with_active_opportunity?: number;
  recruiter_funnel_with_application?: number;
  recruiter_funnel_with_contact_request?: number;
  recruiter_approval_rate?: number;
  recruiter_activation_rate?: number;
  recruiter_posting_rate?: number;
  recruiter_active_posting_rate?: number;
  recruiter_application_rate?: number;
  recruiter_contact_request_rate?: number;
  recruiter_marketplace_recruiters_7d?: number;
  recruiter_marketplace_recruiters_30d?: number;
  recruiter_marketplace_opportunities_7d?: number;
  recruiter_marketplace_opportunities_30d?: number;
  recruiter_marketplace_applications_7d?: number;
  recruiter_marketplace_applications_30d?: number;
  recruiter_marketplace_contact_requests_7d?: number;
  recruiter_marketplace_contact_requests_30d?: number;
  recruiter_marketplace_health_score?: number;
  recruiter_marketplace_health_label?: string;
  recruiter_marketplace_health_summary?: string;
  recruiter_health_approval_points?: number;
  recruiter_health_posting_points?: number;
  recruiter_health_active_posting_points?: number;
  recruiter_health_application_points?: number;
  recruiter_health_contact_points?: number;
  recruiter_health_low_approval?: boolean;
  recruiter_health_low_posting?: boolean;
  recruiter_health_low_applications?: boolean;
  recruiter_health_low_contact_requests?: boolean;
}


interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  subscription_status: string;
  created_at: string;
  loads_count: number;
  expenses_count: number;
  fuel_logs_count?: number;
  driver_points_total?: number;
  sub_status?: string;
  sub_plan_key?: string;
  lifecycle_opted_out?: boolean;
}

interface ParkingOverviewData {
  total_locations: number;
  reports_7d: number;
  verifications_7d: number;
  top_locations: Array<{ id: string; name: string; address: string | null; type: string; report_count: number }>;
}
interface ParkingReportRow {
  id: string;
  parking_id: string;
  user_id: string;
  status: string;
  safety_rating: number | null;
  notes: string | null;
  created_at: string;
  location_name: string;
  reporter_handle: string;
}
interface DriverOverviewData {
  active_drivers_week: number;
  total_points_awarded: number;
  top_streak: number;
  total_drivers: number;
  tiers: { Bronze: number; Silver: number; Gold: number; Platinum: number };
}
interface LeaderboardRow {
  user_id: string;
  weekly_points: number;
  total_points: number;
  parking_points: number;
  load_points: number;
  streak_days: number;
  tier: string;
  rank: number;
  masked_display_name: string;
}
interface LeadOverviewData {
  total: number;
  last_7d: number;
  last_30d: number;
  converted: number;
  conversion_rate: number;
}
interface LeadSignupRow {
  id: string;
  email: string;
  first_name: string | null;
  source_page: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  created_at: string;
  downloaded_at: string | null;
  converted_user_id: string | null;
}

interface SuppressedRow {
  id: string;
  email: string;
  reason: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface AdminRow {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

interface BillingData {
  subscription_status?: string;
  subscription_plan?: string;
  subscription_expires_at?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
}

interface FeedbackRow {
  id: string;
  user_id: string;
  email: string;
  response: string;
  category: string | null;
  loads_count: number;
  created_at: string;
}

interface EmailLogRow {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface EmailListResponse {
  emails: EmailLogRow[];
  templates: string[];
  summary: { total: number; sent: number; failed: number; suppressed: number; pending: number };
}

interface ActivationCohort {
  cohort: string;
  signups: number;
  activated: number;
  activation_rate: number;
  avg_hours_to_first_load: number | null;
}

interface ActivationResponse {
  overall: { signups: number; activated: number; rate: number };
  cohorts: ActivationCohort[];
  emailImpact: {
    day0: { sent: number; activated_after: number; rate: number } | null;
    day1: { sent: number; activated_after: number; rate: number } | null;
    day2: { sent: number; activated_after: number; rate: number } | null;
    day4: { sent: number; activated_after: number; rate: number } | null;
    day7: { sent: number; activated_after: number; rate: number } | null;
  };
}

function useAdminApi() {
  const invoke = useCallback(async (action: string, params?: Record<string, string>, method = 'GET', body?: unknown) => {
    const queryParams = new URLSearchParams({ action, ...params });
    const options: { method: string; body?: string } = { method };
    if (body) options.body = JSON.stringify(body);
    const { data, error } = await supabase.functions.invoke('admin-api', {
      method: method as 'GET' | 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : body,
    });
    // We need to pass action as query param — use direct fetch instead
    return { data, error };
  }, []);

  const get = useCallback(async (action: string, params?: Record<string, string>) => {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return null;
    const queryParams = new URLSearchParams({ action, ...params });
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api?${queryParams}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    if (!res.ok) return null;
    return res.json();
  }, []);

  const post = useCallback(async (action: string, body: unknown) => {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return null;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api?action=${action}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  }, []);

  return { get, post };
}

export default function Admin() {
  const navigate = useNavigate();
  const { isAdmin, role, isLoading: adminLoading } = useAdmin();
  const { user } = useAuth();
  const api = useAdminApi();
  const isSuperAdmin = role === 'super_admin';

  // Active tab (controlled, driven by sidebar on desktop / TabsList on mobile)
  const [tab, setTab] = useState('overview');

  // Overview
  const [overview, setOverview] = useState<OverviewData | null>(null);

  // Users
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [planOverrideConfirm, setPlanOverrideConfirm] = useState<{ user: UserRow; newStatus: string } | null>(null);

  // Admins
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [addAdminEmail, setAddAdminEmail] = useState('');
  const [removeAdminConfirm, setRemoveAdminConfirm] = useState<AdminRow | null>(null);

  // Billing
  const [billingSearch, setBillingSearch] = useState('');
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [billingUserId, setBillingUserId] = useState('');

  // Feedback
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [feedbackCategory, setFeedbackCategory] = useState('all');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Emails
  const [emails, setEmails] = useState<EmailLogRow[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<string[]>([]);
  const [emailSummary, setEmailSummary] = useState<EmailListResponse['summary'] | null>(null);
  const [emailStatus, setEmailStatus] = useState('all');
  const [emailTemplate, setEmailTemplate] = useState('all');
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailLogRow | null>(null);

  // Test email panel
  const TEST_ACCOUNTS = INTERNAL_TEST_ACCOUNTS;
  type TestTemplate = 'welcome' | 'lifecycle-day1' | 'lifecycle-day2' | 'lifecycle-day4' | 'lifecycle-day7' | 'inactive-feedback';
  const [testTemplate, setTestTemplate] = useState<TestTemplate>('welcome');
  const [testRecipientId, setTestRecipientId] = useState<string>('');
  const [testIncludeTest, setTestIncludeTest] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Activation
  const [activation, setActivation] = useState<ActivationResponse | null>(null);
  const [activationLoading, setActivationLoading] = useState(false);

  // Suppression list
  const [suppressed, setSuppressed] = useState<SuppressedRow[]>([]);
  const [suppressedLoading, setSuppressedLoading] = useState(false);
  const [removeSuppressionConfirm, setRemoveSuppressionConfirm] = useState<SuppressedRow | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Parking
  const [parkingOverview, setParkingOverview] = useState<ParkingOverviewData | null>(null);
  const [parkingReports, setParkingReports] = useState<ParkingReportRow[]>([]);
  const [parkingLoading, setParkingLoading] = useState(false);

  // Drivers / leaderboard
  const [driverOverview, setDriverOverview] = useState<DriverOverviewData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);

  // Lead magnet / starter kit
  const [leadOverview, setLeadOverview] = useState<LeadOverviewData | null>(null);
  const [leadSignups, setLeadSignups] = useState<LeadSignupRow[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);

  const initialFetchDone = useRef(false);

  useEffect(() => {
    if (!adminLoading && !isAdmin) navigate('/', { replace: true });
  }, [adminLoading, isAdmin, navigate]);

  const fetchUsers = useCallback(async (page = 1, search = '') => {
    setUsersLoading(true);
    const params: Record<string, string> = { page: String(page), per_page: '50' };
    if (search) params.email = search;
    const data = await api.get('list-users', params);
    if (data && data.users) {
      setUsers(data.users);
      setUsersPage(data.page);
      setUsersTotalPages(data.total_pages);
      setUsersTotal(data.total);
    }
    setUsersLoading(false);
  }, [api]);

  const fetchFeedback = useCallback(async (category?: string) => {
    setFeedbackLoading(true);
    const params: Record<string, string> = {};
    if (category && category !== 'all') params.category = category;
    const data = await api.get('list-feedback', params);
    setFeedback(Array.isArray(data) ? data : []);
    setFeedbackLoading(false);
  }, [api]);

  const fetchEmails = useCallback(async (status?: string, template?: string) => {
    setEmailsLoading(true);
    const params: Record<string, string> = { limit: '50' };
    if (status && status !== 'all') params.status = status;
    if (template && template !== 'all') params.template = template;
    const data: EmailListResponse | null = await api.get('list-emails', params);
    if (data) {
      setEmails(data.emails || []);
      setEmailTemplates(data.templates || []);
      setEmailSummary(data.summary || null);
    }
    setEmailsLoading(false);
  }, [api]);

  const sendTestEmailSingle = useCallback(async () => {
    if (!testRecipientId) {
      toast.error('Pick a recipient first');
      return;
    }
    setTestSending(true);
    const res = await api.post('send-lifecycle-test', {
      templateName: testTemplate,
      mode: 'single',
      recipientUserId: testRecipientId,
    });
    setTestSending(false);
    if (res?.result?.status === 'sent') {
      toast.success(`Sent ${testTemplate} to ${res.result.email}`);
      fetchEmails(emailStatus, emailTemplate);
    } else {
      toast.error(res?.result?.reason || res?.error || 'Send failed');
    }
  }, [api, testRecipientId, testTemplate, fetchEmails, emailStatus, emailTemplate]);

  const sendTestEmailBulk = useCallback(async () => {
    setBulkConfirmOpen(false);
    setTestSending(true);
    const res = await api.post('send-lifecycle-test', {
      templateName: testTemplate,
      mode: 'all-inactive',
      includeTestAccounts: testIncludeTest,
    });
    setTestSending(false);
    if (res?.sent !== undefined) {
      toast.success(`Sent ${res.sent} of ${res.attempted} (${res.skipped?.length || 0} skipped)`);
      fetchEmails(emailStatus, emailTemplate);
    } else {
      toast.error(res?.error || 'Bulk send failed');
    }
  }, [api, testTemplate, testIncludeTest, fetchEmails, emailStatus, emailTemplate]);

  const fetchActivation = useCallback(async () => {
    setActivationLoading(true);
    const data: ActivationResponse | null = await api.get('activation');
    if (data) setActivation(data);
    setActivationLoading(false);
  }, [api]);

  const fetchSuppressed = useCallback(async () => {
    setSuppressedLoading(true);
    const data: { suppressed: SuppressedRow[] } | null = await api.get('list-suppressed');
    setSuppressed(data?.suppressed || []);
    setSuppressedLoading(false);
  }, [api]);

  const fetchParking = useCallback(async () => {
    setParkingLoading(true);
    const [overviewData, reportsData] = await Promise.all([
      api.get('parking-overview'),
      api.get('list-parking-reports', { limit: '50' }),
    ]);
    if (overviewData) setParkingOverview(overviewData);
    if (reportsData?.reports) setParkingReports(reportsData.reports);
    setParkingLoading(false);
  }, [api]);

  const fetchDrivers = useCallback(async () => {
    setDriversLoading(true);
    const [overviewData, lbData] = await Promise.all([
      api.get('driver-points-overview'),
      api.get('driver-leaderboard', { limit: '25' }),
    ]);
    if (overviewData) setDriverOverview(overviewData);
    if (lbData?.rows) setLeaderboard(lbData.rows);
    setDriversLoading(false);
  }, [api]);

  const fetchLeads = useCallback(async () => {
    setLeadsLoading(true);
    const [overviewData, signupsData] = await Promise.all([
      api.get('lead-magnet-overview'),
      api.get('list-lead-magnet-signups', { limit: '100' }),
    ]);
    if (overviewData) setLeadOverview(overviewData);
    if (signupsData?.signups) setLeadSignups(signupsData.signups);
    setLeadsLoading(false);
  }, [api]);

  const handleRemoveSuppression = useCallback(async () => {
    if (!removeSuppressionConfirm) return;
    const res = await api.post('remove-suppression', { email: removeSuppressionConfirm.email });
    if (res?.success) {
      toast.success(`Removed ${removeSuppressionConfirm.email} from suppression list`);
      fetchSuppressed();
    } else {
      toast.error(res?.error || 'Failed to remove');
    }
    setRemoveSuppressionConfirm(null);
  }, [api, removeSuppressionConfirm, fetchSuppressed]);

  const handleRetryEmail = useCallback(async (row: EmailLogRow) => {
    setRetryingId(row.id);
    const res = await api.post('retry-email', { log_id: row.id });
    setRetryingId(null);
    if (res?.success) {
      toast.success(`Re-queued ${row.template_name} → ${row.recipient_email}`);
      fetchEmails(emailStatus, emailTemplate);
    } else {
      toast.error(res?.error || 'Retry failed');
    }
  }, [api, fetchEmails, emailStatus, emailTemplate]);

  useEffect(() => {
    if (isAdmin && !initialFetchDone.current) {
      initialFetchDone.current = true;
      api.get('overview').then(setOverview);
      api.get('list-admins').then(setAdmins);
      fetchFeedback();
      fetchUsers(1, '');
      fetchEmails();
      fetchActivation();
      fetchSuppressed();
      fetchParking();
      fetchDrivers();
      fetchLeads();
    }
  }, [isAdmin, api, fetchFeedback, fetchUsers, fetchEmails, fetchActivation, fetchSuppressed, fetchParking, fetchDrivers, fetchLeads]);

  const searchUsers = async () => {
    setUsersPage(1);
    fetchUsers(1, userSearch);
  };

  const handlePlanOverride = async () => {
    if (!planOverrideConfirm) return;
    const res = await api.post('set-plan-override', {
      target_user_id: planOverrideConfirm.user.user_id,
      status: planOverrideConfirm.newStatus,
    });
    if (res.success) {
      toast.success(`Plan updated to ${planOverrideConfirm.newStatus}`);
      fetchUsers(usersPage, userSearch);
      setSelectedUser(null);
    } else {
      toast.error(res.error || 'Failed');
    }
    setPlanOverrideConfirm(null);
  };

  const handleAddAdmin = async () => {
    const res = await api.post('add-admin', { email: addAdminEmail });
    if (res.success) {
      toast.success('Admin added');
      setAddAdminOpen(false);
      setAddAdminEmail('');
      api.get('list-admins').then(setAdmins);
    } else {
      toast.error(res.error || 'Failed to add admin');
    }
  };

  const handleRemoveAdmin = async () => {
    if (!removeAdminConfirm) return;
    const res = await api.post('remove-admin', { target_user_id: removeAdminConfirm.user_id });
    if (res.success) {
      toast.success('Admin removed');
      api.get('list-admins').then(setAdmins);
    } else {
      toast.error(res.error || 'Failed');
    }
    setRemoveAdminConfirm(null);
  };

  const searchBilling = async () => {
    const usersData = await api.get('list-users', { email: billingSearch });
    const arr = usersData?.users || [];
    if (arr.length === 0) {
      toast.error('User not found');
      setBillingData(null);
      return;
    }
    const uid = arr[0].user_id;
    setBillingUserId(uid);
    const data = await api.get('billing-status', { user_id: uid });
    setBillingData(data);
  };

  if (adminLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (!isAdmin) return null;

  return (
    <>
      <SEOHead title="Admin | HaulTrackerPro" description="Admin dashboard." path="/admin" noindex />
      <AdminShell
        value={tab}
        onChange={setTab}
        role={role}
        email={user?.email}
        mobileNav={
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full flex flex-wrap h-auto justify-start gap-1 bg-white/[0.04] border border-white/10">
              <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-1" />Overview</TabsTrigger>
              <TabsTrigger value="activation"><TrendingUp className="h-4 w-4 mr-1" />Activation</TabsTrigger>
              <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" />Users</TabsTrigger>
              <TabsTrigger value="parking"><ParkingCircle className="h-4 w-4 mr-1" />Parking</TabsTrigger>
              <TabsTrigger value="drivers"><Trophy className="h-4 w-4 mr-1" />Drivers</TabsTrigger>
              <TabsTrigger value="leads"><Gift className="h-4 w-4 mr-1" />Starter Kit</TabsTrigger>
              <TabsTrigger value="opportunities"><Briefcase className="h-4 w-4 mr-1" />Opportunities</TabsTrigger>
              <TabsTrigger value="applications"><Inbox className="h-4 w-4 mr-1" />Applications</TabsTrigger>
              <TabsTrigger value="recruiters"><Building2 className="h-4 w-4 mr-1" />Recruiters</TabsTrigger>
              <TabsTrigger value="recruiter-leaderboard"><Trophy className="h-4 w-4 mr-1" />Leaderboard</TabsTrigger>
              <TabsTrigger value="referrals"><Share2 className="h-4 w-4 mr-1" />Referral Oversight</TabsTrigger>
              <TabsTrigger value="contracts"><Shield className="h-4 w-4 mr-1" />Contracts</TabsTrigger>
              <TabsTrigger value="admins"><Shield className="h-4 w-4 mr-1" />Admins</TabsTrigger>
              <TabsTrigger value="billing"><CreditCard className="h-4 w-4 mr-1" />Billing</TabsTrigger>
              <TabsTrigger value="feedback"><MessageSquare className="h-4 w-4 mr-1" />Feedback</TabsTrigger>
              <TabsTrigger value="emails"><Mail className="h-4 w-4 mr-1" />Emails</TabsTrigger>
              <TabsTrigger value="audit-logs"><ScrollText className="h-4 w-4 mr-1" />Audit Logs</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="sr-only">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activation">Activation</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="parking">Parking</TabsTrigger>
            <TabsTrigger value="drivers">Drivers</TabsTrigger>
            <TabsTrigger value="leads">Starter Kit</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
            <TabsTrigger value="applications">Applications</TabsTrigger>
            <TabsTrigger value="recruiters">Recruiters</TabsTrigger>
            <TabsTrigger value="recruiter-leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="referrals">Referral Oversight</TabsTrigger>
            <TabsTrigger value="contracts">Contracts</TabsTrigger>
            <TabsTrigger value="admins">Admins</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
            <TabsTrigger value="emails">Emails</TabsTrigger>
            <TabsTrigger value="audit-logs">Audit Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="opportunities" className="space-y-3">
            <AdminOpportunitiesPanel />
          </TabsContent>
          <TabsContent value="applications" className="space-y-3">
            <AdminApplicationsPanel />
          </TabsContent>
          <TabsContent value="recruiters" className="space-y-3">
            <AdminRecruitersPanel />
          </TabsContent>
          <TabsContent value="recruiter-leaderboard" className="space-y-3">
            <AdminRecruiterLeaderboardPanel />
          </TabsContent>
          <TabsContent value="referrals" className="space-y-3">
            <AdminReferralOversightPanel />
          </TabsContent>
          <TabsContent value="contracts" className="space-y-3">
            <AdminContractsPanel />
          </TabsContent>
          <TabsContent value="audit-logs" className="space-y-3">
            <AdminAuditLogPanel />
          </TabsContent>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <OwnerQaModePanel />
            <AdminOverviewPremium overview={overview} onGoToTab={setTab} />
          </TabsContent>



          {/* ACTIVATION */}
          <TabsContent value="activation" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Cohorts exclude internal test accounts. "Activated" = user logged at least one load.
              </p>
              <Button variant="outline" size="sm" className="gap-1" onClick={fetchActivation} disabled={activationLoading}>
                <RefreshCw className={`h-4 w-4 ${activationLoading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>

            {activationLoading && !activation ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : activation ? (
              <>
                {/* Headline */}
                <Card className="shadow-card">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-1">
                      Overall Activation
                    </p>
                    <p className="text-3xl font-bold">{activation.overall.rate}%</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {activation.overall.activated} of {activation.overall.signups} signups logged a first load
                    </p>
                  </CardContent>
                </Card>

                {/* Email impact */}
                <Card className="shadow-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Lifecycle Email Impact</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {[
                      { key: 'day0' as const, label: 'Day 0 — Welcome' },
                      { key: 'day1' as const, label: 'Day 1 — First load push' },
                      { key: 'day2' as const, label: 'Day 2 — First load rescue' },
                      { key: 'day4' as const, label: 'Day 4 — Final first-load rescue' },
                      { key: 'day7' as const, label: 'Day 7 — Legacy habit nudge' },
                    ].map(({ key, label }) => {
                      const m = activation.emailImpact[key];
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-xs text-muted-foreground">
                              {m ? `${m.activated_after} of ${m.sent} recipients activated` : 'No sends yet'}
                            </p>
                          </div>
                          <Badge variant={m && m.rate >= 25 ? 'default' : 'secondary'} className="text-xs whitespace-nowrap">
                            {m ? `${m.rate}%` : '—'}
                          </Badge>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground/70 pt-1">
                      Rate = % of email recipients who logged their first load any time after the email was sent.
                    </p>
                  </CardContent>
                </Card>

                {/* Cohort table */}
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cohort (ISO week)</TableHead>
                        <TableHead className="text-right">Signups</TableHead>
                        <TableHead className="text-right">Activated</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Avg hrs to 1st load</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activation.cohorts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-4">
                            No cohorts yet.
                          </TableCell>
                        </TableRow>
                      ) : activation.cohorts.map((c) => (
                        <TableRow key={c.cohort}>
                          <TableCell className="text-xs whitespace-nowrap">{c.cohort}</TableCell>
                          <TableCell className="text-right text-xs">{c.signups}</TableCell>
                          <TableCell className="text-right text-xs">{c.activated}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={c.activation_rate >= 25 ? 'default' : 'secondary'} className="text-xs">
                              {c.activation_rate}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {c.avg_hours_to_first_load != null ? `${c.avg_hours_to_first_load}h` : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
            )}
          </TabsContent>

          {/* USERS */}
          <TabsContent value="users" className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search by email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
              />
              <Button onClick={searchUsers}><Search className="h-4 w-4" /></Button>
              {userSearch && (
                <Button variant="ghost" onClick={() => { setUserSearch(''); fetchUsers(1, ''); }}>Clear</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{usersTotal} users total · Page {usersPage} of {usersTotalPages}</p>
            {usersLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : users.length > 0 ? (
              <>
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead className="text-right">Loads</TableHead>
                        <TableHead className="text-right">Exp</TableHead>
                        <TableHead className="text-right">Fuel</TableHead>
                        <TableHead className="text-right">Pts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => {
                        const rawStatus = u.sub_status ?? u.subscription_status;
                        const displayStatus = rawStatus === 'active' ? 'pro' : rawStatus;
                        const isPaid = displayStatus === 'pro';
                        return (
                          <TableRow key={u.user_id} className="cursor-pointer" onClick={() => setSelectedUser(u)}>
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{u.email}</span>
                                {u.lifecycle_opted_out && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">opted out</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={isPaid ? 'default' : 'outline'} className="text-xs">
                                {displayStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs">{u.loads_count}</TableCell>
                            <TableCell className="text-right text-xs">{u.expenses_count}</TableCell>
                            <TableCell className="text-right text-xs">{u.fuel_logs_count ?? 0}</TableCell>
                            <TableCell className="text-right text-xs">{u.driver_points_total ?? 0}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
                {usersTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={usersPage <= 1}
                      onClick={() => fetchUsers(usersPage - 1, userSearch)}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {usersPage} / {usersTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={usersPage >= usersTotalPages}
                      onClick={() => fetchUsers(usersPage + 1, userSearch)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No users found.</p>
            )}

            {/* User detail dialog */}
            <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>User Detail</DialogTitle>
                  <DialogDescription>View and manage user details</DialogDescription>
                </DialogHeader>
                {selectedUser && (() => {
                  const rawStatus = selectedUser.sub_status ?? selectedUser.subscription_status;
                  const displayStatus = rawStatus === 'active' ? 'pro' : rawStatus;
                  const isPro = displayStatus === 'pro';
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <p className="text-muted-foreground">Email</p><p>{selectedUser.email}</p>
                        <p className="text-muted-foreground">Plan</p><p>{displayStatus}</p>
                        <p className="text-muted-foreground">Joined</p><p>{new Date(selectedUser.created_at).toLocaleDateString()}</p>
                        <p className="text-muted-foreground">Loads</p><p>{selectedUser.loads_count}</p>
                        <p className="text-muted-foreground">Expenses</p><p>{selectedUser.expenses_count}</p>
                      </div>
                      {isSuperAdmin && (
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            variant={isPro ? 'destructive' : 'default'}
                            onClick={() => setPlanOverrideConfirm({
                              user: selectedUser,
                              newStatus: isPro ? 'free' : 'pro',
                            })}
                          >
                            Set {isPro ? 'Free' : 'Pro'}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </DialogContent>
            </Dialog>

            {/* Plan override confirm */}
            <AlertDialog open={!!planOverrideConfirm} onOpenChange={() => setPlanOverrideConfirm(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Plan Override</AlertDialogTitle>
                  <AlertDialogDescription>
                    Set {planOverrideConfirm?.user.email} to <strong>{planOverrideConfirm?.newStatus}</strong>?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handlePlanOverride}>Confirm</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          {/* ADMINS */}
          {/* PARKING */}
          <TabsContent value="parking" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Community parking system — read-only view.</p>
              <Button variant="outline" size="sm" className="gap-1" onClick={fetchParking} disabled={parkingLoading}>
                <RefreshCw className={`h-4 w-4 ${parkingLoading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
            {parkingOverview && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Locations', value: parkingOverview.total_locations },
                  { label: 'Reports (7d)', value: parkingOverview.reports_7d },
                  { label: 'Verifications (7d)', value: parkingOverview.verifications_7d },
                  { label: 'Top Reports/Loc', value: parkingOverview.top_locations[0]?.report_count ?? 0 },
                ].map((s) => (
                  <Card key={s.label} className="shadow-card">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <ParkingCircle className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                      </div>
                      <p className="text-2xl font-bold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {parkingOverview && parkingOverview.top_locations.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 Most-Reported Locations</CardTitle></CardHeader>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Reports</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {parkingOverview.top_locations.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{l.name}<div className="text-[10px] text-muted-foreground">{l.address ?? ''}</div></TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{l.type}</Badge></TableCell>
                        <TableCell className="text-right text-xs font-semibold">{l.report_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Reports ({parkingReports.length})</CardTitle></CardHeader>
              {parkingReports.length === 0 ? (
                <CardContent><p className="text-xs text-muted-foreground py-2">No reports yet.</p></CardContent>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Time</TableHead><TableHead>Location</TableHead><TableHead>Reporter</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {parkingReports.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{r.location_name}</TableCell>
                        <TableCell className="text-xs">{r.reporter_handle}</TableCell>
                        <TableCell><Badge variant={r.status === 'available' ? 'default' : r.status === 'full' ? 'destructive' : 'secondary'} className="text-xs">{r.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          {/* DRIVERS */}
          <TabsContent value="drivers" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Driver points & weekly leaderboard.</p>
              <Button variant="outline" size="sm" className="gap-1" onClick={fetchDrivers} disabled={driversLoading}>
                <RefreshCw className={`h-4 w-4 ${driversLoading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
            {driverOverview && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Active This Week', value: driverOverview.active_drivers_week },
                    { label: 'Total Points Awarded', value: driverOverview.total_points_awarded },
                    { label: 'Top Streak (days)', value: driverOverview.top_streak },
                    { label: 'Total Drivers', value: driverOverview.total_drivers },
                  ].map((s) => (
                    <Card key={s.label} className="shadow-card">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Trophy className="h-4 w-4 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">{s.label}</p>
                        </div>
                        <p className="text-2xl font-bold">{s.value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Tier Distribution</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-4 gap-2">
                    {(['Bronze', 'Silver', 'Gold', 'Platinum'] as const).map((t) => (
                      <div key={t} className="rounded-lg bg-muted/40 px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">{t}</p>
                        <p className="text-lg font-bold">{driverOverview.tiers[t]}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Weekly Leaderboard ({leaderboard.length})</CardTitle></CardHeader>
              {leaderboard.length === 0 ? (
                <CardContent><p className="text-xs text-muted-foreground py-2">No leaderboard activity yet.</p></CardContent>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-12">#</TableHead><TableHead>Handle</TableHead>
                    <TableHead className="text-right">Week</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Streak</TableHead><TableHead>Tier</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {leaderboard.map((r) => (
                      <TableRow key={r.user_id}>
                        <TableCell className="text-xs">{r.rank}</TableCell>
                        <TableCell className="text-xs">{r.masked_display_name}</TableCell>
                        <TableCell className="text-right text-xs font-semibold">{r.weekly_points}</TableCell>
                        <TableCell className="text-right text-xs">{r.total_points}</TableCell>
                        <TableCell className="text-right text-xs">{r.streak_days}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{r.tier}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          {/* STARTER KIT / LEAD MAGNET */}
          <TabsContent value="leads" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Free Trucker Starter Kit signups.</p>
              <Button variant="outline" size="sm" className="gap-1" onClick={fetchLeads} disabled={leadsLoading}>
                <RefreshCw className={`h-4 w-4 ${leadsLoading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
            {leadOverview && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Signups', value: leadOverview.total },
                  { label: 'Last 7d', value: leadOverview.last_7d },
                  { label: 'Last 30d', value: leadOverview.last_30d },
                  { label: 'Converted to Account', value: `${leadOverview.converted} (${leadOverview.conversion_rate}%)` },
                ].map((s) => (
                  <Card key={s.label} className="shadow-card">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Gift className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                      </div>
                      <p className="text-2xl font-bold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Signups ({leadSignups.length})</CardTitle></CardHeader>
              {leadSignups.length === 0 ? (
                <CardContent><p className="text-xs text-muted-foreground py-2">No signups yet.</p></CardContent>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Email</TableHead>
                    <TableHead>Source</TableHead><TableHead>Account?</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {leadSignups.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs break-all">{l.email}{l.first_name ? ` (${l.first_name})` : ''}</TableCell>
                        <TableCell className="text-xs">
                          {l.utm_source || l.source_page || '—'}
                          {l.utm_campaign && <div className="text-[10px] text-muted-foreground">{l.utm_campaign}</div>}
                        </TableCell>
                        <TableCell>
                          {l.converted_user_id
                            ? <Badge variant="default" className="text-xs">✓</Badge>
                            : <Badge variant="outline" className="text-xs">—</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="admins" className="space-y-3">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Added</TableHead>
                    {isSuperAdmin && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.email}</TableCell>
                      <TableCell><Badge variant={a.role === 'super_admin' ? 'default' : 'secondary'}>{a.role}</Badge></TableCell>
                      <TableCell className="text-xs">{new Date(a.created_at).toLocaleDateString()}</TableCell>
                      {isSuperAdmin && (
                        <TableCell>
                          {a.user_id !== user?.id && (
                            <Button size="sm" variant="ghost" onClick={() => setRemoveAdminConfirm(a)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            {isSuperAdmin && (
              <Button onClick={() => setAddAdminOpen(true)} className="gap-2">
                <UserPlus className="h-4 w-4" /> Add Admin
              </Button>
            )}

            {/* Add admin dialog */}
            <Dialog open={addAdminOpen} onOpenChange={setAddAdminOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Admin</DialogTitle>
                  <DialogDescription>Enter the email of an existing user to grant admin access.</DialogDescription>
                </DialogHeader>
                <Input placeholder="user@example.com" value={addAdminEmail} onChange={(e) => setAddAdminEmail(e.target.value)} />
                <DialogFooter>
                  <Button onClick={handleAddAdmin}>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Remove confirm */}
            <AlertDialog open={!!removeAdminConfirm} onOpenChange={() => setRemoveAdminConfirm(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove Admin</AlertDialogTitle>
                  <AlertDialogDescription>Remove {removeAdminConfirm?.email} from admins?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRemoveAdmin}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          {/* BILLING */}
          <TabsContent value="billing" className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search user by email..."
                value={billingSearch}
                onChange={(e) => setBillingSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchBilling()}
              />
              <Button onClick={searchBilling}><Search className="h-4 w-4" /></Button>
            </div>
            {billingData && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p className="text-muted-foreground">Status</p><p>{billingData.subscription_status || '—'}</p>
                    <p className="text-muted-foreground">Plan</p><p>{billingData.subscription_plan || '—'}</p>
                    <p className="text-muted-foreground">Expires</p><p>{billingData.subscription_expires_at ? new Date(billingData.subscription_expires_at).toLocaleDateString() : '—'}</p>
                    <p className="text-muted-foreground">Stripe Customer</p><p className="text-xs break-all">{billingData.stripe_customer_id || '—'}</p>
                    <p className="text-muted-foreground">Stripe Sub</p><p className="text-xs break-all">{billingData.stripe_subscription_id || '—'}</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {!billingData && (
              <p className="text-sm text-muted-foreground text-center py-4">Search for a user to view billing info.</p>
            )}
          </TabsContent>

          {/* FEEDBACK */}
          <TabsContent value="feedback" className="space-y-3">
            <div className="flex gap-2 items-center">
              <Select value={feedbackCategory} onValueChange={(val) => { setFeedbackCategory(val); fetchFeedback(val); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="great">Great</SelectItem>
                  <SelectItem value="needs_improvement">Needs Improvement</SelectItem>
                  <SelectItem value="found_bug">Found Bug</SelectItem>
                  <SelectItem value="suggestion">Suggestion</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="question">Question</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto">{feedback.length} results</span>
            </div>
            {feedbackLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : feedback.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No feedback found.</p>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedback.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(f.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate">{f.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{f.category || '—'}</Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px]">{f.response}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* EMAILS */}
          <TabsContent value="emails" className="space-y-3">
            {/* TEST EMAIL PANEL */}
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  Send Test Lifecycle Email
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Select value={testTemplate} onValueChange={(v) => setTestTemplate(v as typeof testTemplate)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="welcome">welcome (Day 0)</SelectItem>
                      <SelectItem value="lifecycle-day1">lifecycle-day1 (first load push)</SelectItem>
                      <SelectItem value="lifecycle-day2">lifecycle-day2 (first load rescue)</SelectItem>
                      <SelectItem value="lifecycle-day4">lifecycle-day4 (final rescue)</SelectItem>
                      <SelectItem value="lifecycle-day7">lifecycle-day7 (legacy)</SelectItem>
                      <SelectItem value="inactive-feedback">inactive-feedback (manual only)</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={testRecipientId || 'none'} onValueChange={(v) => setTestRecipientId(v === 'none' ? '' : v)}>
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Pick recipient" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— pick recipient —</SelectItem>
                      {users
                        .filter((u) => testIncludeTest || !TEST_ACCOUNTS.includes(u.email.toLowerCase()))
                        .map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>
                            {u.email} · {u.loads_count} loads
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  <Button size="sm" onClick={sendTestEmailSingle} disabled={testSending || !testRecipientId}>
                    Send to one
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBulkConfirmOpen(true)}
                    disabled={testSending}
                  >
                    Send to all inactive users
                  </Button>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={testIncludeTest}
                    onChange={(e) => setTestIncludeTest(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Include test accounts
                </label>

                <p className="text-xs text-muted-foreground">
                  Single send: ignores all eligibility — fires immediately. Bulk: same gates as the daily cron (verified, opted-in, 0 loads) minus the day window. Idempotency key includes today's date so you can re-run tomorrow.
                </p>
              </CardContent>
            </Card>

            <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Send "{testTemplate}" to all eligible inactive users?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Sends to every verified user with 0 loads who hasn't opted out{testIncludeTest ? '' : ', excluding the 3 test accounts'}. Recipients see this as a real email.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={sendTestEmailBulk}>Send bulk</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {emailSummary && (
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Total', value: emailSummary.total, tone: 'secondary' as const },
                  { label: 'Sent', value: emailSummary.sent, tone: 'default' as const },
                  { label: 'Failed', value: emailSummary.failed, tone: 'destructive' as const },
                  { label: 'Suppressed', value: emailSummary.suppressed, tone: 'outline' as const },
                ].map((s) => (
                  <Card key={s.label} className="shadow-card">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-xl font-bold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-center flex-wrap">
              <Select
                value={emailStatus}
                onValueChange={(val) => { setEmailStatus(val); fetchEmails(val, emailTemplate); }}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="pending">Pending (queued)</SelectItem>
                  <SelectItem value="dlq">Failed (DLQ)</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="bounced">Bounced</SelectItem>
                  <SelectItem value="complained">Complained</SelectItem>
                  <SelectItem value="suppressed">Suppressed</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={emailTemplate}
                onValueChange={(val) => { setEmailTemplate(val); fetchEmails(emailStatus, val); }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All templates</SelectItem>
                  {emailTemplates.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchEmails(emailStatus, emailTemplate)}
                disabled={emailsLoading}
                className="gap-1"
              >
                <RefreshCw className={`h-4 w-4 ${emailsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>

              <span className="text-xs text-muted-foreground ml-auto">
                Showing latest {emails.length} unique emails
              </span>
            </div>

            {emailsLoading ? (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            ) : emails.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No email logs found.</p>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emails.map((e) => {
                      const variant: 'default' | 'destructive' | 'secondary' | 'outline' =
                        e.status === 'sent' ? 'default'
                        : e.status === 'dlq' || e.status === 'failed' || e.status === 'bounced' || e.status === 'complained' ? 'destructive'
                        : e.status === 'suppressed' ? 'outline'
                        : 'secondary';
                      const canRetry = e.status === 'pending' || e.status === 'failed' || e.status === 'dlq';
                      return (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedEmail(e)}
                        >
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(e.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">{e.template_name}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate">{e.recipient_email}</TableCell>
                          <TableCell>
                            <Badge variant={variant} className="text-xs">{e.status}</Badge>
                          </TableCell>
                          <TableCell onClick={(ev) => ev.stopPropagation()}>
                            {canRetry && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 gap-1"
                                disabled={retryingId === e.id}
                                onClick={() => handleRetryEmail(e)}
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${retryingId === e.id ? 'animate-spin' : ''}`} />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}

            <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Email Detail</DialogTitle>
                  <DialogDescription>Send log entry for this email.</DialogDescription>
                </DialogHeader>
                {selectedEmail && (
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-3 gap-2">
                      <p className="text-muted-foreground">Status</p>
                      <p className="col-span-2">{selectedEmail.status}</p>
                      <p className="text-muted-foreground">Template</p>
                      <p className="col-span-2 break-all">{selectedEmail.template_name}</p>
                      <p className="text-muted-foreground">Recipient</p>
                      <p className="col-span-2 break-all">{selectedEmail.recipient_email}</p>
                      <p className="text-muted-foreground">Time</p>
                      <p className="col-span-2">{new Date(selectedEmail.created_at).toLocaleString()}</p>
                      <p className="text-muted-foreground">Message ID</p>
                      <p className="col-span-2 break-all text-xs">{selectedEmail.message_id || '—'}</p>
                    </div>
                    {selectedEmail.error_message && (
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Error</p>
                        <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap break-words">
                          {selectedEmail.error_message}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Suppression list */}
            <Card className="border-destructive/30">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4 text-destructive" />
                  Suppression list ({suppressed.length})
                </CardTitle>
                <Button variant="outline" size="sm" className="gap-1" onClick={fetchSuppressed} disabled={suppressedLoading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${suppressedLoading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {suppressed.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No suppressed emails. Bounces, complaints, and unsubscribes will appear here.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Added</TableHead>
                        {isSuperAdmin && <TableHead className="w-[60px]"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suppressed.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs break-all">{s.email}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{s.reason}</Badge></TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                          {isSuperAdmin && (
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => setRemoveSuppressionConfirm(s)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <AlertDialog open={!!removeSuppressionConfirm} onOpenChange={() => setRemoveSuppressionConfirm(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove from suppression list?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {removeSuppressionConfirm?.email} will receive emails again. If they previously bounced or complained, future sends may also bounce.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRemoveSuppression}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        </Tabs>
      </AdminShell>
    </>
  );
}
