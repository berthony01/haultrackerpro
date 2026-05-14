import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLoads, Load, LoadInsert, LoadUpdate } from '@/hooks/useLoads';
import SEOHead from '@/components/SEOHead';
import { useExpenses, ExpenseInsert, Expense } from '@/hooks/useExpenses';
import { useLoadStops, LoadStopInput } from '@/hooks/useLoadStops';
import { useFuelLogs, FuelLogInsert, FuelLog } from '@/hooks/useFuelLogs';
import { useAuth } from '@/hooks/useAuth';
import { useAdmin } from '@/hooks/useAdmin';
import { useFeedback } from '@/hooks/useFeedback';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useSmartAlerts } from '@/hooks/useSmartAlerts';
import { useDriverScorecard } from '@/hooks/useDriverScorecard';
import { useSubscription } from '@/hooks/useSubscription';
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
const RecurringExpensesView = lazy(() => import('@/components/RecurringExpensesView').then(m => ({ default: m.RecurringExpensesView })));
const DriverScorecard = lazy(() => import('@/components/DriverScorecard').then(m => ({ default: m.DriverScorecard })));
const WhatsNewModal = lazy(() => import('@/components/WhatsNewModal').then(m => ({ default: m.WhatsNewModal })));

import { Truck, LogOut, X, Route, Users, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { trackPurchase, trackLoadLogged, trackExpenseLogged } from '@/lib/analytics';

// Tiny inline fallback — avoids whole-app skeleton flicker for view swaps.
const ViewFallback = () => (
  <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
);

const Index = () => {
  const { signOut, user } = useAuth();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdmin();
  const { responses: feedbackResponses } = useFeedback();
  const { settings } = useUserSettings();
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { loads, isLoading, addLoad, updateLoad, deleteLoad } = useLoads(dateRange);
  const [page, setPage] = useState('dashboard');
  const [loadsPayFilter, setLoadsPayFilter] = useState<string | undefined>();
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingFuelLog, setEditingFuelLog] = useState<FuelLog | null>(null);
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [roleCardDismissed, setRoleCardDismissed] = useState(() => {
    try { return localStorage.getItem('htp_role_card_dismissed') === '1'; } catch { return false; }
  });
  const { ready: releaseReady, hasSeenLatest, markSeen } = useReleaseNotesSeen();

  // Auto-open the What's New modal once per user (after onboarding modal isn't blocking)
  useEffect(() => {
    if (releaseReady && !hasSeenLatest && !showOnboardingModal) {
      setShowWhatsNew(true);
    }
  }, [releaseReady, hasSeenLatest, showOnboardingModal]);

  const handleCloseWhatsNew = () => {
    markSeen();
    setShowWhatsNew(false);
  };

  const allLoadsQuery = useLoads();
  const allExpensesQuery = useExpenses();
  const allFuelLogsQuery = useFuelLogs();
  const loadStopsHook = useLoadStops();

  // Smart Alerts & Scorecard
  const smartAlerts = useSmartAlerts(allLoadsQuery.loads, allExpensesQuery.expenses, settings?.week_start_day);
  const scorecard = useDriverScorecard(allLoadsQuery.loads, allExpensesQuery.expenses, settings?.week_start_day);

  // Pro gating — canonical subscription hook (Free vs Pro plans only)
  const subscription = useSubscription();
  const isPro = subscription.isPro;
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
    if (params.get('prefill') === 'load') {
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
    // Route to Opportunities from external recruiter CTA OR from auth intent (URL/sessionStorage)
    let recruiterIntent = false;
    try {
      const storedAuthIntent = sessionStorage.getItem('htp_auth_intent');
      if (storedAuthIntent === 'recruiter') {
        recruiterIntent = true;
        sessionStorage.removeItem('htp_auth_intent');
      }
    } catch {}
    if (params.get('page') === 'opportunities') {
      setPage('opportunities');
      const view = params.get('view');
      if (view === 'recruiter') {
        sessionStorage.setItem('htp_opportunities_initial_view', 'recruiter');
        recruiterIntent = true;
      } else if (view === 'driver-profile') {
        sessionStorage.setItem('htp_opportunities_initial_view', 'driver-profile');
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (recruiterIntent) {
      sessionStorage.setItem('htp_opportunities_initial_view', 'recruiter');
      setPage('opportunities');
    }
    if (recruiterIntent) {
      // Suppress driver-first onboarding modal once for recruiter signups
      try { sessionStorage.setItem('htp_recruiter_intent', '1'); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, subscription.isLoading, subscription.isPro, subscription.planKey]);

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

  // Activate premium dark theme on body so Radix portals (Sheet/Dialog/Popover/Tooltip)
  // — which mount outside the .app-shell subtree — inherit the same tokens.
  useEffect(() => {
    document.body.classList.add('app-shell-active');
    return () => document.body.classList.remove('app-shell-active');
  }, []);

  // Show onboarding modal for first-time users
  useEffect(() => {
    if (settings && !settings.onboarding_completed && !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0) {
      let recruiter = false;
      try { recruiter = sessionStorage.getItem('htp_recruiter_intent') === '1'; } catch {}
      if (recruiter) {
        try { sessionStorage.removeItem('htp_recruiter_intent'); } catch {}
        return;
      }
      setShowOnboardingModal(true);
    }
  }, [settings, allLoadsQuery.isLoading, allLoadsQuery.loads.length]);

  const handleOnboardingComplete = async () => {
    setShowOnboardingModal(false);
    if (user) {
      await supabase.from('user_settings').update({ onboarding_completed: true }).eq('user_id', user.id);
    }
    setEditingLoad(null);
    setPage('add');
  };

  const showOnboarding = !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0 && page === 'dashboard';

  const handleAddLoad = (data: LoadInsert, stops?: LoadStopInput[]) => {
    addLoad.mutate(data, {
      onSuccess: (result) => {
        trackLoadLogged(allLoadsQuery.loads.length + 1);
        if (stops && stops.length > 0 && result?.id) {
          loadStopsHook.saveStopsForLoad.mutate({ loadId: result.id, stops });
        }
        // Award +5 load points (Pro only). Fire-and-forget; never block the save.
        if (user && isPro) {
          try {
            supabase
              .rpc('award_points', { _user_id: user.id, _category: 'load', _amount: 5 })
              .then(({ error }) => {
                if (error) console.warn('award_points(load) failed', error);
                queryClient.invalidateQueries({ queryKey: ['driver-points'] });
                queryClient.invalidateQueries({ queryKey: ['driver-leaderboard'] });
              });
          } catch (e) {
            console.warn('award_points(load) threw', e);
          }
        }
        if (allExpensesQuery.expenses.length === 0) {
          toast.success('Load logged!', {
            description: 'Now log your first expense to see real net profit.',
            action: { label: 'Add Expense', onClick: () => { setPage('add_expense'); } },
          });
        } else {
          toast.success('Load logged successfully!');
        }
        setPage('loads');
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
    const dup: Load = { ...load, id: '', load_date: new Date().toISOString().split('T')[0], actual_pay_received: null, status: 'pending' };
    setEditingLoad(dup);
    const origStops = loadStopsHook.getStopsForLoad(load.id);
    setEditingStops(origStops.map(s => ({ stop_order: s.stop_order, location: s.location, stop_type: s.stop_type, detention_minutes: s.detention_minutes })));
  };

  const handleEdit = (load: Load) => {
    setEditingLoad(load);
    const origStops = loadStopsHook.getStopsForLoad(load.id);
    setEditingStops(origStops.map(s => ({ stop_order: s.stop_order, location: s.location, stop_type: s.stop_type, detention_minutes: s.detention_minutes })));
    setPage('add');
  };

  const navigate = useNavigate();

  const handleNavigate = (p: string, options?: { filter?: string }) => {
    if (p === 'add') {
      setShowAddModal(true);
      return;
    }
    if (p === 'parking') {
      navigate('/parking');
      return;
    }
    setEditingLoad(null);
    setEditingStops([]);
    setEditingExpense(null);
    setEditingFuelLog(null);
    setLoadsPayFilter(p === 'loads' ? options?.filter : undefined);
    setPage(p);
  };

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
      <AppSidebar active={page} onNavigate={handleNavigate} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Premium header (mobile + desktop) */}
        <header className="sticky top-0 z-40 bg-card/70 backdrop-blur-md border-b border-border/60 lg:bg-transparent lg:border-b-0">
          <div className="flex items-center justify-between px-4 py-3.5 max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="rounded-xl bg-primary p-2 shadow-primary">
                <Truck className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-base font-black font-heading tracking-tight text-foreground">
                  Haul<span className="text-primary">TrackerPro</span>
                </h1>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.2em]">Load &amp; Pay Manager</p>
              </div>
            </div>
            <div className="hidden lg:block">
              <h2 className="text-lg font-black tracking-tight text-foreground">
                {page === 'dashboard' ? 'Dashboard' : page.charAt(0).toUpperCase() + page.slice(1).replace('_', ' ')}
              </h2>
              <p className="text-xs text-muted-foreground">Your hauling overview</p>
            </div>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground rounded-xl h-10 w-10" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="px-4 py-5 max-w-7xl mx-auto w-full">
        {/* Smart Reminders */}
        {!showOnboarding && page === 'dashboard' && (
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
                {!subscription.isLoading && (
                  <MilestoneNudges
                    loadsCount={allLoadsQuery.loads.length}
                    expensesCount={allExpensesQuery.expenses.length}
                    isPro={isPro}
                    onUpgrade={handleUpgrade}
                    onNavigate={handleNavigate}
                  />
                )}
                {/* Role path card for new / low-activity users */}
                {!roleCardDismissed && allLoadsQuery.loads.length <= 3 && (
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
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { icon: TrendingUp, label: 'Track Profit', action: () => { setEditingLoad(null); setPage('add'); } },
                        { icon: Route, label: 'Find Opportunities', action: () => { try { sessionStorage.setItem('htp_opportunities_initial_view', hasCompletedDriverProfile ? 'list' : 'driver-profile'); } catch {} ; handleNavigate('opportunities'); } },
                        { icon: Users, label: 'Recruit Drivers', action: () => { try { sessionStorage.setItem('htp_opportunities_initial_view', 'recruiter'); } catch {} ; handleNavigate('opportunities'); } },
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
                loads={loads}
                expenses={allExpensesQuery.expenses}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={handleQuickUpdate}
                onDuplicate={handleDuplicate}
                onDateRangeChange={(from, to) => setDateRange({ from, to })}
                isLoading={isLoading}
                initialPayFilter={loadsPayFilter}
              />
            )}
            {page === 'reports' && (
              <ReportsView
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                onNavigate={handleNavigate}
                isPro={isPro}
              />
            )}
            {page === 'monthly' && (
              <MonthlySummary
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                onBack={() => setPage('reports')}
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
            {page === 'opportunities' && <OpportunitiesPage onUpgrade={handleUpgrade} />}
            {page === 'settings' && <SettingsView onBack={() => setPage('dashboard')} />}
          </>
        )}
      </main>
      </div>

      <div className="lg:hidden">
        <BottomNav active={page} onNavigate={handleNavigate} />
      </div>
      <AddActionModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onAddLoad={handleAddLoadFromModal}
        onAddExpense={handleAddExpenseFromModal}
        onAddFuelLog={handleAddFuelFromModal}
      />
      <FeedbackModal
        totalLoads={allLoadsQuery.loads.length}
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
      />
      <OnboardingModal
        open={showOnboardingModal}
        onComplete={handleOnboardingComplete}
        onNavigateSettings={() => { setShowOnboardingModal(false); setPage('settings'); }}
      />
      <WhatsNewModal open={showWhatsNew} onClose={handleCloseWhatsNew} />
    </div>
  );
};

export default Index;
