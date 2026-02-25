import { useState } from 'react';
import { useLoads, Load, LoadInsert } from '@/hooks/useLoads';
import { useAuth } from '@/hooks/useAuth';
import { BottomNav } from '@/components/BottomNav';
import { DashboardView } from '@/components/DashboardView';
import { LoadForm } from '@/components/LoadForm';
import { LoadsListView } from '@/components/LoadsListView';
import { ReportsView } from '@/components/ReportsView';
import { Onboarding } from '@/components/Onboarding';
import { Truck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const Index = () => {
  const { signOut } = useAuth();
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const { loads, isLoading, addLoad, updateLoad, deleteLoad } = useLoads(dateRange);
  const [page, setPage] = useState('dashboard');
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);

  // For dashboard/reports we want all loads (no date filter)
  const allLoadsQuery = useLoads();

  const showOnboarding = !isLoading && allLoadsQuery.loads.length === 0 && page === 'dashboard';

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

  const handleEdit = (load: Load) => {
    setEditingLoad(load);
    setPage('add');
  };

  const handleNavigate = (p: string) => {
    if (p !== 'add') setEditingLoad(null);
    setPage(p);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-secondary text-secondary-foreground">
        <div className="flex items-center justify-between px-4 py-3 max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-1.5">
              <Truck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-black font-heading tracking-tight">HaulTracker</h1>
              <p className="text-[10px] text-secondary-foreground/60 font-medium uppercase tracking-wider">Load & Pay Manager</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-secondary-foreground/60 hover:text-secondary-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-5 max-w-lg mx-auto">
        {showOnboarding ? (
          <Onboarding onGetStarted={() => setPage('add')} />
        ) : (
          <>
            {page === 'dashboard' && <DashboardView loads={allLoadsQuery.loads} />}
            {page === 'add' && (
              <div className="animate-fade-in">
                <LoadForm
                  onSubmit={editingLoad ? handleUpdateLoad : handleAddLoad}
                  onCancel={editingLoad ? () => { setEditingLoad(null); setPage('loads'); } : undefined}
                  initialData={editingLoad || undefined}
                  loading={addLoad.isPending || updateLoad.isPending}
                />
              </div>
            )}
            {page === 'loads' && (
              <LoadsListView
                loads={loads}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onDateRangeChange={(from, to) => setDateRange({ from, to })}
                isLoading={isLoading}
              />
            )}
            {page === 'reports' && <ReportsView loads={allLoadsQuery.loads} />}
          </>
        )}
      </main>

      <BottomNav active={page} onNavigate={handleNavigate} />
    </div>
  );
};

export default Index;
