import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export const EXPENSE_CATEGORIES = [
  'Fuel',
  'Maintenance',
  'Repairs',
  'Tires',
  'Insurance',
  'Tolls',
  'Parking',
  'Permits',
  'Licensing',
  'Truck Payment',
  'Lease Payment',
  'Phone',
  'ELD/Software',
  'Scale/Weigh',
  'Lumper',
  'Meals',
  'Lodging',
  'Supplies',
  'Other',
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export interface Expense {
  id: string;
  user_id: string;
  expense_date: string;
  category: string;
  amount: number;
  gallons: number | null;
  linked_load_id: string | null;
  notes: string | null;
  expense_type: 'fixed' | 'variable';
  created_at: string;
  updated_at: string;
}

export interface ExpenseInsert {
  expense_date: string;
  category: string;
  amount: number;
  gallons?: number | null;
  linked_load_id?: string | null;
  notes?: string | null;
  expense_type?: 'fixed' | 'variable';
}

interface DateRange {
  from?: string;
  to?: string;
}

const PAGE_SIZE = 50;

export function useExpenses(dateRange?: DateRange, page?: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const expensesQuery = useQuery({
    queryKey: ['expenses', user?.id, dateRange?.from, dateRange?.to, page],
    queryFn: async () => {
      if (!user) return { expenses: [], totalCount: 0 };

      const buildQuery = () => {
        let q = supabase
          .from('expenses')
          .select('*', { count: 'exact' })
          .eq('user_id', user.id)
          .order('expense_date', { ascending: false });
        if (dateRange?.from) q = q.gte('expense_date', dateRange.from);
        if (dateRange?.to) q = q.lte('expense_date', dateRange.to);
        return q;
      };

      // Paged mode: return just the requested page
      if (page !== undefined) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error, count } = await buildQuery().range(from, to);
        if (error) throw error;
        return {
          expenses: (data ?? []) as unknown as Expense[],
          totalCount: count ?? (data ?? []).length,
        };
      }

      // Unpaged mode: fetch ALL rows in batches to bypass Supabase's
      // default 1000-row response cap. This keeps dashboard totals,
      // exports, and analytics accurate beyond 1k expenses.
      const FETCH_SIZE = 1000;
      const all: Expense[] = [];
      let offset = 0;
      let totalCount = 0;
      // Safety cap: 100k rows (100 pages) to avoid runaway loops
      for (let i = 0; i < 100; i++) {
        const { data, error, count } = await buildQuery().range(offset, offset + FETCH_SIZE - 1);
        if (error) throw error;
        const batch = (data ?? []) as unknown as Expense[];
        all.push(...batch);
        if (typeof count === 'number') totalCount = count;
        if (batch.length < FETCH_SIZE) break;
        offset += FETCH_SIZE;
      }
      return {
        expenses: all,
        totalCount: totalCount || all.length,
      };
    },
    enabled: !!user,
  });

  const addExpense = useMutation({
    mutationFn: async (data: ExpenseInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { data: result, error } = await supabase
        .from('expenses')
        .insert({ ...data, user_id: user.id } as any)
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const updateExpense = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ExpenseInsert }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('expenses')
        .update({ ...data, user_id: user.id } as any)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const deleteExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  return {
    expenses: expensesQuery.data?.expenses ?? [],
    totalCount: expensesQuery.data?.totalCount ?? 0,
    isLoading: expensesQuery.isLoading,
    addExpense,
    updateExpense,
    deleteExpense,
    pageSize: PAGE_SIZE,
  };
}
