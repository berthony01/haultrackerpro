import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { startOfMonth, endOfMonth } from 'date-fns';

interface AutomationLogInsert {
  source: 'voice' | 'receipt';
  raw_text: string | null;
  parsed_json: Record<string, unknown> | null;
  parse_confidence: number | null;
}

export function useExpenseAutomation() {
  const { user } = useAuth();

  const monthlyCountQuery = useQuery({
    queryKey: ['automation-logs-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const now = new Date();
      const start = startOfMonth(now).toISOString();
      const end = endOfMonth(now).toISOString();
      const { count, error } = await supabase
        .from('expense_automation_logs' as any)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', start)
        .lte('created_at', end);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const MONTHLY_LIMIT = 200;

  const checkLimit = (): { allowed: boolean } => {
    const count = monthlyCountQuery.data ?? 0;
    return { allowed: count < MONTHLY_LIMIT };
  };

  const logAutomation = useMutation({
    mutationFn: async (data: AutomationLogInsert) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('expense_automation_logs' as any)
        .insert({
          user_id: user.id,
          source: data.source,
          raw_text: data.raw_text,
          parsed_json: data.parsed_json,
          parse_confidence: data.parse_confidence,
        } as any);
      if (error) throw error;
    },
  });

  return { checkLimit, logAutomation, monthlyCount: monthlyCountQuery.data ?? 0 };
}
