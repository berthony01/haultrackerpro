import { useState } from 'react';
import { useLoads } from '@/hooks/useLoads';
import { Load } from '@/lib/types';
import { BottomNav } from '@/components/BottomNav';
import { DashboardView } from '@/components/DashboardView';
import { LoadForm } from '@/components/LoadForm';
import { LoadsListView } from '@/components/LoadsListView';
import { ReportsView } from '@/components/ReportsView';
import { Truck } from 'lucide-react';
import { toast } from 'sonner';

const Index = () => {
  const { loads, addLoad, updateLoad, deleteLoad } = useLoads();
  const [page, setPage] = useState('dashboard');
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);

  const handleAddLoad = (data: Omit<Load, 'id' | 'totalPay' | 'createdAt'>) => {
    addLoad(data);
    toast.success('Load logged successfully!');
    setPage('loads');
  };

  const handleUpdateLoad = (data: Omit<Load, 'id' | 'totalPay' | 'createdAt'>) => {
    if (editingLoad) {
      updateLoad(editingLoad.id, data);
      toast.success('Load updated!');
      setEditingLoad(null);
      setPage('loads');
    }
  };

  const handleDelete = (id: string) => {
    deleteLoad(id);
    toast.success('Load deleted');
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
      {/* Header */}
      <header className="sticky top-0 z-40 bg-secondary text-secondary-foreground">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <div className="rounded-lg bg-primary p-1.5">
            <Truck className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-black font-heading tracking-tight">HaulTracker</h1>
            <p className="text-[10px] text-secondary-foreground/60 font-medium uppercase tracking-wider">Load & Pay Manager</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-4 py-5 max-w-lg mx-auto">
        {page === 'dashboard' && <DashboardView loads={loads} />}
        {page === 'add' && (
          <div className="animate-fade-in">
            <LoadForm
              onSubmit={editingLoad ? handleUpdateLoad : handleAddLoad}
              onCancel={editingLoad ? () => { setEditingLoad(null); setPage('loads'); } : undefined}
              initialData={editingLoad || undefined}
            />
          </div>
        )}
        {page === 'loads' && (
          <LoadsListView loads={loads} onEdit={handleEdit} onDelete={handleDelete} />
        )}
        {page === 'reports' && <ReportsView loads={loads} />}
      </main>

      <BottomNav active={page} onNavigate={handleNavigate} />
    </div>
  );
};

export default Index;
