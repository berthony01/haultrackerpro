import { useState, useEffect } from 'react';
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
import { BottomNav } from '@/components/BottomNav';
import { AppSidebar } from '@/components/premium/AppSidebar';
import { DashboardView } from '@/components/DashboardView';
import { LoadForm } from '@/components/LoadForm';
import { ExpenseForm } from '@/components/ExpenseForm';
import { FuelLogForm } from '@/components/FuelLogForm';
import { FuelLogsListView } from '@/components/FuelLogsListView';
import { AddActionModal } from '@/components/AddActionModal';
import { ExpensesListView } from '@/components/ExpensesListView';
import { LoadsListView } from '@/components/LoadsListView';
import { ReportsView } from '@/components/ReportsView';
import { SettingsView } from '@/components/SettingsView';
import { Onboarding } from '@/components/Onboarding';
import { WeeklyCloseout } from '@/components/WeeklyCloseout';
import { SmartReminders } from '@/components/SmartReminders';
import { MonthlySummary } from '@/components/MonthlySummary';
import { FeedbackModal } from '@/components/FeedbackModal';
import { OnboardingModal } from '@/components/OnboardingModal';
import { AlertsView } from '@/components/AlertsView';

import { RecurringExpensesView } from '@/components/RecurringExpensesView';
import { MilestoneNudges } from '@/components/MilestoneNudges';
import { WhatsNewCard } from '@/components/WhatsNewCard';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import { useReleaseNotesSeen } from '@/hooks/useReleaseNotesSeen';
import { DriverScorecard } from '@/components/DriverScorecard';
import { Truck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { trackPurchase, trackLoadLogged, trackExpenseLogged } from '@/lib/analytics';

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

  // Show onboarding modal for first-time users
  useEffect(() => {
    if (settings && !settings.onboarding_completed && !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0) {
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
