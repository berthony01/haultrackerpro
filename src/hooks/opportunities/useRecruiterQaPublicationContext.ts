import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { RecruiterQaPublicationContext } from '@/lib/opportunities/publicationStatus';

type ContextRpc = (
  name: 'get_recruiter_qa_publication_context',
  args: { _recruiter_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

const readContext = supabase.rpc.bind(supabase) as unknown as ContextRpc;

/** Display metadata only; the RPC independently enforces caller authority. */
export function useRecruiterQaPublicationContext(
  recruiterId: string | null | undefined,
  canViewOpportunities: boolean,
) {
  const { user } = useAuth();
  const id = recruiterId ?? null;
  const enabled = !!user?.id && !!id && canViewOpportunities === true;
  const query = useQuery({
    queryKey: ['recruiter_qa_publication_context', user?.id ?? null, id],
    enabled,
    retry: false,
    queryFn: async (): Promise<RecruiterQaPublicationContext> => {
      if (!id) return 'unknown';
      const { data, error } = await readContext('get_recruiter_qa_publication_context', {
        _recruiter_id: id,
      });
      if (error) throw error;
      if (!Array.isArray(data) || data.length !== 1) return 'unknown';
      const row: unknown = data[0];
      if (!row || typeof row !== 'object' || Array.isArray(row)) return 'unknown';
      const value = row as Record<string, unknown>;
      if (value.recruiter_id !== id || typeof value.is_qa_fixture !== 'boolean') return 'unknown';
      return value.is_qa_fixture ? 'qa_only' : 'public';
    },
  });

  return {
    context: enabled && !query.isError && !query.isFetching
      ? query.data ?? 'unknown' : 'unknown',
    isLoading: enabled && query.isFetching,
    isError: enabled && query.isError,
    error: enabled ? query.error : null,
  };
}