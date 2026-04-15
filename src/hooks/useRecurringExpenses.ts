import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface RecurringExpenseTemplate {
  id: string;
  user_id: string;
  template_name: string;
  category: string;
  amount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  is_active: boolean;
  last_generated_date: string | null;
  expense_type: string;
  created_at: string;
  updated_at: string;
}

export interface RecurringExpenseTemplateInsert {
  template_name: string;
  category: string;
  amount: number;
  frequency?: string;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  is_active?: boolean;
  expense_type?: string;
}

export function useRecurringExpenses() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const templatesQuery = useQuery({
    queryKey: ['recurring_expense_templates', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('recurring_expense_templates')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RecurringExpenseTemplate[];
    },
    enabled: !!user,
  });

  const addTemplate = useMutation({
    mutationFn: async (data: RecurringExpenseTemplateInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recurring_expense_templates')
        .insert({ ...data, user_id: user.id } as any);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RecurringExpenseTemplateInsert> }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(data as any)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update({ is_active } as any)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('recurring_expense_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  return {
    templates: templatesQuery.data ?? [],
    isLoading: templatesQuery.isLoading,
    addTemplate,
    updateTemplate,
    toggleActive,
    deleteTemplate,
  };
}
