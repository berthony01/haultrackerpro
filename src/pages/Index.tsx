import { useState, useEffect } from 'react';
import { useLoads, Load, LoadInsert, LoadUpdate } from '@/hooks/useLoads';
import { useExpenses, ExpenseInsert } from '@/hooks/useExpenses';
import { useLoadStops, LoadStopInput } from '@/hooks/useLoadStops';
import { useAuth } from '@/hooks/useAuth';
import { useFeedback } from '@/hooks/useFeedback';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useSmartAlerts } from '@/hooks/useSmartAlerts';
import { useDriverScorecard } from '@/hooks/useDriverScorecard';
import { BottomNav } from '@/components/BottomNav';
import { DashboardView } from '@/components/DashboardView';
import { LoadForm } from '@/components/LoadForm';
import { ExpenseForm } from '@/components/ExpenseForm';
import { AddActionModal } from '@/components/AddActionModal';
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
import { DriverScorecard } from '@/components/DriverScorecard';
import { Truck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const Index = () => {
  const { signOut, user } = useAuth();
  const { responses: feedbackResponses } = useFeedback();
  const { settings } = useUserSettings();
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { loads, isLoading, addLoad, updateLoad, deleteLoad } = useLoads(dateRange);
  const [page, setPage] = useState('dashboard');
  const [loadsPayFilter, setLoadsPayFilter] = useState<string | undefined>();
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  const allLoadsQuery = useLoads();
  const allExpensesQuery = useExpenses();
  const loadStopsHook = useLoadStops();

  // Smart Alerts & Scorecard
  const smartAlerts = useSmartAlerts(allLoadsQuery.loads, allExpensesQuery.expenses);
  const scorecard = useDriverScorecard(allLoadsQuery.loads, allExpensesQuery.expenses);

  // Pro gating — check subscription via Stripe on mount
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (!user) return;
    const checkSub = async () => {
      try {
        const { data } = await supabase.functions.invoke('check-subscription');
        setIsPro(data?.subscribed === true);
      } catch {
        // Fallback to profile status
        const { data: profile } = await supabase.from('profiles').select('subscription_status').eq('user_id', user.id).maybeSingle();
        setIsPro(profile?.subscription_status === 'pro' || profile?.subscription_status === 'trial');
      }
    };
    checkSub();
    const interval = setInterval(checkSub, 60000);
    return () => clearInterval(interval);
  }, [user]);

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
        if (stops && stops.length > 0 && result?.id) {
          loadStopsHook.saveStopsForLoad.mutate({ loadId: result.id, stops });
        }
        toast.success('Load logged successfully!');
        setPage('loads');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleAddExpense = (data: ExpenseInsert) => {
    allExpensesQuery.addExpense.mutate(data, {
      onSuccess: () => { toast.success('Expense saved!'); setPage('dashboard'); },
      onError: (e) => toast.error(e.message),
    });
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

  const handleNavigate = (p: string, options?: { filter?: string }) => {
    if (p === 'add') {
      setShowAddModal(true);
      return;
    }
    setEditingLoad(null);
    setEditingStops([]);
    setLoadsPayFilter(p === 'loads' ? options?.filter : undefined);
    setPage(p);
  };

  const handleAddLoadFromModal = () => {
    setEditingLoad(null);
    setEditingStops([]);
    setPage('add');
  };

  const handleAddExpenseFromModal = () => {
    setPage('add_expense');
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Premium header */}
      <header className="sticky top-0 z-40 bg-secondary">
        <div className="flex items-center justify-between px-4 py-3.5 max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary p-2 shadow-primary">
              <Truck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-black font-heading tracking-tight text-secondary-foreground">
                Haul<span className="text-primary">TrackerPro</span>
              </h1>
              <p className="text-[10px] text-secondary-foreground/40 font-semibold uppercase tracking-[0.2em]">Load & Pay Manager</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-secondary-foreground/30 hover:text-secondary-foreground rounded-xl h-10 w-10" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-5 max-w-lg mx-auto">
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
              <DashboardView
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                isLoading={allLoadsQuery.isLoading}
                onNavigate={handleNavigate}
                smartAlerts={smartAlerts}
                isPro={isPro}
              />
            )}
            {page === 'closeout' && (
              <WeeklyCloseout
                loads={allLoadsQuery.loads}
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
                />
              </div>
            )}
            {page === 'add_expense' && (
              <div className="animate-fade-in">
                <ExpenseForm
                  onSubmit={handleAddExpense}
                  onCancel={() => setPage('dashboard')}
                  loading={allExpensesQuery.addExpense.isPending}
                  loads={allLoadsQuery.loads}
                />
              </div>
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

      <BottomNav active={page} onNavigate={handleNavigate} />
      <AddActionModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onAddLoad={handleAddLoadFromModal}
        onAddExpense={handleAddExpenseFromModal}
      />
      <FeedbackModal
        totalLoads={allLoadsQuery.loads.length}
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
      />
      <OnboardingModal
        open={showOnboardingModal}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
};

export default Index;
