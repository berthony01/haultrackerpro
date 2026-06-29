import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { AssistantPermissions } from '@/lib/assistantPermissions';

/**
 * Phase 4A — Driver-facing assistant listing enriched with agency delegation
 * source. Wraps the `list_my_assistants_with_source` RPC, which is strictly
 * scoped server-side to auth.uid() = driver_user_id.
 */
export interface AssistantWithSourceRow {
  id: string;
  assistant_user_id: string | null;
  invite_email: string;
  status: 'pending' | 'active' | 'revoked' | 'expired';
  permissions: AssistantPermissions;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  last_active_at: string | null;
  source: 'agency' | 'direct_invite';
  agency_id: string | null;
  agency_name: string | null;
  delegation_id: string | null;
  delegation_status:
    | 'pending_driver_approval'
    | 'approved'
    | 'declined'
    | 'revoked'
    | 'expired'
    | null;
}

export function useAssistantsWithSource() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-assistants-with-source', user?.id],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<AssistantWithSourceRow[]> => {
      const { data, error } = await (supabase as any).rpc(
        'list_my_assistants_with_source',
      );
      if (error) throw error;
      return (data ?? []) as AssistantWithSourceRow[];
    },
  });
}
