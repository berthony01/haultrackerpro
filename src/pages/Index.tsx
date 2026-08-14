import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLoads, Load, LoadInsert, LoadUpdate } from '@/hooks/useLoads';
import SEOHead from '@/components/SEOHead';
import { useExpenses, ExpenseInsert, Expense } from '@/hooks/useExpenses';
import { useLoadStops, LoadStopInput } from '@/hooks/useLoadStops';
import { useFuelLogs, FuelLogInsert, FuelLog } from '@/hooks/useFuelLogs';
import { useAuth } from '@/hooks/useAuth';

import { useFeedback } from '@/hooks/useFeedback';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useSmartAlerts } from '@/hooks/useSmartAlerts';
import { useDriverScorecard } from '@/hooks/useDriverScorecard';
import { useSubscription } from '@/hooks/useSubscription';
import { useViewMode } from '@/hooks/useViewMode';
import {
  resolveDashboardNavigation,
  isDashboardNavigationSettled,
  isRecruiterPageId,
  parseRecruiterSubviewFromPage,
  DRIVER_ONLY_PAGES,
} from '@/lib/dashboardWorkspacePolicy';
import type { RecruiterSubview } from '@/lib/workspaceAccess';
import { ViewModeSwitch } from '@/components/ViewModeSwitch';
// Critical shell — keep eager so first paint never flickers.
import { BottomNav } from '@/components/BottomNav';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { DashboardView } from '@/components/DashboardView';
import { AddActionModal } from '@/components/AddActionModal';
import { Onboarding } from '@/components/Onboarding';
import { SmartReminders } from '@/components/SmartReminders';
import { MilestoneNudges } from '@/components/MilestoneNudges';
import { WhatsNewCard } from '@/components/WhatsNewCard';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { useReleaseNotesSeen } from '@/hooks/useReleaseNotesSeen';

// Heavy / route-rare views and modals — lazy so they don't bloat the dashboard chunk.
const LoadForm = lazy(() => import('@/components/LoadForm').then(m => ({ default: m.LoadForm })));
const ExpenseForm = lazy(() => import('@/components/ExpenseForm').then(m => ({ default: m.ExpenseForm })));
const FuelLogForm = lazy(() => import('@/components/FuelLogForm').then(m => ({ default: m.FuelLogForm })));
const FuelLogsListView = lazy(() => import('@/components/FuelLogsListView').then(m => ({ default: m.FuelLogsListView })));
const ExpensesListView = lazy(() => import('@/components/ExpensesListView').then(m => ({ default: m.ExpensesListView })));
const LoadsListView = lazy(() => import('@/components/LoadsListView').then(m => ({ default: m.LoadsListView })));
const ReportsView = lazy(() => import('@/components/ReportsView').then(m => ({ default: m.ReportsView })));
const SettingsView = lazy(() => import('@/components/SettingsView').then(m => ({ default: m.SettingsView })));
const WeeklyCloseout = lazy(() => import('@/components/WeeklyCloseout').then(m => ({ default: m.WeeklyCloseout })));
const MonthlySummary = lazy(() => import('@/components/MonthlySummary').then(m => ({ default: m.MonthlySummary })));
const FeedbackModal = lazy(() => import('@/components/FeedbackModal').then(m => ({ default: m.FeedbackModal })));
const OnboardingModal = lazy(() => import('@/components/OnboardingModal').then(m => ({ default: m.OnboardingModal })));
const AlertsView = lazy(() => import('@/components/AlertsView').then(m => ({ default: m.AlertsView })));
const OpportunitiesPage = lazy(() => import('@/components/opportunities/OpportunitiesPage').then(m => ({ default: m.OpportunitiesPage })));
const RecruiterAccessRoute = lazy(() => import('@/components/opportunities/recruiter/RecruiterAccessRoute').then(m => ({ default: m.RecruiterAccessRoute })));
const RecruiterSettingsView = lazy(() => import('@/components/opportunities/recruiter/RecruiterSettingsView').then(m => ({ default: m.RecruiterSettingsView })));
const RecurringExpensesView = lazy(() => import('@/components/RecurringExpensesView').then(m => ({ default: m.RecurringExpensesView })));
const DriverScorecard = lazy(() => import('@/components/DriverScorecard').then(m => ({ default: m.DriverScorecard })));
const WhatsNewModal = lazy(() => import('@/components/WhatsNewModal').then(m => ({ default: m.WhatsNewModal })));
const DriverContractsView = lazy(() => import('@/components/contracts/DriverContractsView').then(m => ({ default: m.DriverContractsView })));
const RecruiterContractsView = lazy(() => import('@/components/contracts/RecruiterContractsView').then(m => ({ default: m.RecruiterContractsView })));
const DriverSettlementsView = lazy(() => import('@/components/settlements/DriverSettlementsView').then(m => ({ default: m.DriverSettlementsView })));
import { ContractActionsCard } from '@/components/contracts/ContractActionsCard';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import AssistantBlockedNotice from '@/components/assistants/AssistantBlockedNotice';

import { Truck, LogOut, X, Route, Users, TrendingUp, Shield } from 'lucide-react';
import { useAdmin } from '@/hooks/useAdmin';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { normalizeLegacyEditStops } from '@/lib/stopNormalization';
import { supabase } from '@/integrations/supabase/client';
import { useActingContext } from '@/hooks/useActingContext';
import { useDriverReportSettings } from '@/hooks/useDriverReportSettings';

import {
  isAssistantPageAllowed,
  firstAllowedAssistantPage,
  hasPerm,
} from '@/lib/assistantPermissions';

import { trackPurchase, trackLoadLogged, trackExpenseLogged } from '@/lib/analytics';

// Tiny inline fallback — avoids whole-app skeleton flicker for view swaps.
const ViewFallback = () => (
  <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
);

