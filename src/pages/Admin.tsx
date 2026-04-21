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
import { ArrowLeft, Users, Shield, CreditCard, BarChart3, Search, UserPlus, Trash2, Crown, MessageSquare, Mail, RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface OverviewData {
  total_users: number;
  pro_users: number;
  total_loads: number;
  loads_7d: number;
  total_expenses: number;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  subscription_status: string;
  created_at: string;
  loads_count: number;
  expenses_count: number;
  lifecycle_opted_out?: boolean;
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
    day2: { sent: number; activated_after: number; rate: number } | null;
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
  const TEST_ACCOUNTS = ['berthonyxyz@gmail.com', 'peejayslifestyle@gmail.com', 'wysdomaniac@gmail.com'];
  const [testTemplate, setTestTemplate] = useState<'welcome' | 'lifecycle-day2' | 'lifecycle-day7'>('welcome');
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
    }
  }, [isAdmin, api, fetchFeedback, fetchUsers, fetchEmails, fetchActivation, fetchSuppressed]);

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
    <div className="min-h-screen bg-background">
      <SEOHead title="Admin | HaulTrackerPro" description="Admin dashboard." path="/admin" noindex />
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Admin Dashboard</h1>
          <Badge variant="secondary" className="ml-auto">{role}</Badge>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="w-full grid grid-cols-7">
            <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-1" />Overview</TabsTrigger>
            <TabsTrigger value="activation"><TrendingUp className="h-4 w-4 mr-1" />Activation</TabsTrigger>
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" />Users</TabsTrigger>
            <TabsTrigger value="admins"><Shield className="h-4 w-4 mr-1" />Admins</TabsTrigger>
            <TabsTrigger value="billing"><CreditCard className="h-4 w-4 mr-1" />Billing</TabsTrigger>
            <TabsTrigger value="feedback"><MessageSquare className="h-4 w-4 mr-1" />Feedback</TabsTrigger>
            <TabsTrigger value="emails"><Mail className="h-4 w-4 mr-1" />Emails</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-3">
            {overview ? (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Users', value: overview.total_users, icon: Users },
                  { label: 'Pro Users', value: overview.pro_users, icon: Crown },
                  { label: 'Total Loads', value: overview.total_loads, icon: BarChart3 },
                  { label: 'Loads (7d)', value: overview.loads_7d, icon: BarChart3 },
                  { label: 'Total Expenses', value: overview.total_expenses, icon: CreditCard },
                ].map((s) => (
                  <Card key={s.label} className="shadow-card">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <s.icon className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                      </div>
                      <p className="text-2xl font-bold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">Loading...</p>
            )}
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
                      { key: 'day2' as const, label: 'Day 2 — "Need a hand?"' },
                      { key: 'day7' as const, label: 'Day 7 — Trial midpoint' },
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
                        <TableHead>Loads</TableHead>
                        <TableHead>Expenses</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.user_id} className="cursor-pointer" onClick={() => setSelectedUser(u)}>
                          <TableCell className="text-xs">{u.email}</TableCell>
                          <TableCell>
                            <Badge variant={u.subscription_status === 'pro' ? 'default' : 'secondary'}>
                              {u.subscription_status}
                            </Badge>
                          </TableCell>
                          <TableCell>{u.loads_count}</TableCell>
                          <TableCell>{u.expenses_count}</TableCell>
                        </TableRow>
                      ))}
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
                {selectedUser && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <p className="text-muted-foreground">Email</p><p>{selectedUser.email}</p>
                      <p className="text-muted-foreground">Plan</p><p>{selectedUser.subscription_status}</p>
                      <p className="text-muted-foreground">Joined</p><p>{new Date(selectedUser.created_at).toLocaleDateString()}</p>
                      <p className="text-muted-foreground">Loads</p><p>{selectedUser.loads_count}</p>
                      <p className="text-muted-foreground">Expenses</p><p>{selectedUser.expenses_count}</p>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant={selectedUser.subscription_status === 'pro' ? 'destructive' : 'default'}
                          onClick={() => setPlanOverrideConfirm({
                            user: selectedUser,
                            newStatus: selectedUser.subscription_status === 'pro' ? 'free' : 'pro',
                          })}
                        >
                          Set {selectedUser.subscription_status === 'pro' ? 'Free' : 'Pro'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
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
                      <SelectItem value="lifecycle-day2">lifecycle-day2</SelectItem>
                      <SelectItem value="lifecycle-day7">lifecycle-day7</SelectItem>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emails.map((e) => {
                      const variant: 'default' | 'destructive' | 'secondary' | 'outline' =
                        e.status === 'sent' ? 'default'
                        : e.status === 'dlq' || e.status === 'failed' || e.status === 'bounced' || e.status === 'complained' ? 'destructive'
                        : e.status === 'suppressed' ? 'outline'
                        : 'secondary';
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
