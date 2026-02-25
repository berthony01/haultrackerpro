import { useState, useEffect } from 'react';
import { useLoads, Load, LoadInsert, LoadUpdate } from '@/hooks/useLoads';
import { useExpenses, ExpenseInsert } from '@/hooks/useExpenses';
import { useAuth } from '@/hooks/useAuth';
import { useFeedback } from '@/hooks/useFeedback';
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
import { Truck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const Index = () => {
  const { signOut } = useAuth();
  const { responses: feedbackResponses } = useFeedback();
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { loads, isLoading, addLoad, updateLoad, deleteLoad } = useLoads(dateRange);
  const [page, setPage] = useState('dashboard');
  const [loadsPayFilter, setLoadsPayFilter] = useState<string | undefined>();
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const allLoadsQuery = useLoads();
  const allExpensesQuery = useExpenses();

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

  const showOnboarding = !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0 && page === 'dashboard';

  const handleAddLoad = (data: LoadInsert) => {
    addLoad.mutate(data, {
      onSuccess: () => { toast.success('Load logged successfully!'); setPage('loads'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleAddExpense = (data: ExpenseInsert) => {
    allExpensesQuery.addExpense.mutate(data, {
      onSuccess: () => { toast.success('Expense saved!'); setPage('dashboard'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleUpdateLoad = (data: LoadInsert) => {
    if (!editingLoad) return;
    updateLoad.mutate({ id: editingLoad.id, data }, {
      onSuccess: () => { toast.success('Load updated!'); setEditingLoad(null); setPage('loads'); },
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
    setPage('add');
    const dup: Load = { ...load, id: '', load_date: new Date().toISOString().split('T')[0], actual_pay_received: null, status: 'pending' };
    setEditingLoad(dup);
  };

  const handleEdit = (load: Load) => {
    setEditingLoad(load);
    setPage('add');
  };

  const handleNavigate = (p: string, options?: { filter?: string }) => {
    if (p === 'add') {
      // Show modal to pick load or expense
      setShowAddModal(true);
      return;
    }
    setEditingLoad(null);
    setLoadsPayFilter(p === 'loads' ? options?.filter : undefined);
    setPage(p);
  };

  const handleAddLoadFromModal = () => {
    setEditingLoad(null);
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
                Haul<span className="text-primary">Tracker</span>
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
              />
            )}
            {page === 'closeout' && (
              <WeeklyCloseout
                loads={allLoadsQuery.loads}
                onNavigate={handleNavigate}
                onBack={() => setPage('dashboard')}
              />
            )}
            {page === 'add' && (
              <div className="animate-fade-in">
                <LoadForm
                  onSubmit={editingLoad && editingLoad.id ? handleUpdateLoad : handleAddLoad}
                  onCancel={editingLoad ? () => { setEditingLoad(null); setPage('loads'); } : () => setPage('dashboard')}
                  initialData={editingLoad || undefined}
                  loading={addLoad.isPending || updateLoad.isPending}
                  recentLoads={allLoadsQuery.loads}
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
              />
            )}
            {page === 'monthly' && (
              <MonthlySummary
                loads={allLoadsQuery.loads}
                expenses={allExpensesQuery.expenses}
                onBack={() => setPage('reports')}
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
    </div>
  );
};

export default Index;