const Index = () => {
  const { signOut, user } = useAuth();
  const queryClient = useQueryClient();
  
  const {
    effectiveRole,
    setViewMode,
    canSwitch,
    isLoading: workspaceLoading,
    error: workspaceError,
    driverWorkspaceAllowed,
    recruiterHubAllowed,
    recruiterOperationsAllowed,
    driverCapabilityStatus,
    recruiterCapabilityStatus,
  } = useViewMode();
  const { isAdmin } = useAdmin();
  const isRecruiterView = effectiveRole === 'recruiter';
  const { responses: feedbackResponses } = useFeedback();
  const { settings } = useUserSettings();
  const {
    isActingAsAssistant,
    actingDriver,
    permissions: actingPermissions,
    exitActingAs,
  } = useActingContext();
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  // Initial page hint. NEVER an authorization signal — the workspace
  // effect below re-resolves through the pure dashboard policy after
  // capabilities load. URL / session intent may only ask for a page;
  // policy decides whether it mounts.
  const [page, setPage] = useState<string>(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const pageParam = sp.get('page');
      if (pageParam === 'recruiter-access' || pageParam?.startsWith('recruiter-access:')) {
        return 'recruiter-access';
      }
    } catch {}
    return 'dashboard';
  });
  const [loadsPayFilter, setLoadsPayFilter] = useState<string | undefined>();
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingFuelLog, setEditingFuelLog] = useState<FuelLog | null>(null);
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [suppressOnboardingForAddDeepLink, setSuppressOnboardingForAddDeepLink] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [roleCardDismissed, setRoleCardDismissed] = useState(() => {
    try { return localStorage.getItem('htp_role_card_dismissed') === '1'; } catch { return false; }
  });
  const { ready: releaseReady, hasSeenLatest, markSeen } = useReleaseNotesSeen();

  // URL-based guard: catches /dashboard?page=add before state effects settle.
  const isAddLoadDeepLinkUrl =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('page') === 'add';

  // Auto-open the What's New modal once per user (after onboarding modal isn't blocking)
  useEffect(() => {
    if (
      releaseReady &&
      !hasSeenLatest &&
      !showOnboardingModal &&
      !isAddLoadDeepLinkUrl &&
      !suppressOnboardingForAddDeepLink &&
      page !== 'add'
    ) {
      setShowWhatsNew(true);
    }
  }, [releaseReady, hasSeenLatest, showOnboardingModal, isAddLoadDeepLinkUrl, suppressOnboardingForAddDeepLink, page]);

  // Defensive close: if What's New opened before the add-load deep link settled,
  // close it without marking as seen so it can appear in a normal session later.
  useEffect(() => {
    if (showWhatsNew && (suppressOnboardingForAddDeepLink || page === 'add')) {
      setShowWhatsNew(false);
    }
  }, [showWhatsNew, suppressOnboardingForAddDeepLink, page]);

  const handleCloseWhatsNew = () => {
    markSeen();
    setShowWhatsNew(false);
  };

  const allLoadsQuery = useLoads();
  const { addLoad, updateLoad, deleteLoad } = allLoadsQuery;

  // Client-side effective-date filter for the Loads list view.
  // Effective date = dropoff_date ?? load_date (matches useLoads contract).
  // from/to are inclusive ISO yyyy-mm-dd strings; invalid/missing dates are skipped.
  const filteredLoadsForList = useMemo(() => {
    const { from, to } = dateRange;
    if (!from && !to) return allLoadsQuery.loads;
    return allLoadsQuery.loads.filter((l) => {
      const eff = l.dropoff_date ?? l.load_date;
      if (!eff) return false;
      if (from && eff < from) return false;
      if (to && eff > to) return false;
      return true;
    });
  }, [allLoadsQuery.loads, dateRange]);
  const allExpensesQuery = useExpenses();
  const allFuelLogsQuery = useFuelLogs();
  const loadStopsHook = useLoadStops();

  // Phase DA-1 — while acting, reports AND dashboard context must use the
  // MANAGED driver's safe settings (narrow RPC), never the assistant's own
  // user_settings. Single hook instance, declared before any consumer.
  const { data: driverReportSettings } = useDriverReportSettings(
    isActingAsAssistant ? actingDriver?.driver_user_id ?? null : null,
  );
  // Effective week start: self mode uses own settings, acting mode uses the
  // managed driver's safe report settings.
  const effectiveWeekStartDay = isActingAsAssistant
    ? driverReportSettings?.week_start_day ?? undefined
    : settings?.week_start_day;

  // Smart Alerts & Scorecard
  const smartAlerts = useSmartAlerts(allLoadsQuery.loads, allExpensesQuery.expenses, effectiveWeekStartDay);
  const scorecard = useDriverScorecard(allLoadsQuery.loads, allExpensesQuery.expenses, effectiveWeekStartDay);

  // Pro gating — canonical subscription hook (Free vs Pro plans only)
  const subscription = useSubscription();
  // Phase DA-1 — canonical DRIVER-WORKSPACE Pro entitlement.
  // Self mode: the signed-in driver's own subscription.
  // Acting-as-assistant mode: the MANAGED driver's server-resolved Pro flag.
  // The assistant's personal Driver subscription must never unlock or lock
  // the managed driver's Driver Pro features.
  const isPro = isActingAsAssistant
    ? actingDriver?.driver_is_pro === true
    : subscription.isPro;
  // Report export capability. Self drivers keep today's behavior; acting
  // assistants must additionally hold export_reports for that exact driver.
  const canExportReports = isActingAsAssistant
    ? hasPerm(actingPermissions, 'export_reports')
    : true;



  const { profile: driverOppProfile } = useDriverOpportunityProfile();
  const hasCompletedDriverProfile = !!driverOppProfile?.profile_completed;

  const handleUpgrade = () => {
    setPage('settings');
  };

  // Handle checkout success return — refetch first, then track once subscription resolves
  const [pendingPurchaseTrack, setPendingPurchaseTrack] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      toast.success('Welcome to Pro! Your subscription is now active.', { duration: 5000 });
      setPendingPurchaseTrack(true);
      subscription.refetch();
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('recruiter_checkout') === 'success') {
      toast.success('Recruiter plan activated! You can now post opportunities.', { duration: 5000 });
      queryClient.invalidateQueries({ queryKey: ['recruiter_billing'] });
      queryClient.invalidateQueries({ queryKey: ['recruiter_active_opportunity_count'] });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('recruiter_checkout') === 'cancel') {
      toast.info('Checkout canceled. You can pick a plan whenever you’re ready.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    // Prefill from Landing Profit Intelligence demo
    // Prefill from Landing Profit Intelligence demo — driver-only.
    if (params.get('prefill') === 'load' && !workspaceLoading && !isRecruiterView) {
      try {
        const raw = sessionStorage.getItem('htp_demo_prefill');
        if (raw) {
          const d = JSON.parse(raw) as { rate: number; loadedMiles: number; deadheadMiles: number; fuelCost: number; otherCost: number; ts: number };
          // Only honor recent prefills (5 min window)
          if (d && Date.now() - (d.ts || 0) < 5 * 60 * 1000) {
            const rpm = d.loadedMiles > 0 ? Number((d.rate / d.loadedMiles).toFixed(2)) : 0;
            setEditingLoad({
              id: '',
              user_id: user?.id ?? '',
              load_date: new Date().toISOString().split('T')[0],
              dropoff_date: null,
              pickup_location: '',
              dropoff_location: '',
              loaded_miles: d.loadedMiles,
              deadhead_miles: d.deadheadMiles,
              rate_per_mile: rpm,
              wait_fee: 0,
              detention_fee: 0,
              other_fees: 0,
              actual_pay_received: null,
              gross_revenue: d.rate,
              estimated_pay: d.rate,
              status: 'completed',
              notes: `Prefilled from Profit Intelligence demo — fuel ~$${d.fuelCost}, other ~$${d.otherCost}.`,
              broker_id: null,
              broker_name_raw: null,
              created_at: '',
              updated_at: '',
              invoice_submitted_date: null,
              pod_submitted_date: null,
              payment_due_date: null,
              paid_date: null,
              payment_status: 'unpaid',
              payment_notes: null,
              short_paid_amount: null,
            } as unknown as Load);
            setPage('add');
            toast.success('Demo numbers loaded — review and save your load.', {
              description: 'Loaded miles, deadhead, rate, and gross pay are filled. Fuel and other expenses were added to Notes. Pickup, dropoff, broker, and dates are still manual.',
              duration: 8000,
            });
          }
          sessionStorage.removeItem('htp_demo_prefill');
        }
      } catch {}
      window.history.replaceState({}, '', window.location.pathname);
    }
    // Route to Recruiter Access / Opportunities from external CTA. URL
    // params only HINT; the pure dashboard policy authorizes the mount
    // once capabilities resolve. `htp_auth_intent` / `htp_recruiter_intent`
    // sessionStorage keys are no longer authorization inputs here.
    if (workspaceLoading) return;
    const pageParam = params.get('page');
    const isRecruiterAccessParam =
      pageParam === 'recruiter-access' || (pageParam?.startsWith('recruiter-access:') ?? false);

    if (isRecruiterAccessParam && pageParam) {
      const requestedSub = parseRecruiterSubviewFromPage(pageParam) ?? 'hub';
      if (recruiterHubAllowed && recruiterCapabilityStatus &&
          recruiterCapabilityStatus !== 'revoked') {
        // Authorized: switch view mode + resolve safe subview via policy.
        setViewMode('recruiter');
        const decision = resolveDashboardNavigation({
          requestedPage: 'recruiter-access',
          requestedRecruiterSubview: requestedSub,
          effectiveWorkspace: 'recruiter',
          recruiterCapabilityStatus,
          recruiterHubAllowed,
          recruiterOperationsAllowed,
        });
        if (!decision.unresolved) {
          setRecruiterView(decision.recruiterSubview ?? 'hub');
          setPage(decision.page);
        }
      } else if (driverCapabilityStatus === 'active') {
        // Capability missing but driver active → route to B2A entry.
        navigate('/recruiter', { replace: true });
        return;
      } else if (driverWorkspaceAllowed) {
        setPage('dashboard');
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (pageParam === 'opportunities') {
      const view = params.get('view');
      if (view === 'recruiter') {
        // Recruiter opportunities hint. Route through B2A entry when
        // driver is active but no recruiter capability. Never mount
        // recruiter dashboard directly here.
        if (recruiterHubAllowed && recruiterCapabilityStatus &&
            recruiterCapabilityStatus !== 'revoked') {
          setViewMode('recruiter');
          setRecruiterView('hub');
          setPage('recruiter-access');
        } else if (driverCapabilityStatus === 'active') {
          navigate('/recruiter', { replace: true });
          return;
        } else if (driverWorkspaceAllowed) {
          setPage('dashboard');
        }
      } else if (driverWorkspaceAllowed) {
        setPage('opportunities');
        if (view === 'driver-profile') {
          try { sessionStorage.setItem('htp_opportunities_initial_view', 'driver-profile'); } catch {}
        }
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (pageParam === 'add') {
      if (driverWorkspaceAllowed && effectiveRole === 'driver') {
        setSuppressOnboardingForAddDeepLink(true);
        setEditingLoad(null);
        setPage('add');
      } else if (recruiterHubAllowed && effectiveRole === 'recruiter') {
        setPage('recruiter-access');
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.id,
    subscription.isLoading,
    subscription.isPro,
    subscription.planKey,
    workspaceLoading,
    effectiveRole,
    recruiterHubAllowed,
    recruiterOperationsAllowed,
    recruiterCapabilityStatus,
    driverWorkspaceAllowed,
    driverCapabilityStatus,
  ]);

  // Fire purchase analytics once the resolved plan is available (avoids stale closure)
  useEffect(() => {
    if (pendingPurchaseTrack && !subscription.isLoading && subscription.isPro) {
      trackPurchase(subscription.planKey, subscription.planKey === 'pro_yearly' ? 179.88 : 19.99);
      setPendingPurchaseTrack(false);
    }
  }, [pendingPurchaseTrack, subscription.isLoading, subscription.isPro, subscription.planKey]);

  // Editing stops state
  const [editingStops, setEditingStops] = useState<LoadStopInput[]>([]);

  useEffect(() => {
    if (
      !allLoadsQuery.isLoading &&
      allLoadsQuery.loads.length >= 10 &&
      feedbackResponses.length === 0
    ) {
      const timer = setTimeout(() => setShowFeedback(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [allLoadsQuery.isLoading, allLoadsQuery.loads.length, feedbackResponses.length]);

  // NOTE: We intentionally do NOT silently bounce blocked pages here. Instead
  // the render path shows <AssistantBlockedNotice/> so the assistant gets an
  // explicit "you don't have permission" explanation with two clear escape
  // hatches. handleNavigate() still pre-empts blocked nav clicks as a
  // best-effort early redirect.

  // Activate premium dark theme on body so Radix portals (Sheet/Dialog/Popover/Tooltip)
  // — which mount outside the .app-shell subtree — inherit the same tokens.
  useEffect(() => {
    document.body.classList.add('app-shell-active');
    return () => document.body.classList.remove('app-shell-active');
  }, []);

  // Show onboarding modal for first-time DRIVERS only.
  // Requires an exact driver workspace: never infer driver from
  // !isRecruiterView or a null/unresolved effectiveRole.
  useEffect(() => {
    if (workspaceLoading) return;
    if (workspaceError) return;
    if (effectiveRole !== 'driver') return;
    if (!driverWorkspaceAllowed) return;
    if (settings && !settings.onboarding_completed && !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0) {
      if (suppressOnboardingForAddDeepLink) return;
      setShowOnboardingModal(true);
    }
  }, [settings, allLoadsQuery.isLoading, allLoadsQuery.loads.length, suppressOnboardingForAddDeepLink, workspaceLoading, workspaceError, effectiveRole, driverWorkspaceAllowed]);

  const handleOnboardingComplete = async () => {
    setShowOnboardingModal(false);
    if (user) {
      await supabase.from('user_settings').update({ onboarding_completed: true }).eq('user_id', user.id);
    }
    setEditingLoad(null);
    setPage('add');
  };

  // Driver-only onboarding card. Requires the exact driver workspace so
  // recruiters, unresolved, or capability-error renders never surface
  // "Log Your First Load".
  const showOnboarding =
    !workspaceLoading &&
    effectiveRole === 'driver' &&
    driverWorkspaceAllowed &&
    !allLoadsQuery.isLoading &&
    allLoadsQuery.loads.length === 0 &&
    page === 'dashboard';

  const handleAddLoad = (data: LoadInsert, stops?: LoadStopInput[]) => {
    const prevLoadCount = allLoadsQuery.loads.length;
    addLoad.mutate(data, {
      onSuccess: (result) => {
        trackLoadLogged(prevLoadCount + 1);
        if (stops && stops.length > 0 && result?.id) {
          loadStopsHook.saveStopsForLoad.mutate({ loadId: result.id, stops });
        }
        // Award +5 load points (Pro only) via event-bound RPC. Fire-and-forget.
        if (user && isPro && result?.id) {
          try {
            supabase
              .rpc('award_load_points', { _load_id: result.id })
              .then(({ error }) => {
                if (error) console.warn('award_load_points failed', error);
                queryClient.invalidateQueries({ queryKey: ['driver-points'] });
                queryClient.invalidateQueries({ queryKey: ['driver-leaderboard'] });
              });
          } catch (e) {
            console.warn('award_load_points threw', e);
          }
        }
        if (prevLoadCount === 0) {
          // First-load success — value proof, not a sales pitch.
          if (suppressOnboardingForAddDeepLink) {
            setSuppressOnboardingForAddDeepLink(false);
          }
          toast.success('First load logged — now you can see real numbers.', {
            description:
              'You can now compare gross pay, miles, deadhead, and estimated pay. Add fuel or expenses next for a clearer net profit picture.',
            duration: 10000,
            action: { label: 'Add fuel/expense', onClick: () => { setPage('add_expense'); } },
          });
          setPage('dashboard');
        } else if (allExpensesQuery.expenses.length === 0) {
          toast.success('Load logged!', {
            description: 'Now log your first expense to see real net profit.',
            action: { label: 'Add Expense', onClick: () => { setPage('add_expense'); } },
          });
          setPage('loads');
        } else {
          toast.success('Load logged successfully!');
          setPage('loads');
        }
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleAddExpense = (data: ExpenseInsert) => {
    allExpensesQuery.addExpense.mutate(data, {
      onSuccess: () => { trackExpenseLogged(); toast.success('Expense saved!'); setEditingExpense(null); setPage('expenses'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleUpdateExpense = (data: ExpenseInsert) => {
    if (!editingExpense) return;
    allExpensesQuery.updateExpense.mutate({ id: editingExpense.id, data }, {
      onSuccess: () => { toast.success('Expense updated!'); setEditingExpense(null); setPage('expenses'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleDeleteExpense = (id: string) => {
    allExpensesQuery.deleteExpense.mutate(id, {
      onSuccess: () => toast.success('Expense deleted'),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setPage('add_expense');
  };

  // Fuel log handlers
  const handleAddFuelLog = (data: FuelLogInsert) => {
    allFuelLogsQuery.addFuelLog.mutate(data, {
      onSuccess: () => { toast.success('Fuel log saved!'); setEditingFuelLog(null); setPage('fuel'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleUpdateFuelLog = (data: FuelLogInsert) => {
    if (!editingFuelLog) return;
    allFuelLogsQuery.updateFuelLog.mutate({ id: editingFuelLog.id, data }, {
      onSuccess: () => { toast.success('Fuel log updated!'); setEditingFuelLog(null); setPage('fuel'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleDeleteFuelLog = (id: string) => {
    allFuelLogsQuery.deleteFuelLog.mutate(id, {
      onSuccess: () => toast.success('Fuel log deleted'),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleEditFuelLog = (log: FuelLog) => {
    setEditingFuelLog(log);
    setPage('add_fuel');
  };

  const handleUpdateLoad = (data: LoadInsert, stops?: LoadStopInput[]) => {
    if (!editingLoad) return;
    updateLoad.mutate({ id: editingLoad.id, data }, {
      onSuccess: () => {
        loadStopsHook.saveStopsForLoad.mutate({ loadId: editingLoad.id, stops: stops ?? [] });
        toast.success('Load updated!');
        setEditingLoad(null);
        setEditingStops([]);
        setPage('loads');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleDelete = (id: string) => {
    deleteLoad.mutate(id, {
      onSuccess: () => toast.success('Load deleted'),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleQuickUpdate = (id: string, data: LoadUpdate) => {
    updateLoad.mutate({ id, data }, {
      onError: (e) => toast.error(e.message),
    });
  };

  const handleDuplicate = (load: Load) => {
    setEditingLoad(null);
    setEditingStops([]);
    setPage('add');
    // Phase 29: reset BOTH pickup and drop-off date to today so the duplicated
    // load lands in the current reporting window. Previously only load_date was
    // reset, leaving the old dropoff_date (the canonical reporting date) intact
    // and causing duplicates to appear in the wrong date range.
    const today = new Date().toISOString().split('T')[0];
    const dup: Load = {
      ...load,
      id: '',
      load_date: today,
      dropoff_date: today,
      actual_pay_received: null,
      status: 'pending',
    };
    setEditingLoad(dup);
    const origStops = loadStopsHook.getStopsForLoad(load.id);
    // Phase 29: clear stop_date so an old final-stop date doesn't carry into the duplicate.
    const seeded = origStops.map(s => ({
      stop_order: s.stop_order,
      location: s.location,
      stop_type: s.stop_type,
      detention_minutes: s.detention_minutes,
      stop_date: null,
    }));
    // Phase 29G: normalize duplicated stops the same way edit mode does so
    // legacy endpoint rows / blank stop_type values don't get re-seeded into
    // the editor. Today's top-level dates remain canonical for the duplicate.
    const normalized = normalizeLegacyEditStops({
      pickup_location: load.pickup_location,
      dropoff_location: load.dropoff_location,
      load_date: today,
      dropoff_date: today,
      stops: seeded,
    });
    setEditingStops(normalized.editorStops);
    if (normalized.hasConflict) {
      toast.warning('A legacy stop row conflicts with this load\'s pickup or drop-off — review it before saving.', { duration: 7000 });
    }
  };

  const handleEdit = (load: Load) => {
    const origStops = loadStopsHook.getStopsForLoad(load.id);
    const seeded = origStops.map(s => ({
      stop_order: s.stop_order,
      location: s.location,
      stop_type: s.stop_type,
      detention_minutes: s.detention_minutes,
      stop_date: (s as any).stop_date ?? null,
    }));
    // Phase 29D: strip legacy Pickup/Drop endpoint rows from the editor when
    // they match the top-level endpoints, and seed any missing top-level
    // dates from a matching legacy row. Conflicting endpoint rows (different
    // city than the top-level field) are preserved for manual review.
    const normalized = normalizeLegacyEditStops({
      pickup_location: load.pickup_location,
      dropoff_location: load.dropoff_location,
      load_date: load.load_date,
      dropoff_date: (load as any).dropoff_date ?? '',
      stops: seeded,
    });
    const editLoad: any = { ...load };
    if (normalized.load_date && normalized.load_date !== load.load_date) {
      editLoad.load_date = normalized.load_date;
    }
    if (normalized.dropoff_date && normalized.dropoff_date !== (load as any).dropoff_date) {
      editLoad.dropoff_date = normalized.dropoff_date;
    }
    setEditingLoad(editLoad);
    setEditingStops(normalized.editorStops);
    if (normalized.hasConflict) {
      toast.warning('A legacy stop row conflicts with this load\'s pickup or drop-off — review it before saving.', { duration: 7000 });
    }
    setPage('add');
  };

  const navigate = useNavigate();

  const [opportunitiesViewKey, setOpportunitiesViewKey] = useState(0);
  const [opportunitiesView, setOpportunitiesView] = useState<'list' | 'recruiter' | 'driver-profile'>('list');
  const [recruiterView, setRecruiterView] = useState<'hub' | 'onboarding' | 'manager' | 'applications' | 'reports'>('hub');

  // Capability-authorized guard: whenever the current page/subview no
  // longer fits the effective workspace + recruiter status, re-resolve
  // through the pure dashboard policy. Replaces the exclusive-role guard
  // that used `useUserRole`.
  useEffect(() => {
    if (workspaceLoading) return;
    if (!effectiveRole) return;
    const decision = resolveDashboardNavigation({
      requestedPage: page,
      requestedRecruiterSubview: recruiterView,
      effectiveWorkspace: effectiveRole,
      recruiterCapabilityStatus,
      recruiterHubAllowed,
      recruiterOperationsAllowed,
    });
    if (decision.unresolved) return;
    if (decision.page !== page) setPage(decision.page);
    if (decision.recruiterSubview && decision.recruiterSubview !== recruiterView) {
      setRecruiterView(decision.recruiterSubview);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceLoading,
    effectiveRole,
    recruiterCapabilityStatus,
    recruiterHubAllowed,
    recruiterOperationsAllowed,
    page,
    recruiterView,
  ]);

  const openOpportunitiesView = (view: 'recruiter' | 'driver-profile' | 'list') => {
    try { sessionStorage.setItem('htp_opportunities_initial_view', view); } catch {}
    setEditingLoad(null);
    setEditingStops([]);
    setEditingExpense(null);
    setEditingFuelLog(null);
    setOpportunitiesView(view);
    setOpportunitiesViewKey((k) => k + 1);
    setPage('opportunities');
  };

  const handleNavigate = (p: string, options?: { filter?: string }) => {
    // Assistant allow-list.
    if (isActingAsAssistant) {
      if (p === 'assistant_exit') {
        exitActingAs();
        navigate('/assistant');
        return;
      }
      if (!isAssistantPageAllowed(p, actingPermissions)) {
        const target = firstAllowedAssistantPage(actingPermissions);
        setPage(target);
        return;
      }
    }

    if (p !== 'add') {
      setSuppressOnboardingForAddDeepLink(false);
    }

    if (p === 'parking') {
      navigate('/parking');
      return;
    }
    if (!effectiveRole || workspaceLoading) return;

    if (p === 'add') {
      if (effectiveRole !== 'driver' || !driverWorkspaceAllowed) {
        if (recruiterHubAllowed) {
          setRecruiterView('hub');
          setPage('recruiter-access');
        }
        return;
      }
      setShowAddModal(true);
      return;
    }

    const requestedSub: RecruiterSubview | null = isRecruiterPageId(p)
      ? parseRecruiterSubviewFromPage(p)
      : null;

    const decision = resolveDashboardNavigation({
      requestedPage: p,
      requestedRecruiterSubview: requestedSub ?? recruiterView,
      effectiveWorkspace: effectiveRole,
      recruiterCapabilityStatus,
      recruiterHubAllowed,
      recruiterOperationsAllowed,
    });
    if (decision.unresolved) return;

    if (decision.page === 'opportunity-preferences') {
      openOpportunitiesView('driver-profile');
      return;
    }

    setEditingLoad(null);
    setEditingStops([]);
    setEditingExpense(null);
    setEditingFuelLog(null);

    if (decision.page === 'recruiter-access') {
      setOpportunitiesView('list');
      setRecruiterView(decision.recruiterSubview ?? 'hub');
      setPage('recruiter-access');
      return;
    }

    setLoadsPayFilter(decision.page === 'loads' ? options?.filter : undefined);
    if (decision.page === 'opportunities') {
      setOpportunitiesView('list');
      setOpportunitiesViewKey((k) => k + 1);
    } else {
      setOpportunitiesView('list');
    }
    setPage(decision.page);
  };

  // Dedicated workspace switch — never runs against stale role closure.
  const handleWorkspaceSwitch = (next: 'driver' | 'recruiter') => {
    if (workspaceLoading) return;
    if (next === 'recruiter') {
      if (!recruiterHubAllowed) return;
      setViewMode('recruiter');
      const sub: RecruiterSubview =
        recruiterOperationsAllowed
          ? 'hub'
          : recruiterCapabilityStatus === 'setup'
            ? 'onboarding'
            : 'hub';
      setRecruiterView(sub);
      setPage('recruiter-access');
      return;
    }
    if (!driverWorkspaceAllowed) return;
    setViewMode('driver');
    setPage('dashboard');
  };

  // ------------------------------------------------------------------
  // SYNCHRONOUS render-gate — every render re-resolves the policy from
  // the current page/subview + validated capability state. If the
  // current state is not yet settled against that decision, no
  // workspace child may mount this render (the effect above will
  // reconcile before the next render).
  // ------------------------------------------------------------------
  const renderDecision = useMemo(() => {
    if (workspaceLoading || !effectiveRole) return null;
    return resolveDashboardNavigation({
      requestedPage: page,
      requestedRecruiterSubview: recruiterView,
      effectiveWorkspace: effectiveRole,
      recruiterCapabilityStatus,
      recruiterHubAllowed,
      recruiterOperationsAllowed,
    });
  }, [
    workspaceLoading,
    effectiveRole,
    recruiterCapabilityStatus,
    recruiterHubAllowed,
    recruiterOperationsAllowed,
    page,
    recruiterView,
  ]);

  const navigationSettled = isDashboardNavigationSettled(page, recruiterView, renderDecision);
  const workspaceUnavailable =
    !workspaceLoading &&
    (!!workspaceError || !effectiveRole || (renderDecision?.unresolved ?? false));
  // Single synchronous shell-block flag. Nav shells, ViewModeSwitch, and
  // portal/workspace modals must all be blocked whenever ANY of these
  // hold: capability is loading, workspace is unavailable, or the current
  // (page, recruiterView) pair does not yet match the resolved decision.
  const workspaceShellBlocked =
    workspaceLoading || workspaceUnavailable || !navigationSettled;

  // Derive sidebar/header key so Recruiter Access has its own label & highlight.
  const navKey =
    page === 'recruiter-access'
      ? (recruiterView === 'manager'
          ? 'recruiter-access:manager'
          : recruiterView === 'applications'
            ? 'recruiter-access:applications'
            : recruiterView === 'reports'
              ? 'recruiter-access:reports'
              : 'recruiter-access')
      : page === 'opportunities' && opportunitiesView === 'driver-profile'
        ? 'opportunity-preferences'
        : page;
  const navLabel =
    navKey === 'recruiter-access'
      ? 'Recruiter Access'
      : navKey === 'recruiter-access:manager'
        ? 'Manage Opportunities'
        : navKey === 'recruiter-access:applications'
          ? 'Applications'
          : navKey === 'recruiter-access:reports'
            ? 'Reports'
            : navKey === 'opportunity-preferences'
              ? 'Opportunity Preferences'
              : navKey === 'dashboard'
                ? 'Dashboard'
                : navKey.charAt(0).toUpperCase() + navKey.slice(1).replace(/[_-]/g, ' ');
  const NAV_SUBTITLES: Record<string, string> = {
    'recruiter-access': 'Manage your recruiter command center',
    'recruiter-access:manager': 'Post and manage your opportunities',
    'recruiter-access:applications': 'Review driver applications',
    'recruiter-access:reports': 'Activity and pipeline reports for your recruiting',
    'opportunity-preferences': 'Tune what recruiters see and how you match',
    dashboard: 'Your hauling overview',
    loads: 'Your loads and pay',
    expenses: 'Track every dollar out',
    fuel: 'Fuel logs and MPG',
    reports: 'Exports and analytics',
    settings: 'Customize your experience',
    opportunities: 'Verified driver opportunities',
    contracts: 'Review and sign contracts',
    settlements: 'Reconcile carrier settlement statements',
  };
  const navSubtitle = NAV_SUBTITLES[navKey] ?? '';

  const handleAddLoadFromModal = () => {
    setEditingLoad(null);
    setEditingStops([]);
    setPage('add');
  };

  const handleAddExpenseFromModal = () => {
    setEditingExpense(null);
    setPage('add_expense');
  };

  const handleAddFuelFromModal = () => {
    setEditingFuelLog(null);
    setPage('add_fuel');
  };

  return (
    <div className="app-shell min-h-screen pb-24 lg:pb-0 lg:flex">
      <SEOHead title="Dashboard | HaulTrackerPro" description="Your trucking dashboard." path="/dashboard" noindex />
      <AppSidebar
        active={navKey}
        onNavigate={handleNavigate}
        role={effectiveRole ?? 'driver'}
        workspaceLoading={workspaceShellBlocked}
        recruiterCapabilityStatus={recruiterCapabilityStatus}
        recruiterOperationsAllowed={recruiterOperationsAllowed}
        assistantPermissions={isActingAsAssistant ? actingPermissions : null}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Premium header (mobile + desktop) */}
        <header className="sticky top-0 z-40 bg-card/70 backdrop-blur-md border-b border-border/60 lg:bg-transparent lg:border-b-0">
          <div className="flex items-center justify-between px-4 py-3.5 max-w-7xl mx-auto w-full gap-2">
            <div className="flex items-center gap-2.5 lg:hidden min-w-0 flex-1">
              <div className="rounded-xl bg-primary p-2 shadow-primary shrink-0">
                <Truck className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-black font-heading tracking-tight text-foreground truncate">
                  Haul<span className="text-primary">TrackerPro</span>
                </h1>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.2em] truncate">{workspaceLoading ? 'Loading…' : isRecruiterView ? 'Recruiter Console' : 'Load & Pay Manager'}</p>
              </div>
            </div>
            <div className="hidden lg:block min-w-0">
              <h2 className="text-lg font-black tracking-tight text-foreground truncate">{navLabel}</h2>
              <p className="text-xs text-muted-foreground truncate">{navSubtitle}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canSwitch && !workspaceShellBlocked && (
                <div className="hidden lg:block">
                  <ViewModeSwitch
                    value={effectiveRole ?? 'driver'}
                    onChange={handleWorkspaceSwitch}
                  />
                </div>
              )}
              <NotificationBell onNavigate={handleNavigate} />
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Admin console"
                  className="hidden lg:inline-flex gap-1.5 rounded-xl h-10 font-bold border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => navigate('/admin')}
                >
                  <Shield className="h-4 w-4" /> Admin
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sign out"
                className="hidden lg:inline-flex text-muted-foreground hover:text-foreground rounded-xl h-10 w-10"
                onClick={signOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {canSwitch && !workspaceShellBlocked && (
            <div className="lg:hidden px-4 pb-2 -mt-1 flex justify-end">
              <ViewModeSwitch
                value={effectiveRole ?? 'driver'}
                onChange={handleWorkspaceSwitch}
              />
            </div>
          )}
        </header>

        <main className="px-4 py-5 max-w-7xl mx-auto w-full">
        {/* Hard render-level workspace gate. NO driver/recruiter/shared
            workspace child may mount until: (1) capability is not loading,
            (2) no capability error, (3) effectiveRole is non-null, and
            (4) the policy says the CURRENT page/subview is settled. */}
        {workspaceLoading ? (
          <ViewFallback />
        ) : workspaceUnavailable ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="workspace-unavailable"
            className="flex min-h-[40vh] flex-col items-center justify-center gap-4 py-12 text-center"
          >
            <p className="text-sm text-muted-foreground max-w-md">
              Your workspace is temporarily unavailable. Please try again in a moment.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Try Again
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4 mr-1.5" /> Sign Out
              </Button>
            </div>
          </div>
        ) : !navigationSettled ? (
          <ViewFallback />
        ) : (
          <>
        {/* Smart Reminders */}
        {!showOnboarding && page === 'dashboard' && !isRecruiterView && (
          <div className="mb-4">
            <SmartReminders
              loads={allLoadsQuery.loads}
              onNavigate={handleNavigate}
              onDismiss={(key) => setDismissedReminders(prev => new Set(prev).add(key))}
              dismissed={dismissedReminders}
            />
          </div>
        )}

        {showOnboarding ? (
          <Onboarding onGetStarted={() => { setEditingLoad(null); setPage('add'); }} />
        ) : isActingAsAssistant && !isAssistantPageAllowed(page, actingPermissions) ? (
          <AssistantBlockedNotice
            driverName={actingDriver?.driver_name || actingDriver?.driver_email || 'this driver'}
            permissions={actingPermissions}
            onGoToAllowed={(p) => setPage(p)}
            onExit={() => { exitActingAs(); navigate('/assistant'); }}
          />
        ) : (
          <Suspense fallback={<ViewFallback />}>
          <>

            {page === 'dashboard' && (
              <>
                {releaseReady && !hasSeenLatest && (
                  <WhatsNewCard
                    onOpen={() => setShowWhatsNew(true)}
                    onDismiss={() => markSeen()}
                  />
                )}
                {!isRecruiterView && (
                  <ContractActionsCard role="driver" onOpen={() => handleNavigate('contracts')} />
                )}
                {!subscription.isLoading && !isRecruiterView && (
                  <MilestoneNudges
                    loadsCount={allLoadsQuery.loads.length}
                    expensesCount={allExpensesQuery.expenses.length}
                    isPro={isPro}
                    onUpgrade={handleUpgrade}
                    onNavigate={handleNavigate}
                  />
                )}
                {/* Role path card for new / low-activity drivers only */}
                {!roleCardDismissed && !isRecruiterView && allLoadsQuery.loads.length <= 3 && (
                  <div className="mb-4 p-4 rounded-2xl border relative" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                    <button
                      onClick={() => {
                        try { localStorage.setItem('htp_role_card_dismissed', '1'); } catch {}
                        setRoleCardDismissed(true);
                      }}
                      className="absolute top-3 right-3 p-1 rounded-lg hover:bg-white/5 transition-colors"
                      style={{ color: 'hsl(220, 10%, 50%)' }}
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <h3 className="text-sm font-bold mb-3" style={{ color: 'hsl(0, 0%, 100%)' }}>What do you want to do next?</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { icon: TrendingUp, label: 'Track Profit', action: () => { setEditingLoad(null); setPage('add'); } },
                        { icon: Route, label: hasCompletedDriverProfile ? 'Find Opportunities' : 'Set Opportunity Preferences', action: () => openOpportunitiesView(hasCompletedDriverProfile ? 'list' : 'driver-profile') },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={item.action}
                          className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors hover:bg-white/5 active:scale-[0.98]"
                          style={{ borderColor: 'hsl(220, 16%, 16%)', color: 'hsl(220, 10%, 70%)' }}
                        >
                          <item.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                          <span className="text-[11px] font-semibold text-center leading-tight">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <DashboardView
                  loads={allLoadsQuery.loads}
                  expenses={allExpensesQuery.expenses}
                  fuelLogs={allFuelLogsQuery.fuelLogs}
                  isLoading={allLoadsQuery.isLoading}
                  onNavigate={handleNavigate}
                  smartAlerts={smartAlerts}
                  isPro={isPro}
                  settingsOverride={isActingAsAssistant ? driverReportSettings ?? null : null}
                  showRecommendedOpportunity={!isActingAsAssistant && effectiveRole === 'driver' && driverWorkspaceAllowed}
                />

              </>
            )}
            {page === 'closeout' && (
              <WeeklyCloseout
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                onNavigate={handleNavigate}
                onBack={() => setPage('dashboard')}
                isPro={isPro}
              />
            )}
            {page === 'add' && (
              <div className="animate-fade-in">
                <LoadForm
                  onSubmit={editingLoad && editingLoad.id ? handleUpdateLoad : handleAddLoad}
                  onCancel={editingLoad ? () => { setEditingLoad(null); setEditingStops([]); setPage('loads'); } : () => setPage('dashboard')}
                  initialData={editingLoad || undefined}
                  initialStops={editingStops.length > 0 ? editingStops : undefined}
                  loading={addLoad.isPending || updateLoad.isPending}
                  recentLoads={allLoadsQuery.loads}
                  isPro={isPro}
                  firstTimeUser={!editingLoad && !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0}
                  onOpenSettings={() => setPage('settings')}
                />
              </div>
            )}
            {page === 'add_expense' && (
              <div className="animate-fade-in">
                <ExpenseForm
                  onSubmit={editingExpense ? handleUpdateExpense : handleAddExpense}
                  onCancel={() => { setEditingExpense(null); setPage('expenses'); }}
                  loading={allExpensesQuery.addExpense.isPending || allExpensesQuery.updateExpense.isPending}
                  loads={allLoadsQuery.loads}
                  initialData={editingExpense}
                  isPro={isPro}
                />
              </div>
            )}
            {page === 'add_fuel' && (
              <div className="animate-fade-in">
                <FuelLogForm
                  onSubmit={editingFuelLog ? handleUpdateFuelLog : handleAddFuelLog}
                  onCancel={() => { setEditingFuelLog(null); setPage('fuel'); }}
                  loading={allFuelLogsQuery.addFuelLog.isPending || allFuelLogsQuery.updateFuelLog.isPending}
                  loads={allLoadsQuery.loads}
                  initialData={editingFuelLog}
                />
              </div>
            )}
            {page === 'fuel' && (
              <FuelLogsListView
                fuelLogs={allFuelLogsQuery.fuelLogs}
                loads={allLoadsQuery.loads}
                onEdit={handleEditFuelLog}
                onDelete={handleDeleteFuelLog}
                isLoading={allFuelLogsQuery.isLoading}
                onBack={() => setPage('dashboard')}
              />
            )}
            {page === 'expenses' && (
              <ExpensesListView
                expenses={allExpensesQuery.expenses}
                loads={allLoadsQuery.loads}
                onEdit={handleEditExpense}
                onDelete={handleDeleteExpense}
                isLoading={allExpensesQuery.isLoading}
                onBack={() => setPage('dashboard')}
                onNavigate={handleNavigate}
              />
            )}
            {page === 'recurring_expenses' && (
              <RecurringExpensesView
                isPro={isPro}
                onBack={() => setPage('expenses')}
              />
            )}
            {page === 'loads' && (
              <LoadsListView
                loads={filteredLoadsForList}
                expenses={allExpensesQuery.expenses}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={handleQuickUpdate}
                onDuplicate={handleDuplicate}
                onDateRangeChange={(from, to) => setDateRange({ from, to })}
                currentDateRange={dateRange}
                isLoading={allLoadsQuery.isLoading}
                initialPayFilter={loadsPayFilter}
              />
            )}
            {page === 'reports' && (
              <ReportsView
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                onNavigate={handleNavigate}
                isPro={isPro}
                settingsOverride={isActingAsAssistant ? driverReportSettings ?? null : null}
                canExport={canExportReports}
              />
            )}

            {page === 'monthly' && (
              <MonthlySummary
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                onBack={() => setPage('reports')}
                isPro={isPro}
                canExport={canExportReports}
                settingsOverride={isActingAsAssistant ? driverReportSettings ?? null : null}
              />

            )}
            {page === 'alerts' && (
              <AlertsView
                alerts={smartAlerts.alerts}
                onDismiss={(key) => smartAlerts.dismissAlert.mutate(key)}
                onNavigate={handleNavigate}
                onBack={() => setPage('dashboard')}
                isPro={isPro}
              />
            )}
            {page === 'scorecard' && (
              <DriverScorecard
                scorecard={scorecard}
                onBack={() => setPage('dashboard')}
                isPro={isPro}
              />
            )}
            {page === 'opportunities' && <OpportunitiesPage key={opportunitiesViewKey} onUpgrade={handleUpgrade} onViewChange={setOpportunitiesView} />}
            {page === 'settlements' && !isRecruiterView && (
              <DriverSettlementsView onBack={() => setPage('dashboard')} />
            )}
            {page === 'contracts' && (isRecruiterView ? (
              <RecruiterContractsView onOpenApplications={() => handleNavigate('recruiter-access:applications')} />
            ) : (
              <DriverContractsView onOpenApplications={() => handleNavigate('opportunities')} />
            ))}
            {page === 'recruiter-access' && isRecruiterView && recruiterCapabilityStatus === 'active' && recruiterOperationsAllowed && (
              <>
                <ContractActionsCard role="recruiter" onOpen={() => handleNavigate('contracts')} />
              </>
            )}
            {page === 'recruiter-access' && isRecruiterView && (
              <RecruiterAccessRoute
                onBack={() => {
                  if (canSwitch) {
                    setViewMode('driver');
                    setPage('dashboard');
                  }
                }}
                initialView={recruiterView}
                recruiterCapabilityStatus={recruiterCapabilityStatus}
                recruiterHubAllowed={recruiterHubAllowed}
                recruiterOperationsAllowed={recruiterOperationsAllowed}
                workspaceLoading={workspaceLoading}
                workspaceError={workspaceError}
              />
            )}
            {page === 'settings' && (isRecruiterView ? (
              <RecruiterSettingsView
                onBack={() => setPage('recruiter-access')}
                onOpenOnboarding={() => { setRecruiterView('onboarding'); setPage('recruiter-access'); }}
                onOpenBilling={() => { setRecruiterView('hub'); setPage('recruiter-access'); }}
              />
            ) : (
              <SettingsView onBack={() => setPage('dashboard')} />
            ))}
          </>
          </Suspense>
        )}
          </>
        )}
      </main>
      </div>

      <div className="lg:hidden">
        <BottomNav
          active={page}
          onNavigate={handleNavigate}
          role={effectiveRole ?? 'driver'}
          workspaceLoading={workspaceShellBlocked}
          recruiterCapabilityStatus={recruiterCapabilityStatus}
          recruiterOperationsAllowed={recruiterOperationsAllowed}
          assistantPermissions={isActingAsAssistant ? actingPermissions : null}
        />
      </div>
      {!workspaceShellBlocked && (
        <>
          {effectiveRole === 'driver' && driverWorkspaceAllowed && (
            <AddActionModal
              open={showAddModal}
              onOpenChange={setShowAddModal}
              onAddLoad={handleAddLoadFromModal}
              onAddExpense={handleAddExpenseFromModal}
              onAddFuelLog={handleAddFuelFromModal}
            />
          )}
          <Suspense fallback={null}>
            <FeedbackModal
              totalLoads={allLoadsQuery.loads.length}
              open={showFeedback}
              onClose={() => setShowFeedback(false)}
            />
            {effectiveRole === 'driver' && driverWorkspaceAllowed && (
              <OnboardingModal
                open={showOnboardingModal}
                onComplete={handleOnboardingComplete}
                onNavigateSettings={() => { setShowOnboardingModal(false); setPage('settings'); }}
              />
            )}
            <WhatsNewModal open={showWhatsNew} onClose={handleCloseWhatsNew} />
          </Suspense>
        </>
      )}
    </div>
  );
};

export default Index;
