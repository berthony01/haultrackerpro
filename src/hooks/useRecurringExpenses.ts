import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type RecurringExpenseTemplate = Tables<'recurring_expense_templates'>;

export type RecurringExpenseTemplateInsert = Omit<
  TablesInsert<'recurring_expense_templates'>,
  'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_generated_date'
>;

// Helper: returns true if a template is currently active.
// Uses the new `status` field with `is_active` as fallback for legacy rows.
export function isTemplateActive(t: Pick<RecurringExpenseTemplate, 'status' | 'is_active'>): boolean {
  if (t.status) return t.status === 'active';
  return !!t.is_active;
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
      return data ?? [];
    },
    enabled: !!user,
  });

  const addTemplate = useMutation({
    mutationFn: async (data: RecurringExpenseTemplateInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recurring_expense_templates')
        .insert({ ...data, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RecurringExpenseTemplateInsert> }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(data as TablesUpdate<'recurring_expense_templates'>)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  // Pause a single template. Sets status='paused', records paused_at and optional reason.
  // The DB trigger keeps `is_active` in sync so the existing generation cron skips it.
  const pauseTemplate = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string | null }) => {
      if (!user) throw new Error('Not authenticated');
      const update = {
        status: 'paused',
        paused_at: new Date().toISOString(),
        pause_reason: reason ?? null,
      } as TablesUpdate<'recurring_expense_templates'>;
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  // Resume a single template. Sets status='active' and records resumed_at.
  // We deliberately DO NOT backfill skipped months — generation picks up from the current month.
  const resumeTemplate = useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const update = {
        status: 'active',
        resumed_at: new Date().toISOString(),
      } as TablesUpdate<'recurring_expense_templates'>;
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  // Bulk: pause all currently-active templates for the user.
  const pauseAllTemplates = useMutation({
    mutationFn: async (reason?: string) => {
      if (!user) throw new Error('Not authenticated');
      const update = {
        status: 'paused',
        paused_at: new Date().toISOString(),
        pause_reason: reason ?? 'Home time / paused all',
      } as TablesUpdate<'recurring_expense_templates'>;
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(update)
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  // Bulk: resume all currently-paused templates for the user.
  const resumeAllTemplates = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated');
      const update = {
        status: 'active',
        resumed_at: new Date().toISOString(),
      } as TablesUpdate<'recurring_expense_templates'>;
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(update)
        .eq('user_id', user.id)
        .eq('status', 'paused');
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring_expense_templates'] }),
  });

  // Legacy: kept for backward compatibility. Routes through pause/resume mutations.
  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!user) throw new Error('Not authenticated');
      const update = is_active
        ? ({ status: 'active', resumed_at: new Date().toISOString() } as TablesUpdate<'recurring_expense_templates'>)
        : ({ status: 'paused', paused_at: new Date().toISOString() } as TablesUpdate<'recurring_expense_templates'>);
      const { error } = await supabase
        .from('recurring_expense_templates')
        .update(update)
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
    pauseTemplate,
    resumeTemplate,
    pauseAllTemplates,
    resumeAllTemplates,
    deleteTemplate,
  };
}
