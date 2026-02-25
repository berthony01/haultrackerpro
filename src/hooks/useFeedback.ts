import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export function useFeedback() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const feedbackQuery = useQuery({
    queryKey: ['feedback_responses', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('feedback_responses')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const submitFeedback = useMutation({
    mutationFn: async ({ response, loadsCount }: { response: string; loadsCount: number }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('feedback_responses')
        .insert({ user_id: user.id, response, loads_count: loadsCount });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback_responses'] }),
  });

  return {
    responses: feedbackQuery.data ?? [],
    isLoading: feedbackQuery.isLoading,
    submitFeedback,
  };
}
