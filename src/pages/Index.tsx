import { useState } from 'react';
import { useLoads, Load, LoadInsert, LoadUpdate } from '@/hooks/useLoads';
import { useAuth } from '@/hooks/useAuth';
import { BottomNav } from '@/components/BottomNav';
import { DashboardView } from '@/components/DashboardView';
import { LoadForm } from '@/components/LoadForm';
import { LoadsListView } from '@/components/LoadsListView';
import { ReportsView } from '@/components/ReportsView';
import { SettingsView } from '@/components/SettingsView';
import { Onboarding } from '@/components/Onboarding';
import { WeeklyCloseout } from '@/components/WeeklyCloseout';
import { SmartReminders } from '@/components/SmartReminders';
import { MonthlySummary } from '@/components/MonthlySummary';
import { Truck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const Index = () => {
  const { signOut } = useAuth();
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { loads, isLoading, addLoad, updateLoad, deleteLoad } = useLoads(dateRange);
  const [page, setPage] = useState('dashboard');
  const [loadsPayFilter, setLoadsPayFilter] = useState<string | undefined>();
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());

  const allLoadsQuery = useLoads();

  const showOnboarding = !allLoadsQuery.isLoading && allLoadsQuery.loads.length === 0 && page === 'dashboard';

  const handleAddLoad = (data: LoadInsert) => {
    addLoad.mutate(data, {
      onSuccess: () => { toast.success('Load logged!'); setPage('loads'); },
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
    if (p !== 'add') setEditingLoad(null);
    setLoadsPayFilter(p === 'loads' ? options?.filter : undefined);
    setPage(p);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Dark header */}
      <header className="sticky top-0 z-40 bg-secondary">
        <div className="flex items-center justify-between px-4 py-3.5 max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary p-2 shadow-primary">
              <Truck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-black font-heading tracking-tight text-secondary-foreground">HaulTracker</h1>
              <p className="text-[10px] text-secondary-foreground/50 font-semibold uppercase tracking-widest">Load & Pay Manager</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-secondary-foreground/40 hover:text-secondary-foreground rounded-xl h-10 w-10" onClick={signOut}>
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
          <Onboarding onGetStarted={() => setPage('add')} />
        ) : (
          <>
            {page === 'dashboard' && <DashboardView loads={allLoadsQuery.loads} isLoading={allLoadsQuery.isLoading} onNavigate={handleNavigate} />}
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
                  onCancel={editingLoad ? () => { setEditingLoad(null); setPage('loads'); } : undefined}
                  initialData={editingLoad || undefined}
                  loading={addLoad.isPending || updateLoad.isPending}
                  recentLoads={allLoadsQuery.loads}
                />
              </div>
            )}
            {page === 'loads' && (
              <LoadsListView
                loads={loads}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={handleQuickUpdate}
                onDuplicate={handleDuplicate}
                onDateRangeChange={(from, to) => setDateRange({ from, to })}
                isLoading={isLoading}
                initialPayFilter={loadsPayFilter}
              />
            )}
            {page === 'reports' && <ReportsView loads={allLoadsQuery.loads} onNavigate={handleNavigate} />}
            {page === 'monthly' && <MonthlySummary loads={allLoadsQuery.loads} onBack={() => setPage('reports')} />}
            {page === 'settings' && <SettingsView onBack={() => setPage('dashboard')} />}
          </>
        )}
      </main>

      <BottomNav active={page} onNavigate={handleNavigate} />
    </div>
  );
};

export default Index;
