import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export const EXPENSE_CATEGORIES = [
  'Fuel',
  'Maintenance',
  'Repairs',
  'Insurance',
  'Tolls',
  'Permits',
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
}

interface DateRange {
  from?: string;
  to?: string;
}

export function useExpenses(dateRange?: DateRange) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const expensesQuery = useQuery({
    queryKey: ['expenses', user?.id, dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!user) return [];
      let query = supabase
        .from('expenses')
        .select('*')
        .eq('user_id', user.id)
        .order('expense_date', { ascending: false });

      if (dateRange?.from) query = query.gte('expense_date', dateRange.from);
      if (dateRange?.to) query = query.lte('expense_date', dateRange.to);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Expense[];
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

  const deleteExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  return {
    expenses: expensesQuery.data ?? [],
    isLoading: expensesQuery.isLoading,
    addExpense,
    deleteExpense,
  };
}
